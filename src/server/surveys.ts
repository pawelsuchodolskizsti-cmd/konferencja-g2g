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

export const defaultSurveyQuestions = [
  "Co było dla Ciebie najbardziej wartościowe podczas konferencji?",
  "Które wystąpienie szczególnie zapadło Ci w pamięć i dlaczego?",
  "Jakie pomysły lub narzędzia zamierzasz wykorzystać w swojej pracy?",
  "Jak oceniasz dobór tematów do swoich potrzeb?",
  "Czego zabrakło Ci w programie konferencji?",
  "Co możemy poprawić w organizacji kolejnego wydarzenia?",
  "Jak oceniasz atmosferę i możliwość wymiany doświadczeń?",
  "Jakie tematy chciałabyś lub chciałbyś omówić na kolejnej konferencji?",
  "Jakiego wsparcia potrzebujesz w swojej codziennej pracy?",
  "Jakie dodatkowe uwagi lub sugestie chcesz nam przekazać?",
];
const questionList = z
  .array(z.string().trim().min(1, "Wpisz treść każdego pytania.").max(500))
  .length(10);
const answersList = z
  .array(
    z
      .string()
      .trim()
      .min(1, "Odpowiedz na wszystkie pytania.")
      .max(5000, "Odpowiedź może mieć najwyżej 5000 znaków."),
  )
  .length(10);
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
    .object({ answers: answersList, questions: questionList })
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
    const [saved] = await tx
      .insert(surveyResponses)
      .values({
        eventId: person.eventId,
        participantId: person.id,
        questions: survey.questions,
        answersEncrypted: encrypt(JSON.stringify(data.answers)),
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
    ...responses.map((r) =>
      [
        r.firstName,
        r.lastName,
        r.email,
        new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "short",
          timeStyle: "medium",
          timeZone: "Europe/Warsaw",
        }).format(r.submittedAt),
        ...JSON.parse(decrypt(r.answersEncrypted)),
      ],
    ),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [22, 28, 40, 28, ...Array(10).fill(60)].map((wch) => ({
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

