import { certificateName } from "@/lib/certificate-name";
import { eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { auditLogs, certificates, participants } from "@/db/schema";
import { certificateAvailable, presentParticipant } from "./attendance";
import { assert } from "./errors";
import { renderCertificate } from "./certificate-pdf";

export { renderCertificate } from "./certificate-pdf";

async function generateUnlocked(
  participantId: string,
  database: Database = db(),
) {
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
  const pdf = await renderCertificate({
    name: certificateName(person).value,
    eventName: event.name,
    organizer: event.organizer,
    date: new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "long",
      timeZone: event.timezone,
    }).format(event.startsAt),
    number,
  });
  if (!existing)
    await database.transaction(async (tx) => {
      const inserted = await tx
        .insert(certificates)
        .values({ participantId, number })
        .onConflictDoNothing()
        .returning();
      if (inserted.length)
        await tx.insert(auditLogs).values({
          eventId: event.id,
          action: "CERTIFICATE_GENERATED",
          targetId: participantId,
        });
    });
  return { pdf, number };
}

// Serialize issuance with attendance corrections without changing eligibility.
export async function generateCertificate(
  participantId: string,
  database: Database = db(),
) {
  return database.transaction(async (tx) => {
    await tx
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.id, participantId))
      .for("update");
    return generateUnlocked(participantId, tx as unknown as Database);
  });
}
