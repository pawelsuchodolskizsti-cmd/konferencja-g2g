import { materialsUnlocked } from "./material-access";
import { realParticipant, testParticipant } from "./participant-scope";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/db";
import {
  attendance,
  auditLogs,
  dataArchives,
  certificates,
  emailLogs,
  events,
  participants,
  participantTrainingAccess,
  trainingCourses,
  trainingCodes,
  materials,
  importBatches,
  privacyRequests,
} from "@/db/schema";
import { assert } from "./errors";
import { decrypt } from "./crypto";
import { safeCsv } from "./imports";
export async function participantList(eventId: string, includeTest = false) {
  const logins = db()
    .select({
      participantId: auditLogs.targetId,
      firstLoginAt: sql<string>`min(${auditLogs.createdAt})::text`.as(
        "first_login_at",
      ),
      lastLoginAt: sql<string>`max(${auditLogs.createdAt})::text`.as(
        "last_login_at",
      ),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventId, eventId),
        sql`(starts_with(${auditLogs.action}, 'PARTICIPANT_PRIVACY_ACK_') OR ${auditLogs.action} = 'PARTICIPANT_LOGIN')`,
      ),
    )
    .groupBy(auditLogs.targetId)
    .as("participant_logins");
  const rows = await db()
    .select({
      id: participants.id,
      isTest: testParticipant,
      credentials: participants.credentials,
      firstName: participants.firstName,
      lastName: participants.lastName,
      certificateNameOverride: participants.certificateNameOverride,
      email: participants.email,
      firstLoginAt: logins.firstLoginAt,
      lastLoginAt: logins.lastLoginAt,
      checkedInAt: attendance.checkedInAt,
      method: attendance.method,
      emailStatus: emailLogs.status,
      emailError: emailLogs.errorCode,
      emailSentAt: emailLogs.sentAt,
      certificateGeneratedAt: certificates.createdAt,
    })
    .from(participants)
    .leftJoin(logins, eq(logins.participantId, participants.id))
    .leftJoin(attendance, eq(attendance.participantId, participants.id))
    .leftJoin(
      emailLogs,
      and(
        eq(emailLogs.participantId, participants.id),
        eq(emailLogs.kind, "INVITATION"),
      ),
    )
    .leftJoin(certificates, eq(certificates.participantId, participants.id))
    .where(
      and(
        eq(participants.eventId, eventId),
        includeTest ? undefined : realParticipant,
      ),
    );
  rows.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, "pl") ||
      a.firstName.localeCompare(b.firstName, "pl") ||
      a.id.localeCompare(b.id),
  );
  return rows.map(({ credentials, ...person }) => ({
    ...person,
    accessCode: String(JSON.parse(decrypt(credentials)).accessCode),
  }));
}
export async function eventOverview(eventId: string) {
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(event, 404, "Nie znaleziono wydarzenia.");
  const [people, courses, audit, files] = await Promise.all([
    participantList(eventId, true),
    db()
      .select({
        id: trainingCourses.id,
        name: trainingCourses.name,
        platform: trainingCourses.platform,
        url: trainingCourses.url,
        mode: trainingCourses.mode,
        total: sql<number>`(SELECT COUNT(*)::int FROM training_codes c WHERE c.course_id = ${trainingCourses.id} AND c.retired_at IS NULL)`,
        assigned: sql<number>`(SELECT COUNT(*)::int FROM participant_training_access a WHERE a.course_id = ${trainingCourses.id} AND NOT EXISTS (SELECT 1 FROM audit_logs ta WHERE ta.target_id=a.participant_id AND ta.action='PARTICIPANT_TEST_ACCOUNT'))`,
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
      .select({
        id: materials.id,
        title: materials.title,
        published: materials.published,
      })
      .from(materials)
      .where(eq(materials.eventId, eventId)),
  ]);
  return {
    event: { ...event, materialsUnlocked: await materialsUnlocked(eventId) },
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
  database: Database = db(),
) {
  const value = z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      email: z.email().transform((v) => v.toLowerCase()),
      certificateNameOverride: z
        .string()
        .max(240)
        .regex(
          /^[\p{L}\p{M} .’'\-‐‑–]*$/u,
          "Wpisz imię i nazwisko w jednym wierszu.",
        )
        .transform((v) => v.normalize("NFC").replace(/ +/g, " ").trim())
        .refine(
          (v) => !/^dla(?: |$)/iu.test(v),
          "Wpisz samą odmienioną formę, bez słowa „dla”.",
        )
        .refine(
          (v) => !v || /\p{L}/u.test(v),
          "Korekta musi zawierać imię i nazwisko.",
        )
        .transform((v) => v || null)
        .nullable()
        .optional(),
    })
    .parse(input);
  return database.transaction(async (tx) => {
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
        .where(
          and(
            eq(emailLogs.participantId, id),
            sql`${emailLogs.status} IN ('QUEUED','SENDING')`,
          ),
        )
        .limit(1);
      assert(
        !mail,
        409,
        "Adresu nie można zmienić podczas oczekującej wysyłki. Najpierw rozlicz kolejkę.",
      );
    }
    const [p] = await tx
      .update(participants)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .returning({ id: participants.id });
    assert(p, 404, "Brak uczestnika.");
    await tx.insert(auditLogs).values({
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
    await tx
      .delete(privacyRequests)
      .where(
        and(
          eq(privacyRequests.eventId, eventId),
          eq(privacyRequests.participantId, id),
        ),
      );
    const rows = await tx
      .delete(participants)
      .where(and(eq(participants.id, id), eq(participants.eventId, eventId)))
      .returning({ id: participants.id });
    assert(rows.length, 404, "Brak uczestnika.");
    await tx.insert(auditLogs).values({
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
    await tx.delete(dataArchives).where(eq(dataArchives.eventId, eventId));
    await tx
      .delete(privacyRequests)
      .where(eq(privacyRequests.eventId, eventId));
    const rows = await tx
      .delete(participants)
      .where(eq(participants.eventId, eventId))
      .returning({ id: participants.id });
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "EVENT_PERSONAL_DATA_DELETED",
      targetId: eventId,
    });
    return { deleted: rows.length };
  });
}
