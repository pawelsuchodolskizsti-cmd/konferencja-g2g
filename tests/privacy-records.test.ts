import { beforeAll, afterAll, test, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
import { newCredentials } from "../src/server/crypto";
import {
  privacyRecords,
  exportPrivacyRecords,
} from "../src/server/privacy-records";
import { PARTICIPANT_PRIVACY_ACTION } from "../src/lib/participant-privacy";
const pg = new PGlite();
const database = drizzle(pg);
const db = database as unknown as Database;
let eventId: string;
let personId: string;
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test".repeat(20);
  for (const {tag: file} of JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")).entries)
    await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  for (const [index, slug] of ["privacy", "other-event"].entries()) {
    const [event] = await database
      .insert(s.events)
      .values({
        slug,
        name: slug,
        organizer: "Test",
        location: "Sala",
        startsAt: new Date("2026-10-27T09:00:00Z"),
        endsAt: new Date("2026-10-27T17:00:00Z"),
        certificateUnlockAt: new Date("2026-10-27T17:00:00Z"),
        mailFrom: "test@example.org",
      })
      .returning();
    const [person] = await database
      .insert(s.participants)
      .values({
        ...newCredentials(),
        eventId: event.id,
        firstName: index ? "Other" : "=FORMULA",
        lastName: "Test",
        email: index ? "other@example.org" : "test@example.org",
      })
      .returning();
    await database.insert(s.auditLogs).values([
      {
        eventId: event.id,
        targetId: person.id,
        action: PARTICIPANT_PRIVACY_ACTION,
        createdAt: new Date("2026-10-16T10:00:00Z"),
      },
      {
        eventId: event.id,
        targetId: person.id,
        action: PARTICIPANT_PRIVACY_ACTION,
        createdAt: new Date("2026-10-16T11:00:00Z"),
      },
      {
        eventId: event.id,
        targetId: person.id,
        action: "PARTICIPANT_PRIVACY_ACK_old",
        createdAt: new Date("2026-10-15T10:00:00Z"),
      },
    ]);
    if (index === 0) {
      eventId = event.id;
      personId = person.id;
      await database
        .insert(s.participants)
        .values({
          ...newCredentials(),
          eventId,
          firstName: "Bez",
          lastName: "Potwierdzenia",
          email: "missing@example.org",
        });
    }
  }
});
afterAll(async () => pg.close());
test("privacy report counts current version per participant and scopes to event", async () => {
  const result = await privacyRecords(eventId, db);
  expect(result.people).toHaveLength(2);
  const person = result.people.find((p) => p.id === personId)!;
  expect(person.count).toBe(2);
  expect(new Date(person.firstAcknowledgedAt!).toISOString()).toBe(
    "2026-10-16T10:00:00.000Z",
  );
  expect(new Date(person.lastAcknowledgedAt!).toISOString()).toBe(
    "2026-10-16T11:00:00.000Z",
  );
  const missing = result.people.find((p) => p.id !== personId)!;
  expect(missing.count).toBe(0);
  expect(missing.firstAcknowledgedAt).toBeNull();
});
test("privacy export includes every version, escapes spreadsheet formulas and excludes other events", async () => {
  const response = await exportPrivacyRecords(eventId, db);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const csv = await response.text();
  expect(csv.split("\r\n")).toHaveLength(4);
  expect(csv).toContain("old");
  expect(csv).toContain("'=FORMULA");
  expect(csv).not.toContain("other@example.org");
  expect(csv).not.toContain("missing@example.org");
});

