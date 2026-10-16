import { certificateName } from "@/lib/certificate-name";
import { eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { auditLogs, certificates, participants } from "@/db/schema";
import { certificateAvailable, presentParticipant } from "./attendance";
import { assert, AppError } from "./errors";
import { renderCertificateParts } from "./certificate-pdf";
export { renderCertificate } from "./certificate-pdf";
async function certificateInput(participantId: string, database: Database) {
  const { person, event } = await presentParticipant(participantId, database);
  assert(
    certificateAvailable(event),
    403,
    "Certyfikat będzie dostępny po zakończeniu konferencji.",
  );
  const [existing] = await database
    .select()
    .from(certificates)
    .where(eq(certificates.participantId, participantId));
  const number =
    existing?.number ||
    `CONF-${event.startsAt.getUTCFullYear()}-${person.id.toUpperCase()}`;
  return {
    eventId: event.id,
    existing,
    input: {
      name: certificateName(person).value,
      eventName: event.name,
      organizer: event.organizer,
      date: new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "long",
        timeZone: event.timezone,
      }).format(event.startsAt),
      number,
    },
  };
}
export async function generateCertificate(
  participantId: string,
  database: Database = db(),
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const initial = await certificateInput(participantId, database);
    // No database connection or row lock is held while rendering the PDF.
    const parts = await renderCertificateParts(initial.input);
    const completed = await database.transaction(async (tx) => {
      await tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.id, participantId))
        .for("update");
      const current = await certificateInput(
        participantId,
        tx as unknown as Database,
      );
      if (JSON.stringify(current.input) !== JSON.stringify(initial.input))
        return false;
      if (!current.existing) {
        const inserted = await tx
          .insert(certificates)
          .values({ participantId, number: current.input.number })
          .onConflictDoNothing()
          .returning();
        if (inserted.length)
          await tx
            .insert(auditLogs)
            .values({
              eventId: current.eventId,
              action: "CERTIFICATE_GENERATED",
              targetId: participantId,
            });
      }
      return true;
    });
    if (completed)
      return {
        parts,
        number: initial.input.number,
        get pdf() {
          return Buffer.concat(parts);
        },
      };
  }
  throw new AppError(
    409,
    "Dane certyfikatu są właśnie zmieniane. Pobierz go ponownie.",
  );
}
