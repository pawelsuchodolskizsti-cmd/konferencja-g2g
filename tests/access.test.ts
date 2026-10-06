import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import type { Database } from "../src/db";
import { encrypt, newCredentials, hashToken } from "../src/server/crypto";
import { checkIn, certificateAvailable } from "../src/server/attendance";
import { participantCourses } from "../src/server/training";
import { generateCertificate } from "../src/server/certificates";
const pg = new PGlite();
const database = drizzle(pg);
const db = database as unknown as Database;
let eventId: string;
let adminId: string;
let p1: string;
let p2: string;
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "pepper".repeat(10);
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  const [a] = await database
    .insert(s.admins)
    .values({ email: "test@example.org", passwordHash: "unused" })
    .returning();
  adminId = a.id;
  const [e] = await database
    .insert(s.events)
    .values({
      slug: "access",
      name: "Konferencja testowa",
      organizer: "Fundacja Testowa",
      location: "Sala",
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2020-01-02"),
      certificateUnlockAt: new Date("2020-01-02"),
      mailFrom: "test@example.org",
    })
    .returning();
  eventId = e.id;
  const people = await database
    .insert(s.participants)
    .values(
      [1, 2].map((i) => ({
        eventId,
        firstName: "Żaneta",
        lastName: "Łącka",
        email: `synthetic${i}@example.org`,
        ...newCredentials(),
      })),
    )
    .returning();
  [p1, p2] = people.map((p) => p.id);
});
afterAll(async () => pg.close());
test("direct benefit calls reject absent participants", async () => {
  await expect(participantCourses(p1, db)).rejects.toThrow(
    "potwierdzeniu obecności",
  );
  await expect(generateCertificate(p1, db)).rejects.toThrow(
    "potwierdzeniu obecności",
  );
});
test("repeat check-in preserves timestamp and method", async () => {
  const one = await checkIn(eventId, adminId, { participantId: p1 }, db);
  const two = await checkIn(eventId, adminId, { participantId: p1 }, db);
  expect(one.alreadyPresent).toBe(false);
  expect(one.firstName).toBe("Żaneta");
  expect(one.lastName).toBe("Łącka");
  expect(two.firstName).toBe(one.firstName);
  expect(two.lastName).toBe(one.lastName);
  expect(two.alreadyPresent).toBe(true);
  expect(two.checkedInAt).toEqual(one.checkedInAt);
  expect(
    await database
      .select()
      .from(s.attendance)
      .where(eq(s.attendance.participantId, p1)),
  ).toHaveLength(1);
});
test("one individual code cannot reach two participants and assignment is stable", async () => {
  await checkIn(eventId, adminId, { participantId: p2 }, db);
  const [c] = await database
    .insert(s.trainingCourses)
    .values({
      eventId,
      name: "Kurs",
      platform: "Platforma",
      url: "https://example.org",
      mode: "INDIVIDUAL",
    })
    .returning();
  await database
    .insert(s.trainingCodes)
    .values({
      courseId: c.id,
      codeHash: hashToken("UNIQUE"),
      encryptedCode: encrypt("UNIQUE"),
    });
  expect((await participantCourses(p1, db))[0].code).toBe("UNIQUE");
  expect((await participantCourses(p1, db))[0].code).toBe("UNIQUE");
  expect((await participantCourses(p2, db))[0].available).toBe(false);
});
test("certificate requires both event end and configured unlock time", () => {
  const event = {
    endsAt: new Date("2030-01-01"),
    certificateUnlockAt: new Date("2030-01-02"),
  };
  expect(certificateAvailable(event, new Date("2030-01-01T12:00:00Z"))).toBe(
    false,
  );
  expect(certificateAvailable(event, new Date("2030-01-02"))).toBe(true);
});
