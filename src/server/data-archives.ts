import { organizationalArchive } from "./organizational-archive";
import { realParticipant } from "./participant-scope";
import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { zipSync } from "fflate";
import { z } from "zod";
import { db } from "@/db";
import {
  dataArchives,
  events,
  participants,
  trainingCodes,
  importBatches,
  privacyRequests,
  auditLogs,
  participantTrainingAccess,
} from "@/db/schema";
import { encrypt, decrypt } from "./crypto";
import { assert } from "./errors";
import { audit, exportReport, privacyOverview } from "./admin-operations";
import { exportTickets } from "./ticket-export";
import { exportSurvey, surveyOverview } from "./surveys";

const metadata = {
  id: dataArchives.id,
  createdAt: dataArchives.createdAt,
  participantCount: dataArchives.participantCount,
  byteLength: dataArchives.byteLength,
  reason: dataArchives.reason,
  files: dataArchives.files,
};
export async function listArchives(eventId: string) {
  return db()
    .select(metadata)
    .from(dataArchives)
    .where(eq(dataArchives.eventId, eventId))
    .orderBy(desc(dataArchives.createdAt));
}
export async function createArchive(
  eventId: string,
  adminId: string,
  reason = "Archiwum konferencji",
) {
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(event, 404, "Brak konferencji.");
  const people = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), realParticipant));
  assert(people.length <= 2000, 400, "Archiwum obsługuje do 2000 uczestników.");
  const files: Record<string, Uint8Array> = {};
  const json = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value, null, 2));
  files["konferencja.json"] = json(event);
  files["ankieta-definicja.json"] = json(await surveyOverview(eventId));
  files["rodo.json"] = json(await privacyOverview(eventId));
  for (const kind of ["attendance", "certificates", "privacy"])
    files[`${kind}.csv`] = new Uint8Array(
      await (await exportReport(eventId, adminId, kind, {})).arrayBuffer(),
    );
  for (const format of ["csv", "xlsx"] as const) {
    files[`ankieta.${format}`] = new Uint8Array(
      await (await exportSurvey(eventId, adminId, format)).arrayBuffer(),
    );
    if (people.length)
      files[`uczestnicy-z-kodami.${format}`] = new Uint8Array(
        await (await exportTickets(eventId, adminId, format)).arrayBuffer(),
      );
  }
  files["wiadomosci-organizacyjne.json"] = json(
    await organizationalArchive(eventId),
  );
  files["historia.json"] = json(
    await db().select().from(auditLogs).where(eq(auditLogs.eventId, eventId)),
  );
  files["INFORMACJA.txt"] = new TextEncoder().encode(
    "Archiwum raportów konferencji. Zawiera dane osobowe i kody dostępu. Nie udostępniaj publicznie. Zaproszenia PDF nie są już generowane; kody uczestników pozostają w CSV/Excel. Wiadomości organizacyjne: treść, odbiorcy, statusy i diagnostyka w wiadomosci-organizacyjne.json. Certyfikaty: raport wydania, bez generowania nowych PDF. Archiwum nie jest kopią bazy do automatycznego odtworzenia. Usunięcie uczestników nie usuwa danych z wcześniejszych archiwów.\n",
  );
  const bytes = zipSync(files, { level: 1 });
  assert(
    bytes.length <= 50 * 1024 * 1024,
    413,
    "Archiwum przekracza 50 MB. Dane nie zostały usunięte.",
  );
  const [saved] = await db()
    .insert(dataArchives)
    .values({
      eventId,
      adminId,
      reason,
      participantCount: people.length,
      byteLength: bytes.length,
      files: Object.keys(files),
      payload: encrypt(Buffer.from(bytes).toString("base64")),
    })
    .returning(metadata);
  await audit(eventId, adminId, "DATA_ARCHIVE_CREATED", saved.id);
  return saved;
}
export async function downloadArchive(
  eventId: string,
  adminId: string,
  id: string,
) {
  const [archive] = await db()
    .select()
    .from(dataArchives)
    .where(and(eq(dataArchives.eventId, eventId), eq(dataArchives.id, id)));
  assert(archive, 404, "Brak archiwum.");
  const bytes = Buffer.from(decrypt(archive.payload), "base64");
  await audit(eventId, adminId, "DATA_ARCHIVE_DOWNLOADED", id);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 65536, bytes.length);
        controller.enqueue(new Uint8Array(bytes.subarray(offset, end)));
        offset = end;
      },
    }),
    {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="archiwum-${archive.createdAt.toISOString().slice(0, 10)}-${id}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export async function removeArchive(
  eventId: string,
  adminId: string,
  id: string,
  input: unknown,
) {
  const body = z
    .object({ confirmation: z.literal("USUŃ ARCHIWUM") })
    .parse(input);
  assert(body.confirmation, 400, "Potwierdź usunięcie archiwum.");
  return db().transaction(async (tx) => {
    const rows = await tx
      .delete(dataArchives)
      .where(and(eq(dataArchives.eventId, eventId), eq(dataArchives.id, id)))
      .returning({ id: dataArchives.id });
    assert(rows.length, 404, "Brak archiwum.");
    await audit(
      eventId,
      adminId,
      "DATA_ARCHIVE_DELETED",
      id,
      tx as unknown as ReturnType<typeof db>,
    );
    return { deleted: 1 };
  });
}
const selection = z.object({ ids: z.array(z.uuid()).min(1).max(2000) });
function fingerprint(people: { id: string; updatedAt: Date }[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        people.map((p) => [p.id, p.updatedAt.toISOString()]).sort(),
      ),
    )
    .digest("hex");
}
export async function cleanupPreview(eventId: string, input: unknown) {
  const { ids } = selection.parse(input);
  const people = await db()
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      email: participants.email,
      updatedAt: participants.updatedAt,
    })
    .from(participants)
    .where(
      and(eq(participants.eventId, eventId), inArray(participants.id, ids)),
    );
  assert(
    people.length === new Set(ids).size,
    409,
    "Lista uczestników zmieniła się. Odśwież podgląd.",
  );
  return { people, fingerprint: fingerprint(people) };
}
export async function clearSelectedParticipants(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const body = selection
    .extend({
      fingerprint: z.string().length(64),
      confirmation: z.literal("USUŃ WYBRANYCH"),
    })
    .parse(input);
  const preview = await cleanupPreview(eventId, body);
  assert(
    preview.fingerprint === body.fingerprint,
    409,
    "Dane zmieniły się. Odśwież podgląd.",
  );
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(
    event && event.startsAt > new Date(),
    409,
    "Czyszczenie przygotowawcze jest dostępne tylko przed konferencją.",
  );
  const archive = await createArchive(
    eventId,
    adminId,
    "Przed czyszczeniem uczestników",
  );
  return db().transaction(async (tx) => {
    const [lockedEvent] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    assert(
      lockedEvent.startsAt > new Date(),
      409,
      "Konferencja już się rozpoczęła. Nie usunięto danych.",
    );
    const people = await tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.eventId, eventId),
          inArray(participants.id, body.ids),
        ),
      )
      .for("update");
    assert(
      people.length === preview.people.length &&
        fingerprint(people) === body.fingerprint,
      409,
      "Dane zmieniły się podczas archiwizacji. Nie usunięto danych.",
    );
    await tx
      .update(trainingCodes)
      .set({ retiredAt: new Date() })
      .where(
        inArray(
          trainingCodes.id,
          tx
            .select({ id: participantTrainingAccess.codeId })
            .from(participantTrainingAccess)
            .where(inArray(participantTrainingAccess.participantId, body.ids)),
        ),
      );
    await tx
      .delete(privacyRequests)
      .where(
        and(
          eq(privacyRequests.eventId, eventId),
          inArray(privacyRequests.participantId, body.ids),
        ),
      );
    const emails = new Set(people.map((p) => p.email.toLowerCase()));
    const batches = await tx
      .select()
      .from(importBatches)
      .where(eq(importBatches.eventId, eventId))
      .for("update");
    for (const batch of batches)
      await tx
        .update(importBatches)
        .set({
          rows: batch.rows.filter((r) => !emails.has(r.email.toLowerCase())),
        })
        .where(eq(importBatches.id, batch.id));
    await tx
      .delete(participants)
      .where(
        and(
          eq(participants.eventId, eventId),
          inArray(participants.id, body.ids),
        ),
      );
    await audit(
      eventId,
      adminId,
      `PRE_EVENT_PARTICIPANTS_CLEARED_${people.length}`,
      archive.id,
      tx as unknown as ReturnType<typeof db>,
    );
    return { deleted: people.length, archiveId: archive.id };
  });
}
