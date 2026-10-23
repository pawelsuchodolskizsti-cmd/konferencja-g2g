import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import * as schema from "../src/db/schema";
import { newCredentials, decrypt } from "../src/server/crypto";
const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db", () => ({ db: () => state.database }));
import {
  saveSurvey,
  submitSurvey,
  participantSurvey,
  exportSurvey,
} from "../src/server/surveys";
const defaultSurveyQuestions = Array.from(
  { length: 10 },
  (_, i) => `Pytanie ${i + 1}`,
);
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string;
let adminId: string;
let person: { id: string; eventId: string };
const beforeUnlock = new Date("2026-10-27T15:59:59Z");
const atUnlock = new Date("2026-10-27T16:00:00Z");
const input = {
  questions: defaultSurveyQuestions,
  answers: Array.from({ length: 10 }, (_, i) => `Odpowiedź ${i + 1}: ąęł`),
};
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "survey-test-".repeat(8);
  for (const file of [
    "0000_initial",
    "0001_schema",
    "0002_schema",
    "0003_schema",
    "0004_anonymous_survey",
    "0005_schema",
    "0006_schema",
    "0009_courses_unlock",
  ])
    await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  const [admin] = await database
    .insert(schema.admins)
    .values({ email: "admin@example.org", passwordHash: "test" })
    .returning();
  adminId = admin.id;
  const [event] = await database
    .insert(schema.events)
    .values({
      slug: "survey-test",
      name: "Test",
      organizer: "Fundacja",
      location: "Warszawa",
      startsAt: new Date("2026-10-27T09:00:00Z"),
      endsAt: new Date("2026-10-27T17:00:00Z"),
      certificateUnlockAt: new Date("2026-10-27T17:00:00Z"),
      mailFrom: "test@example.org",
    })
    .returning();
  eventId = event.id;
  await database.insert(schema.surveys).values({eventId, questions:defaultSurveyQuestions, published:false});
  const [participant] = await database
    .insert(schema.participants)
    .values({
      eventId,
      firstName: "Anna",
      lastName: "Testowa",
      email: "anna@example.org",
      ...newCredentials(),
    })
    .returning();
  person = participant;
});
afterAll(async () => pg.close());
test("test accounts complete the survey once without adding anonymous results", async () => {
  await saveSurvey(eventId, adminId, { questions: defaultSurveyQuestions, published: true });
  const [p] = await database.insert(schema.participants).values({ eventId, firstName: "Demo", lastName: "Test", email: "demo@example.test", ...newCredentials() }).returning();
  await database.insert(schema.auditLogs).values({ eventId, targetId: p.id, action: "PARTICIPANT_TEST_ACCOUNT" });
  await database.insert(schema.attendance).values({ participantId: p.id, method: "QR" });
  const before = await database.select().from(schema.surveyResponses);
  await expect(submitSurvey(p, input, atUnlock)).resolves.toEqual({ saved: true, test: true });
  await expect(submitSurvey(p, input, atUnlock)).rejects.toMatchObject({ status: 409 });
  expect(await database.select().from(schema.surveyResponses)).toEqual(before);
  expect((await participantSurvey(p, atUnlock)).submitted).toBe(true);
  // Keep the shared fixture's completion assertions independent of this test.
  await database.delete(schema.participants).where((await import("drizzle-orm")).eq(schema.participants.id, p.id));
});
test("requires ten questions and explicit publication", async () => {
  await expect(
    saveSurvey(eventId, adminId, { questions: ["Jedno"], published: true }),
  ).rejects.toThrow();
  await saveSurvey(eventId, adminId, {
    questions: defaultSurveyQuestions,
    published: false,
  });
  expect((await participantSurvey(person, atUnlock)).available).toBe(false);
  await expect(submitSurvey(person, input, atUnlock)).rejects.toMatchObject({
    status: 403,
  });
  await saveSurvey(eventId, adminId, {
    questions: defaultSurveyQuestions,
    published: true,
  });
});
test("server enforces Warsaw 17:00 boundary and confirmed attendance", async () => {
  expect((await participantSurvey(person, beforeUnlock)).available).toBe(false);
  await expect(submitSurvey(person, input, beforeUnlock)).rejects.toMatchObject(
    { status: 403 },
  );
  await expect(submitSurvey(person, input, atUnlock)).rejects.toMatchObject({
    status: 403,
  });
  await database
    .insert(schema.attendance)
    .values({ participantId: person.id, method: "QR" });
  expect((await participantSurvey(person, atUnlock)).available).toBe(true);
});
test("validates all answers and stale questions, encrypts and prevents duplicates", async () => {
  await expect(
    submitSurvey(person, { ...input, answers: Array(10).fill(" ") }, atUnlock),
  ).rejects.toThrow();
  await expect(
    submitSurvey(
      person,
      { ...input, answers: Array(10).fill("x".repeat(5001)) },
      atUnlock,
    ),
  ).rejects.toThrow();
  await expect(
    submitSurvey(
      person,
      { ...input, questions: defaultSurveyQuestions.map((q) => q + "!") },
      atUnlock,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const results = await Promise.allSettled([
    submitSurvey(person, input, atUnlock),
    submitSurvey(person, input, atUnlock),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const responses = await database.select().from(schema.surveyResponses);
  expect(responses).toHaveLength(1);
  expect(Object.keys(responses[0]).sort()).toEqual([
    "answersEncrypted",
    "eventId",
    "id",
    "questions",
  ]);
  expect((await participantSurvey(person, atUnlock)).submitted).toBe(true);
  const flags = await database.select().from(schema.surveyCompletions);
  expect(flags).toEqual([{ participantId: person.id }]);
  expect(responses[0].answersEncrypted).not.toContain("Odpowiedź");
  expect(JSON.parse(decrypt(responses[0].answersEncrypted))).toEqual(
    input.answers,
  );
});
test("locks answered questions and exports ten answers without participant identity", async () => {
  await expect(
    saveSurvey(eventId, adminId, {
      questions: defaultSurveyQuestions.map((q) => q + "!"),
      published: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const response = await exportSurvey(eventId, adminId);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const book = XLSX.read(Buffer.from(await response.arrayBuffer()), {
    type: "buffer",
  });
  const rows = XLSX.utils.sheet_to_json<string[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1 },
  );
  expect(rows[0]).toEqual(defaultSurveyQuestions);
  expect(JSON.stringify(rows)).not.toContain("anna@example.org");
  expect(rows[1]).toEqual(input.answers);
  await saveSurvey(eventId, adminId, {
    questions: defaultSurveyQuestions,
    published: false,
  });
  expect((await participantSurvey(person, atUnlock)).available).toBe(false);
});

test("nine-question survey validates seven ratings, stores answers and exports without hotel", async () => {
  const { surveyDefinition, emptyAnswer } =
    await import("../src/lib/survey-definition");
  const questions = surveyDefinition.map((q) => q.title);
  const [source] = await database.select().from(schema.events);
  const [event] = await database
    .insert(schema.events)
    .values({ ...source, id: undefined, slug: "current-survey" })
    .returning();
  // An existing published 11-question form is projected to the current form.
  await database.insert(schema.surveys).values({
    eventId: event.id,
    questions: [
      ...questions,
      "Hotel Presidential",
      "Powód rezygnacji z hotelu",
    ],
    published: true,
  });
  const [p] = await database
    .insert(schema.participants)
    .values({
      eventId: event.id,
      firstName: "Test",
      lastName: "Ankiety",
      email: "current@example.test",
      ...newCredentials(),
    })
    .returning();
  await database
    .insert(schema.attendance)
    .values({ participantId: p.id, method: "QR" });
  expect((await participantSurvey(p, atUnlock)).questions).toEqual(questions);
  const answers = surveyDefinition.map((q) => ({
    ...emptyAnswer(),
    ...(q.kind === "text"
      ? { text: q.optional ? "" : "Ćwiczenia" }
      : q.kind === "matrix"
        ? { ratings: q.rows!.map((_, i) => q.options![i % q.options!.length]) }
        : { selected: [q.options![0]] }),
  }));
  await expect(
    submitSurvey(
      p,
      {
        questions,
        answers: answers.map((a, i) =>
          i === 2 ? { ...a, ratings: [...a.ratings, a.ratings[0]] } : a,
        ),
      },
      atUnlock,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    submitSurvey(p, { questions, answers }, atUnlock),
  ).resolves.toEqual({ saved: true });
  await saveSurvey(event.id, adminId, { questions, published: false });
  const exported = await exportSurvey(event.id, adminId);
  const book = XLSX.read(Buffer.from(await exported.arrayBuffer()), {
    type: "buffer",
  });
  const rows = XLSX.utils.sheet_to_json<string[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1 },
  );
  expect(rows[0]).toEqual([
    ...questions.slice(0, 2),
    ...surveyDefinition[2].rows!.map((row) => `${questions[2]} - ${row}`),
    ...questions.slice(3),
  ]);
  expect(rows[1].slice(2, 9)).toEqual(answers[2].ratings);
  expect(rows[1]).toHaveLength(15);
  const csv = await (await exportSurvey(event.id, adminId, "csv")).text();
  const csvBook = XLSX.read(csv, { type: "string", FS: ";", raw: true });
  const csvRows = XLSX.utils.sheet_to_json<string[]>(
    csvBook.Sheets[csvBook.SheetNames[0]],
    { header: 1, defval: "" },
  );
  expect(csvRows).toEqual(rows);
});

