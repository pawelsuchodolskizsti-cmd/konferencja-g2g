import { materialContent } from "./material-content";
import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/db";
import {
  admins,
  adminEvents,
  attendance,
  auditLogs,
  certificates,
  emailLogs,
  events,
  importBatches,
  materials,
  participants,
  participantTrainingAccess,
  privacyRequests,
  sessions,
  rateLimits,
} from "@/db/schema";
import { assert } from "./errors";
import { encrypt, newCredentials, passwordHash } from "./crypto";
import { participantIdentity } from "@/lib/participant-identity";
import { safeCsv } from "./imports";
import { participantList } from "./admin-data";
import { certificateName } from "@/lib/certificate-name";
import {
  filterParticipants,
  type ParticipantFilter,
} from "@/lib/participant-filter";
import {
  PARTICIPANT_PRIVACY_ACTION,
  PARTICIPANT_PRIVACY_VERSION,
} from "@/lib/participant-privacy";

export function selectionFrom(url: URL): ParticipantFilter {
  const ids = url.searchParams.has("ids")
    ? (url.searchParams.get("ids") || "").split(",").filter(Boolean)
    : undefined;
  return z
    .object({
      q: z.string().max(200),
      filter: z.enum([
        "all",
        "present",
        "absent",
        "certificate",
        "name-review",
      ]),
      ids: z.array(z.uuid()).max(2000).optional(),
    })
    .parse({
      q: url.searchParams.get("q") || "",
      filter: url.searchParams.get("filter") || "all",
      ids,
    });
}
export function csvResponse(rows: unknown[][], filename: string) {
  return new Response(
    "\uFEFF" + rows.map((row) => row.map(safeCsv).join(";")).join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
export async function audit(
  eventId: string,
  adminId: string,
  action: string,
  targetId?: string,
  database: Database = db(),
) {
  await database
    .insert(auditLogs)
    .values({ eventId, adminId, action, targetId });
}
export async function selectedPeople(
  eventId: string,
  selection: ParticipantFilter,
) {
  const people = await participantList(eventId);
  if (selection.ids)
    assert(
      selection.ids.every((id) => people.some((p) => p.id === id)),
      400,
      "Wybór zawiera nieaktualnego uczestnika. Odśwież listę.",
    );
  return filterParticipants(people, selection);
}
export async function participantRecord(
  eventId: string,
  id: string,
  database: Database = db(),
) {
  const [p] = await database
    .select()
    .from(participants)
    .where(and(eq(participants.id, id), eq(participants.eventId, eventId)));
  assert(p, 404, "Brak uczestnika w tej konferencji.");
  return p;
}
export async function createParticipant(
  eventId: string,
  adminId: string,
  input: unknown,
  database: Database = db(),
) {
  const data = z
    .object({
      firstName: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[^\x00-\x1f]+$/),
      lastName: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[^\x00-\x1f]+$/),
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
    })
    .parse(input);
  return database.transaction(async (tx) => {
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    const people = await tx
      .select()
      .from(participants)
      .where(eq(participants.eventId, eventId));
    assert(
      !people.some((p) => participantIdentity(p) === participantIdentity(data)),
      409,
      "Ten uczestnik już istnieje. Użyj jego obecnego konta i kodu.",
    );
    const [p] = await tx
      .insert(participants)
      .values({ ...data, eventId, ...newCredentials() })
      .returning({ id: participants.id });
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "PARTICIPANT_CREATED",
      targetId: p.id,
    });
    return p;
  });
}
export async function resetCredentials(
  eventId: string,
  adminId: string,
  id: string,
  input: unknown,
  database: Database = db(),
) {
  z.object({ confirmation: z.literal("ZMIEŃ KODY") }).parse(input);
  return database.transaction(async (tx) => {
    const [person] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .for("update");
    assert(person, 404, "Brak uczestnika.");
    const pending = await tx
      .select({ id: emailLogs.id })
      .from(emailLogs)
      .where(
        and(
          eq(emailLogs.participantId, id),
          inArray(emailLogs.status, ["QUEUED", "SENDING"]),
        ),
      );
    assert(
      !pending.length,
      409,
      "Najpierw rozlicz oczekującą wysyłkę wiadomości.",
    );
    await tx
      .update(participants)
      .set({ ...newCredentials(), updatedAt: new Date() })
      .where(eq(participants.id, id));
    await tx.delete(sessions).where(eq(sessions.participantId, id));
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "PARTICIPANT_CODES_RESET",
      targetId: id,
    });
    return { saved: true };
  });
}
export async function undoAttendance(
  eventId: string,
  adminId: string,
  id: string,
  input: unknown,
  database: Database = db(),
) {
  const { reason } = z
    .object({ reason: z.string().trim().min(5).max(300) })
    .parse(input);
  return database.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .for("update");
    assert(p, 404, "Brak uczestnika.");
    const [issued] = await tx
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.participantId, id));
    const [course] = await tx
      .select({ id: participantTrainingAccess.id })
      .from(participantTrainingAccess)
      .where(eq(participantTrainingAccess.participantId, id));
    assert(
      !issued && !course,
      409,
      "Nie można cofnąć obecności: wydano już certyfikat lub indywidualny kod szkoleniowy.",
    );
    await tx.delete(attendance).where(eq(attendance.participantId, id));
    await tx.delete(sessions).where(eq(sessions.participantId, id));
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      targetId: id,
      action: `CHECKIN_REVERSED: ${reason}`,
    });
    return { saved: true };
  });
}
export async function personalData(
  eventId: string,
  adminId: string,
  id: string,
) {
  const p = await participantRecord(eventId, id);
  const [visits, issued, access, history] = await Promise.all([
    db().select().from(attendance).where(eq(attendance.participantId, id)),
    db().select().from(certificates).where(eq(certificates.participantId, id)),
    db()
      .select({
        courseId: participantTrainingAccess.courseId,
        createdAt: participantTrainingAccess.createdAt,
      })
      .from(participantTrainingAccess)
      .where(eq(participantTrainingAccess.participantId, id)),
    db()
      .select({ action: auditLogs.action, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.eventId, eventId), eq(auditLogs.targetId, id)))
      .orderBy(asc(auditLogs.createdAt)),
  ]);
  await audit(eventId, adminId, "PERSONAL_DATA_EXPORTED", id);
  return Response.json(
    {
      participant: {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        secondaryEmail: p.secondaryEmail,
        certificateNameOverride: p.certificateNameOverride,
        createdAt: p.createdAt,
      },
      attendance: visits,
      certificates: issued,
      trainingAccess: access,
      history,
      notice: "Anonimowe odpowiedzi ankiety nie są powiązane z uczestnikiem.",
    },
    {
      headers: {
        "Content-Disposition": 'attachment; filename="dane-uczestnika.json"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
export async function privacyOverview(eventId: string) {
  const [people, acks, requests, [event], lastCleanup] = await Promise.all([
    participantList(eventId),
    db()
      .select({
        participantId: auditLogs.targetId,
        action: auditLogs.action,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.eventId, eventId),
          sql`${auditLogs.action} LIKE 'PARTICIPANT_PRIVACY_ACK_%'`,
        ),
      )
      .orderBy(desc(auditLogs.createdAt)),
    db()
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.eventId, eventId))
      .orderBy(desc(privacyRequests.createdAt)),
    db()
      .select({ retentionUntil: events.retentionUntil })
      .from(events)
      .where(eq(events.id, eventId)),
    db()
      .select()
      .from(auditLogs)
      .where(
        and(
          or(eq(auditLogs.eventId, eventId), isNull(auditLogs.eventId)),
          sql`${auditLogs.action} LIKE 'EPHEMERAL_CLEANUP%'`,
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1),
  ]);
  return {
    version: PARTICIPANT_PRIVACY_VERSION,
    retentionUntil: event.retentionUntil,
    lastCleanup: lastCleanup[0]?.createdAt || null,
    requests,
    people: people.map((p) => {
      const ack = acks.find(
        (a) =>
          a.participantId === p.id && a.action === PARTICIPANT_PRIVACY_ACTION,
      );
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        acknowledgedAt: ack?.createdAt || null,
        version: ack ? PARTICIPANT_PRIVACY_VERSION : null,
      };
    }),
  };
}
export async function savePrivacyRequest(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const data = z
    .object({
      id: z.uuid().optional(),
      participantId: z.uuid().nullable(),
      kind: z.enum(["ACCESS", "CORRECTION", "DELETION", "OTHER"]),
      status: z.enum(["OPEN", "DONE"]),
      note: z.string().trim().max(1000),
    })
    .parse(input);
  if (data.participantId) await participantRecord(eventId, data.participantId);
  return db().transaction(async (tx) => {
    const { id, ...value } = data;
    const values = {
      ...value,
      eventId,
      resolvedAt: data.status === "DONE" ? new Date() : null,
    };
    const [record] = id
      ? await tx
          .update(privacyRequests)
          .set(values)
          .where(
            and(
              eq(privacyRequests.id, id),
              eq(privacyRequests.eventId, eventId),
            ),
          )
          .returning()
      : await tx.insert(privacyRequests).values(values).returning();
    assert(record, 404, "Brak zgłoszenia.");
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "PRIVACY_REQUEST_UPDATED",
      targetId: record.id,
    });
    return { saved: true };
  });
}
export async function cleanupData(eventId: string, adminId: string) {
  return db().transaction(async (tx) => {
    const now = new Date();
    const imports = await tx
      .delete(importBatches)
      .where(
        and(
          eq(importBatches.eventId, eventId),
          lt(importBatches.expiresAt, now),
        ),
      )
      .returning({ id: importBatches.id });
    const expired = await tx
      .delete(sessions)
      .where(lt(sessions.expiresAt, now))
      .returning({ id: sessions.id });
    const limits = await tx
      .delete(rateLimits)
      .where(lt(rateLimits.resetsAt, now))
      .returning({ key: rateLimits.key });
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: `EPHEMERAL_CLEANUP imports=${imports.length} sessions=${expired.length} limits=${limits.length}`,
    });
    return {
      imports: imports.length,
      sessions: expired.length,
      limits: limits.length,
    };
  });
}
export async function history(eventId: string, url: URL) {
  const q = (url.searchParams.get("q") || "").slice(0, 100);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .parse(url.searchParams.get("offset") || 0);
  const target = url.searchParams.get("target");
  if (target) z.uuid().parse(target);
  return db()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetId: auditLogs.targetId,
      createdAt: auditLogs.createdAt,
      adminEmail: admins.email,
    })
    .from(auditLogs)
    .leftJoin(admins, eq(admins.id, auditLogs.adminId))
    .where(
      and(
        eq(auditLogs.eventId, eventId),
        q
          ? sql`position(lower(${q}) in lower(${auditLogs.action})) > 0`
          : undefined,
        target ? eq(auditLogs.targetId, target) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(100)
    .offset(offset);
}
export async function exportReport(
  eventId: string,
  adminId: string,
  kind: string,
  selection: ParticipantFilter,
) {
  const people = await selectedPeople(eventId, selection);
  let rows: unknown[][];
  if (kind === "privacy") {
    const info = await privacyOverview(eventId);
    const ids = new Set(people.map((p) => p.id));
    rows = [
      ["Imię", "Nazwisko", "Email", "Wersja klauzuli", "Data zapoznania (UTC)"],
      ...info.people
        .filter((p) => ids.has(p.id))
        .map((p) => [
          p.firstName,
          p.lastName,
          p.email,
          p.version,
          p.acknowledgedAt?.toISOString(),
        ]),
    ];
  } else if (kind === "certificates") {
    rows = [
      [
        "Imię",
        "Nazwisko",
        "Email",
        "Forma na certyfikacie",
        "Ręczna korekta",
        "Do sprawdzenia",
        "Wygenerowano (UTC)",
      ],
      ...people.map((p) => {
        const n = certificateName(p);
        return [
          p.firstName,
          p.lastName,
          p.email,
          n.value,
          n.manual ? "TAK" : "NIE",
          n.needsReview ? "TAK" : "NIE",
          p.certificateGeneratedAt?.toISOString(),
        ];
      }),
    ];
  } else {
    rows = [
      [
        "Imię",
        "Nazwisko",
        "Email",
        "Obecność",
        "Check-in (UTC)",
        "Metoda",
        "Certyfikat",
      ],
      ...people.map((p) => [
        p.firstName,
        p.lastName,
        p.email,
        p.checkedInAt ? "OBECNY" : "NIEOBECNY",
        p.checkedInAt?.toISOString(),
        p.method,
        p.certificateGeneratedAt ? "WYGENEROWANY" : "NIEWYGENEROWANY",
      ]),
    ];
  }
  await audit(eventId, adminId, `REPORT_EXPORTED_${kind.toUpperCase()}`);
  return csvResponse(rows, `${kind}.csv`);
}
export async function teamOverview(eventId: string) {
  return db()
    .select({
      id: admins.id,
      email: admins.email,
      active: admins.active,
      role: adminEvents.role,
    })
    .from(adminEvents)
    .innerJoin(admins, eq(admins.id, adminEvents.adminId))
    .where(eq(adminEvents.eventId, eventId));
}
export async function saveTeamMember(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const data = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      role: z.enum(["ADMIN", "CHECKIN", "CONTROLLER"]),
      password: z.string().min(14).max(200).optional(),
    })
    .parse(input);
  return db().transaction(async (tx) => {
    await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    let [member] = await tx
      .select()
      .from(admins)
      .where(eq(admins.email, data.email));
    if (!member) {
      assert(
        data.password,
        400,
        "Dla nowego konta podaj hasło (co najmniej 14 znaków).",
      );
      [member] = await tx
        .insert(admins)
        .values({
          email: data.email,
          passwordHash: passwordHash(data.password),
        })
        .returning();
    } else
      assert(
        !data.password,
        400,
        "Konto już istnieje. Nie podawaj hasła przy zmianie roli.",
      );
    assert(member.active, 409, "Konto jest nieaktywne.");
    assert(
      member.id !== adminId || data.role === "ADMIN",
      409,
      "Nie możesz odebrać sobie uprawnień administratora.",
    );
    await tx
      .insert(adminEvents)
      .values({ eventId, adminId: member.id, role: data.role })
      .onConflictDoUpdate({
        target: [adminEvents.adminId, adminEvents.eventId],
        set: { role: data.role },
      });
    await tx.delete(sessions).where(eq(sessions.adminId, member.id));
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: `ADMIN_ROLE_${data.role}`,
      targetId: member.id,
    });
    return { saved: true };
  });
}
export async function manageMaterial(
  eventId: string,
  adminId: string,
  id: string,
  method: string,
  input?: unknown,
  file?: File,
) {
  const [item] = await db()
    .select()
    .from(materials)
    .where(and(eq(materials.eventId, eventId), eq(materials.id, id)));
  assert(item, 404, "Brak materiału.");
  if (method === "GET")
    return new Response(materialContent(item.encryptedContent), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="material.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  if (method === "DELETE") {
    await db()
      .delete(materials)
      .where(and(eq(materials.eventId, eventId), eq(materials.id, id)));
  } else if (file) {
    assert(
      file.size > 0 && file.size <= 2 * 1024 * 1024,
      400,
      "Odśwież panel i użyj zastępowania PDF w sekcji Materiały, która przesyła plik w częściach.",
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    assert(
      file.name.toLowerCase().endsWith(".pdf") &&
        bytes.subarray(0, 5).toString() === "%PDF-",
      400,
      "Wybierz PDF.",
    );
    await db()
      .update(materials)
      .set({ encryptedContent: encrypt(bytes.toString("base64")) })
      .where(eq(materials.id, id));
  } else {
    const value = z
      .object({
        title: z.string().trim().min(1).max(160),
        published: z.boolean(),
      })
      .parse(input);
    await db().update(materials).set(value).where(eq(materials.id, id));
  }
  await audit(
    eventId,
    adminId,
    method === "DELETE" ? "MATERIAL_DELETED" : "MATERIAL_UPDATED",
    id,
  );
  return Response.json({ saved: true });
}

export async function removeTeamMember(
  eventId: string,
  adminId: string,
  id: string,
) {
  assert(id !== adminId, 409, "Nie możesz odebrać sobie dostępu.");
  return db().transaction(async (tx) => {
    const removed = await tx
      .delete(adminEvents)
      .where(and(eq(adminEvents.eventId, eventId), eq(adminEvents.adminId, id)))
      .returning();
    assert(removed.length, 404, "Brak członka zespołu.");
    await tx.delete(sessions).where(eq(sessions.adminId, id));
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "ADMIN_ACCESS_REMOVED",
      targetId: id,
    });
    return { saved: true };
  });
}
