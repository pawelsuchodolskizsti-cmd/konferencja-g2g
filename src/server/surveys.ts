import "server-only";
import { and, asc, eq, count } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db, type Database } from "@/db";
import {
  attendance,
  events,
  participants,
  surveys,
  surveyResponses,
  auditLogs,
} from "@/db/schema";
import { encrypt, decrypt } from "./crypto";
import { assert } from "./errors";

import {
  surveyDefinition,
  definitionFor,
  answerError,
  formatAnswer,
} from "@/lib/survey-definition";
export const defaultSurveyQuestions = surveyDefinition.map((q) => q.title);
const questionList = z
  .array(z.string().trim().min(1).max(500))
  .refine((q) => q.length === 10 || q.length === 11);
const answerSchema = z
  .object({
    text: z.string().max(5000),
    selected: z.array(z.string().max(500)).max(2),
    ratings: z.array(z.string().max(100)).max(8),
  })
  .strict();
const answersList = z.union([
  z.array(z.string().trim().max(5000)).length(10),
  z.array(answerSchema).length(11),
]);
export function surveyUnlockAt(event: { endsAt: Date }) {
  return new Date(event.endsAt.getTime() - 60 * 60 * 1000);
}
export async function surveyOverview(
  eventId: string,
  database: Database = db(),
) {
  const [[survey], [total], [event]] = await Promise.all([
    database.select().from(surveys).where(eq(surveys.eventId, eventId)),
    database
      .select({ value: count() })
      .from(surveyResponses)
      .where(eq(surveyResponses.eventId, eventId)),
    database
      .select({ endsAt: events.endsAt })
      .from(events)
      .where(eq(events.id, eventId)),
  ]);
  assert(event, 404, "Brak konferencji.");
  return {
    questions: survey?.questions ?? defaultSurveyQuestions,
    published: survey?.published ?? false,
    responseCount: total.value,
    unlockAt: surveyUnlockAt(event).toISOString(),
  };
}
export async function saveSurvey(
  eventId: string,
  adminId: string,
  input: unknown,
  database: Database = db(),
) {
  const data = z
    .object({ questions: questionList, published: z.boolean() })
    .parse(input);
  return database.transaction(async (tx) => {
    // Serialize question changes and submissions for this conference.
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(surveys)
      .where(eq(surveys.eventId, eventId));
    const [response] = await tx
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(eq(surveyResponses.eventId, eventId))
      .limit(1);
    assert(
      !response ||
        JSON.stringify(existing?.questions) === JSON.stringify(data.questions),
      409,
      "Po otrzymaniu odpowiedzi nie można zmieniać pytań. Możesz zamknąć lub ponownie udostępnić ankietę.",
    );
    await tx
      .insert(surveys)
      .values({ eventId, ...data })
      .onConflictDoUpdate({
        target: surveys.eventId,
        set: { ...data, updatedAt: new Date() },
      });
    await tx
      .insert(auditLogs)
      .values({ eventId, adminId, action: "SURVEY_UPDATED" });
    return { saved: true };
  });
}
export async function participantSurvey(
  person: { id: string; eventId: string },
  now = new Date(),
  database: Database = db(),
) {
  const info = await surveyOverview(person.eventId, database);
  const [response] = await database
    .select({ submittedAt: surveyResponses.submittedAt })
    .from(surveyResponses)
    .where(eq(surveyResponses.participantId, person.id));
  return {
    ...info,
    available: info.published && now >= new Date(info.unlockAt),
    submittedAt: response?.submittedAt.toISOString() ?? null,
  };
}
export async function submitSurvey(
  person: { id: string; eventId: string },
  input: unknown,
  now = new Date(),
  database: Database = db(),
) {
  const data = z
    .object({
      answers: answersList,
      questions: questionList,
      hotel: z.enum(["yes", "no"]).optional(),
    })
    .parse(input);
  return database.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, person.eventId))
      .for("update");
    assert(
      event && now >= surveyUnlockAt(event),
      403,
      "Ankieta będzie dostępna od 17:00 w dniu konferencji.",
    );
    const [present] = await tx
      .select()
      .from(attendance)
      .where(eq(attendance.participantId, person.id));
    assert(present, 403, "Ankieta jest dostępna po potwierdzeniu obecności.");
    const [survey] = await tx
      .select()
      .from(surveys)
      .where(eq(surveys.eventId, person.eventId));
    assert(survey?.published, 403, "Ankieta nie jest obecnie dostępna.");
    assert(
      JSON.stringify(survey.questions) === JSON.stringify(data.questions),
      409,
      "Pytania zostały zmienione. Odśwież stronę przed wysłaniem odpowiedzi.",
    );
    let formatted: string[];
    if (survey.questions.length === 11) {
      assert(
        data.hotel,
        400,
        "Wskaż, czy korzystałeś/aś z proponowanego hotelu.",
      );
      assert(
        data.answers.length === 11 &&
          data.answers.every((a) => typeof a !== "string"),
        400,
        "Nieprawidłowy format odpowiedzi.",
      );
      const definitions = definitionFor(survey.questions);
      formatted = definitions.map((q, i) => {
        const skipped =
          (i === 9 && data.hotel === "no") ||
          (i === 10 && data.hotel === "yes");
        const answer = answerSchema.parse(data.answers[i]);
        if (skipped) {
          assert(
            !answer.text && !answer.selected.length && !answer.ratings.length,
            400,
            "Odpowiedz tylko na właściwe pytanie o hotel.",
          );
          return "Nie dotyczy";
        }
        const error = answerError(q, answer);
        assert(!error, 400, `Pytanie ${i + 1}: ${error}`);
        return formatAnswer(q, answer);
      });
    } else {
      assert(
        data.answers.length === 10 &&
          data.answers.every((a) => typeof a === "string" && a.trim()),
        400,
        "Odpowiedz na wszystkie pytania.",
      );
      formatted = data.answers as string[];
    }
    const [saved] = await tx
      .insert(surveyResponses)
      .values({
        eventId: person.eventId,
        participantId: person.id,
        questions: survey.questions,
        answersEncrypted: encrypt(JSON.stringify(formatted)),
        submittedAt: now,
      })
      .onConflictDoNothing({ target: surveyResponses.participantId })
      .returning({ id: surveyResponses.id });
    assert(saved, 409, "Twoja ankieta została już wysłana.");
    return { saved: true };
  });
}
export async function exportSurvey(eventId: string, adminId: string) {
  const responses = await db()
    .select({
      firstName: participants.firstName,
      lastName: participants.lastName,
      email: participants.email,
      submittedAt: surveyResponses.submittedAt,
      questions: surveyResponses.questions,
      answersEncrypted: surveyResponses.answersEncrypted,
    })
    .from(surveyResponses)
    .innerJoin(
      participants,
      and(
        eq(participants.id, surveyResponses.participantId),
        eq(participants.eventId, eventId),
      ),
    )
    .where(eq(surveyResponses.eventId, eventId))
    .orderBy(asc(surveyResponses.submittedAt));
  const info = await surveyOverview(eventId);
  const rows = [
    [
      "Imię",
      "Nazwisko",
      "E-mail",
      "Data wysłania (Europe/Warsaw)",
      ...info.questions,
    ],
    ...responses.map((r) => [
      r.firstName,
      r.lastName,
      r.email,
      new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Europe/Warsaw",
      }).format(r.submittedAt),
      ...JSON.parse(decrypt(r.answersEncrypted)),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    22,
    28,
    40,
    28,
    ...Array(info.questions.length).fill(60),
  ].map((wch) => ({
    wch,
  }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Odpowiedzi ankiety");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  await db()
    .insert(auditLogs)
    .values({ eventId, adminId, action: "SURVEY_EXPORTED" });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="odpowiedzi-ankiety.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
