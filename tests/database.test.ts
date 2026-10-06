import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/pglite";
import * as s from "../src/db/schema";
import { newCredentials } from "../src/server/crypto";
const pg = new PGlite();
const db = drizzle(pg);
let eventId: string;
let participantId: string;
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper-".repeat(8);
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  const [e] = await db
    .insert(s.events)
    .values({
      slug: "test",
      name: "Test",
      organizer: "Fundacja",
      location: "Sala",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2026-10-02"),
      certificateUnlockAt: new Date("2026-10-02"),
      mailFrom: "test@example.org",
    })
    .returning();
  eventId = e.id;
  const [p] = await db
    .insert(s.participants)
    .values({
      eventId,
      firstName: "Test",
      lastName: "Test",
      email: "test@example.org",
      ...newCredentials(),
    })
    .returning();
  participantId = p.id;
});
afterAll(async () => {
  await pg.close();
});
test("migration enforces one attendance record and one email per event", async () => {
  await db.insert(s.attendance).values({ participantId, method: "QR" });
  await expect(
    db.insert(s.attendance).values({ participantId, method: "MANUAL" }),
  ).rejects.toThrow();
  await expect(
    db.insert(s.participants).values({
      eventId,
      firstName: "A",
      lastName: "B",
      email: "test@example.org",
      ...newCredentials(),
    }),
  ).rejects.toThrow();
});
test("database disallows certificates unlocking before event ends", async () => {
  await expect(
    db.insert(s.events).values({
      slug: "invalid",
      name: "Test",
      organizer: "Fundacja",
      location: "Sala",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2026-10-02"),
      certificateUnlockAt: new Date("2026-10-01"),
      mailFrom: "test@example.org",
    }),
  ).rejects.toThrow();
});

test("import retries a colliding access code without skipping a new participant", async () => {
  const crypto = await import("../src/server/crypto");
  const { commitImport } = await import("../src/server/imports");
  const [existing] = await db.select().from(s.participants);
  const fresh = crypto.newCredentials();
  const generate = vi
    .spyOn(crypto, "newCredentials")
    .mockReturnValueOnce({ ...fresh, accessHash: existing.accessHash })
    .mockReturnValueOnce(fresh);
  try {
    const [admin] = await db
      .insert(s.admins)
      .values({ email: "import@example.org", passwordHash: "test" })
      .returning();
    const [batch] = await db
      .insert(s.importBatches)
      .values({
        eventId,
        adminId: admin.id,
        expiresAt: new Date(Date.now() + 60000),
        rows: [
          {
            row: 2,
            firstName: "New",
            lastName: "Participant",
            email: "new@example.org",
            errors: [],
          },
        ],
      })
      .returning();
    const result = await commitImport(
      batch.id,
      eventId,
      admin.id,
      db as unknown as import("../src/db").Database,
    );
    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
    const people = await db.select().from(s.participants);
    expect(new Set(people.map((p) => p.accessHash)).size).toBe(people.length);
  } finally {
    generate.mockRestore();
  }
});
