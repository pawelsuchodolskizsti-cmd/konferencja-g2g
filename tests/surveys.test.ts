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
  defaultSurveyQuestions,
  saveSurvey,
  submitSurvey,
  participantSurvey,
  exportSurvey,
} from "../src/server/surveys";
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
  for (const file of ["0000_initial", "0001_schema", "0002_schema"])
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
  expect(responses[0].answersEncrypted).not.toContain("Odpowiedź");
  expect(JSON.parse(decrypt(responses[0].answersEncrypted))).toEqual(
    input.answers,
  );
});
test("locks answered questions and exports ten answers with participant identity", async () => {
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
  expect(rows[0].slice(4)).toEqual(defaultSurveyQuestions);
  expect(rows[1].slice(0, 3)).toEqual(["Anna", "Testowa", "anna@example.org"]);
  expect(rows[1].slice(4)).toEqual(input.answers);
  await saveSurvey(eventId, adminId, {
    questions: defaultSurveyQuestions,
    published: false,
  });
  expect((await participantSurvey(person, atUnlock)).available).toBe(false);
});

