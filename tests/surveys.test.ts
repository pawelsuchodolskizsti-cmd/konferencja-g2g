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

test("mixed survey stores readable choices and ratings, validates hotel branches and exports", async () => {
  const { surveyDefinition, emptyAnswer, formatAnswer } =
    await import("../src/lib/survey-definition");
  const questions = surveyDefinition.map((q) => q.title);
  const [source] = await database.select().from(schema.events);
  const [event] = await database
    .insert(schema.events)
    .values({ ...source, id: undefined, slug: "mixed-survey" })
    .returning();
  await saveSurvey(event.id, adminId, { questions, published: true });
  const answers = surveyDefinition.map((q) => ({
    ...emptyAnswer(),
    ...(q.kind === "text"
      ? { text: q.optional ? "" : "Wykorzystam ćwiczenia" }
      : q.kind === "matrix"
        ? { ratings: q.rows!.map(() => q.options![4]) }
        : { selected: [q.options![0]] }),
  }));
  answers[10] = emptyAnswer();
  const [p] = await database
    .insert(schema.participants)
    .values({
      eventId: event.id,
      firstName: "Test",
      lastName: "Hotel",
      email: "mixed@example.org",
      ...newCredentials(),
    })
    .returning();
  await database
    .insert(schema.attendance)
    .values({ participantId: p.id, method: "QR" });
  const body = { questions, answers, hotel: "yes" };
  await expect(
    submitSurvey(p, { ...body, hotel: undefined }, atUnlock),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    submitSurvey(
      p,
      {
        ...body,
        answers: answers.map((a, i) =>
          i === 3
            ? { ...a, selected: surveyDefinition[3].options!.slice(0, 3) }
            : a,
        ),
      },
      atUnlock,
    ),
  ).rejects.toThrow();
  await expect(
    submitSurvey(
      p,
      {
        ...body,
        answers: answers.map((a, i) =>
          i === 10 ? { ...a, selected: [surveyDefinition[10].options![0]] } : a,
        ),
      },
      atUnlock,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await submitSurvey(p, body, atUnlock);
  const exported = await exportSurvey(event.id, adminId);
  const book = XLSX.read(Buffer.from(await exported.arrayBuffer()), {
    type: "buffer",
  });
  const rows = XLSX.utils.sheet_to_json<string[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1 },
  );
  expect(rows[0]).toHaveLength(11);
  expect(rows[1][2]).toBe(formatAnswer(surveyDefinition[2], answers[2]));
  expect(rows[1][8]).toBe("");
  expect(rows[1][10]).toBe("Nie dotyczy");
  const [other] = await database
    .insert(schema.participants)
    .values({
      eventId: event.id,
      firstName: "Test",
      lastName: "Bez hotelu",
      email: "nohotel@example.org",
      ...newCredentials(),
    })
    .returning();
  await database
    .insert(schema.attendance)
    .values({ participantId: other.id, method: "QR" });
  const noHotel = answers.map((a, i) =>
    i === 9
      ? emptyAnswer()
      : i === 10
        ? {
            ...emptyAnswer(),
            selected: surveyDefinition[10].options!.slice(0, 2),
          }
        : a,
  );
  await expect(
    submitSurvey(other, { questions, answers: noHotel, hotel: "no" }, atUnlock),
  ).resolves.toEqual({ saved: true });
});
