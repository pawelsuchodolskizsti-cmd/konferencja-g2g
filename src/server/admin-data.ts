import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendance,
  auditLogs,
  certificates,
  emailLogs,
  events,
  participants,
  participantTrainingAccess,
  trainingCourses,
  trainingCodes,
  materials,
  importBatches,
} from "@/db/schema";
import { assert } from "./errors";
import { safeCsv } from "./imports";
export async function participantList(eventId: string) {
  return db()
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      email: participants.email,
      checkedInAt: attendance.checkedInAt,
      method: attendance.method,
      emailStatus: emailLogs.status,
      emailError: emailLogs.errorCode,
      emailSentAt: emailLogs.sentAt,
      certificateGeneratedAt: certificates.createdAt,
    })
    .from(participants)
    .leftJoin(attendance, eq(attendance.participantId, participants.id))
    .leftJoin(
      emailLogs,
      and(
        eq(emailLogs.participantId, participants.id),
        eq(emailLogs.kind, "INVITATION"),
      ),
    )
    .leftJoin(certificates, eq(certificates.participantId, participants.id))
    .where(eq(participants.eventId, eventId))
    .orderBy(participants.lastName, participants.firstName);
}
export async function eventOverview(eventId: string) {
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(event, 404, "Nie znaleziono wydarzenia.");
  const [people, courses, audit, files] = await Promise.all([
    participantList(eventId),
    db()
      .select({
        id: trainingCourses.id,
        name: trainingCourses.name,
        platform: trainingCourses.platform,
        url: trainingCourses.url,
        mode: trainingCourses.mode,
        total: sql<number>`(SELECT COUNT(*)::int FROM training_codes c WHERE c.course_id = ${trainingCourses.id} AND c.retired_at IS NULL)`,
        assigned: sql<number>`(SELECT COUNT(*)::int FROM participant_training_access a WHERE a.course_id = ${trainingCourses.id})`,
      })
      .from(trainingCourses)
      .where(eq(trainingCourses.eventId, eventId)),
    db()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.eventId, eventId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
    db()
      .select({ id: materials.id, title: materials.title })
      .from(materials)
      .where(eq(materials.eventId, eventId)),
  ]);
  return {
    event,
    people,
    courses,
    audit,
    materials: files,
    mailEnabled:
      process.env.APP_ENV === "production" &&
      (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production") &&
      process.env.MAIL_ENABLED === "true" &&
      !!process.env.RESEND_API_KEY,
  };
}
export async function exportAttendance(eventId: string) {
  const rows = await participantList(eventId);
  const content = [
    [
      "Imię",
      "Nazwisko",
      "Email",
      "Status obecności",
      "Data i godzina check-in (UTC)",
      "Metoda check-in",
      "Status certyfikatu",
    ],
    ...rows.map((p) => [
      p.firstName,
      p.lastName,
      p.email,
      p.checkedInAt ? "OBECNY" : "NIEOBECNY",
      p.checkedInAt?.toISOString() || "",
      p.method || "",
      p.certificateGeneratedAt
        ? "WYGENEROWANY"
        : p.checkedInAt
          ? "OBECNOŚĆ POTWIERDZONA"
          : "BRAK UPRAWNIEŃ",
    ]),
  ]
    .map((row) => row.map(safeCsv).join(";"))
    .join("\r\n");
  return new Response("\uFEFF" + content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="obecnosc.csv"',
      "Cache-Control": "no-store",
    },
  });
}
export async function updateParticipant(
  eventId: string,
  adminId: string,
  id: string,
  input: unknown,
) {
  const value = z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      email: z.email().transform((v) => v.toLowerCase()),
    })
    .parse(input);
  return db().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .for("update");
    assert(current, 404, "Brak uczestnika.");
    if (current.email !== value.email) {
      const [mail] = await tx
        .select({ id: emailLogs.id })
        .from(emailLogs)
        .where(eq(emailLogs.participantId, id))
        .limit(1);
      assert(
        !mail,
        409,
        "Adresu nie można zmienić po zleceniu wysyłki. Skontaktuj się z administratorem systemu, aby poprawić adres i rozliczyć kolejkę.",
      );
    }
    const [p] = await tx
      .update(participants)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .returning({ id: participants.id });
    assert(p, 404, "Brak uczestnika.");
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "PARTICIPANT_UPDATED",
        targetId: id,
      });
    return p;
  });
}
export async function deleteParticipant(
  eventId: string,
  adminId: string,
  id: string,
) {
  return db().transaction(async (tx) => {
    await tx
      .update(trainingCodes)
      .set({ retiredAt: new Date() })
      .where(
        sql`${trainingCodes.id} IN (SELECT code_id FROM participant_training_access WHERE participant_id = ${id})`,
      );
    await tx
      .delete(participantTrainingAccess)
      .where(eq(participantTrainingAccess.participantId, id));
    const rows = await tx
      .delete(participants)
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .returning({ id: participants.id });
    assert(rows.length, 404, "Brak uczestnika.");
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "PARTICIPANT_DELETED",
        targetId: id,
      });
    return { deleted: rows.length };
  });
}
export async function deleteEventData(
  eventId: string,
  adminId: string,
  confirmation: string,
) {
  assert(
    confirmation === "USUŃ DANE",
    400,
    "Wpisz USUŃ DANE, aby potwierdzić.",
  );
  return db().transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    assert(
      event?.retentionUntil && event.retentionUntil <= new Date(),
      409,
      "Okres przechowywania danych jeszcze nie upłynął.",
    );
    await tx
      .update(trainingCodes)
      .set({ retiredAt: new Date() })
      .where(
        sql`${trainingCodes.id} IN (SELECT a.code_id FROM participant_training_access a JOIN participants p ON p.id = a.participant_id WHERE p.event_id = ${eventId})`,
      );
    await tx.delete(importBatches).where(eq(importBatches.eventId, eventId));
    const rows = await tx
      .delete(participants)
      .where(eq(participants.eventId, eventId))
      .returning({ id: participants.id });
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "EVENT_PERSONAL_DATA_DELETED",
        targetId: eventId,
      });
    return { deleted: rows.length };
  });
}
