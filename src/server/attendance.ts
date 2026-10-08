import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { attendance, auditLogs, events, participants } from "@/db/schema";
import { hashToken } from "./crypto";
import { assert } from "./errors";

export async function checkIn(
  eventId: string,
  adminId: string,
  input: { token: string } | { participantId: string },
  database: Database = db(),
) {
  return database.transaction(async (tx) => {
    const condition =
      "token" in input
        ? eq(participants.qrHash, hashToken(input.token))
        : eq(participants.id, input.participantId);
    const [person] = await tx
      .select({
        id: participants.id,
        firstName: participants.firstName,
        lastName: participants.lastName,
      })
      .from(participants)
      .where(and(eq(participants.eventId, eventId), condition));
    assert(person, 404, "Nieprawidłowy QR lub uczestnik z innego wydarzenia.");
    const [record] = await tx
      .insert(attendance)
      .values({
        participantId: person.id,
        adminId,
        method: "token" in input ? "QR" : "MANUAL",
      })
      .onConflictDoNothing({ target: attendance.participantId })
      .returning();
    if (record)
      await tx.insert(auditLogs).values({
        eventId,
        adminId,
        action: "token" in input ? "CHECKIN_QR" : "CHECKIN_MANUAL",
        targetId: person.id,
      });
    const existing =
      record ||
      (
        await tx
          .select()
          .from(attendance)
          .where(eq(attendance.participantId, person.id))
      )[0];
    return {
      alreadyPresent: !record,
      checkedInAt: existing.checkedInAt,
      firstName: person.firstName,
      lastName: person.lastName,
    };
  });
}
export async function presentParticipant(
  participantId: string,
  database: Database = db(),
) {
  const [result] = await database
    .select({ person: participants, event: events, attendance })
    .from(participants)
    .innerJoin(events, eq(events.id, participants.eventId))
    .innerJoin(attendance, eq(attendance.participantId, participants.id))
    .where(eq(participants.id, participantId));
  assert(
    result,
    403,
    "Materiały są dostępne po potwierdzeniu obecności na konferencji.",
  );
  return result;
}
export function certificateAvailable(
  event: { endsAt: Date; certificateUnlockAt: Date },
  now = new Date(),
) {
  return now >= event.certificateUnlockAt;
}
