import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/db";
import {
  attendance,
  auditLogs,
  participants,
  participantTrainingAccess,
  trainingCodes,
  trainingCourses,
} from "@/db/schema";
import { decrypt, encrypt, hashToken } from "./crypto";
import { assert } from "./errors";
import { presentParticipant } from "./attendance";
import { spreadsheet } from "./imports";

export const courseInput = z.object({
  name: z.string().trim().min(2).max(160),
  platform: z.string().trim().min(2).max(160),
  url: z
    .url()
    .refine(
      (v) => new URL(v).protocol === "https:",
      "Adres musi zaczynać się od https://",
    ),
  mode: z.enum(["SHARED", "INDIVIDUAL"]),
  sharedCode: z.string().max(300).optional(),
});
export async function createCourse(
  eventId: string,
  adminId: string,
  input: unknown,
) {
  const value = courseInput.parse(input);
  return db().transaction(async (tx) => {
    const [course] = await tx
      .insert(trainingCourses)
      .values({
        ...value,
        eventId,
        sharedCode: value.sharedCode ? encrypt(value.sharedCode) : null,
      })
      .returning({ id: trainingCourses.id });
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "COURSE_CREATED",
        targetId: course.id,
      });
    return course;
  });
}
export async function updateCourse(
  eventId: string,
  adminId: string,
  courseId: string,
  input: unknown,
) {
  const value = courseInput.parse(input);
  return db().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trainingCourses)
      .where(
        and(
          eq(trainingCourses.id, courseId),
          eq(trainingCourses.eventId, eventId),
        ),
      )
      .for("update");
    assert(existing, 404, "Nie znaleziono szkolenia.");
    assert(
      existing.mode === value.mode,
      409,
      "Model dostępu jest stały. Dodaj osobne szkolenie, aby zastosować inny model.",
    );
    await tx
      .update(trainingCourses)
      .set({
        ...value,
        sharedCode: value.sharedCode
          ? encrypt(value.sharedCode)
          : existing.sharedCode,
      })
      .where(eq(trainingCourses.id, courseId));
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "COURSE_UPDATED",
        targetId: courseId,
      });
    return { id: courseId };
  });
}
export async function importCodes(
  eventId: string,
  adminId: string,
  courseId: string,
  file: File,
) {
  const [course] = await db()
    .select()
    .from(trainingCourses)
    .where(
      and(
        eq(trainingCourses.id, courseId),
        eq(trainingCourses.eventId, eventId),
      ),
    );
  assert(
    course?.mode === "INDIVIDUAL",
    400,
    "Wybierz kurs z indywidualnymi kodami.",
  );
  const rows = await spreadsheet(file, true);
  assert(
    ["kod", "code"].includes(rows[0]?.[0]?.toLowerCase()),
    400,
    "Pierwsza kolumna powinna mieć nagłówek Kod.",
  );
  const codes = rows
    .slice(1)
    .map((row) => z.string().trim().min(1).max(300).parse(row[0]));
  assert(codes.length, 400, "Brak kodów.");
  return db().transaction(async (tx) => {
    const result = await tx
      .insert(trainingCodes)
      .values(
        codes.map((code) => ({
          courseId,
          codeHash: hashToken(code),
          encryptedCode: encrypt(code),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: trainingCodes.id });
    await tx
      .insert(auditLogs)
      .values({
        eventId,
        adminId,
        action: "TRAINING_CODES_IMPORTED",
        targetId: courseId,
      });
    return { imported: result.length, skipped: codes.length - result.length };
  });
}
export async function participantCourses(
  participantId: string,
  database: Database = db(),
) {
  const { person } = await presentParticipant(participantId, database);
  const courses = await database
    .select()
    .from(trainingCourses)
    .where(eq(trainingCourses.eventId, person.eventId));
  const result = [];
  for (const course of courses) {
    let code: string | null = null;
    if (course.mode === "SHARED")
      code = course.sharedCode ? decrypt(course.sharedCode) : null;
    else
      code = await database.transaction(async (tx) => {
        // Serialize assignments for this participant, then lock a free code across all participants.
        await tx
          .select({ id: participants.id })
          .from(participants)
          .where(eq(participants.id, participantId))
          .for("update");
        const [present] = await tx
          .select()
          .from(attendance)
          .where(eq(attendance.participantId, participantId));
        assert(present, 403, "Obecność nie została potwierdzona.");
        const [existing] = await tx
          .select({ value: trainingCodes.encryptedCode })
          .from(participantTrainingAccess)
          .innerJoin(
            trainingCodes,
            eq(trainingCodes.id, participantTrainingAccess.codeId),
          )
          .where(
            and(
              eq(participantTrainingAccess.participantId, participantId),
              eq(participantTrainingAccess.courseId, course.id),
            ),
          );
        if (existing) return decrypt(existing.value);
        const [free] = await tx
          .select()
          .from(trainingCodes)
          .where(
            and(
              eq(trainingCodes.courseId, course.id),
              sql`${trainingCodes.retiredAt} IS NULL`,
              sql`NOT EXISTS (SELECT 1 FROM participant_training_access a WHERE a.code_id = ${trainingCodes.id})`,
            ),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!free) return null;
        await tx
          .insert(participantTrainingAccess)
          .values({ participantId, courseId: course.id, codeId: free.id });
        await tx
          .insert(auditLogs)
          .values({
            eventId: person.eventId,
            action: "TRAINING_CODE_ASSIGNED",
            targetId: participantId,
          });
        return decrypt(free.encryptedCode);
      });
    result.push({
      id: course.id,
      name: course.name,
      platform: course.platform,
      url: course.url,
      mode: course.mode,
      code,
      available: course.mode === "SHARED" || !!code,
    });
  }
  return result;
}
