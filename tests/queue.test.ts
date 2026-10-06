import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
import { newCredentials } from "../src/server/crypto";
const fixture = vi.hoisted(() => ({ database: null as Database | null }));
vi.mock("@/db", () => ({ db: () => fixture.database }));
import { claimMail, processMail, queueInvitations } from "../src/server/mail";
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string;
let adminId: string;
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test".repeat(16);
  process.env.APP_ENV = "production";
  process.env.MAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "test-only";
  process.env.APP_URL = "https://conference.example.org";
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  fixture.database = database as unknown as Database;
  const [a] = await database
    .insert(s.admins)
    .values({ email: "admin@example.org", passwordHash: "unused" })
    .returning();
  adminId = a.id;
  const [e] = await database
    .insert(s.events)
    .values({
      slug: "queue",
      name: "Test",
      organizer: "Test",
      location: "Sala",
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2020-01-02"),
      certificateUnlockAt: new Date("2020-01-02"),
      mailFrom: "test@example.org",
    })
    .returning();
  eventId = e.id;
  await database
    .insert(s.participants)
    .values(
      [1, 2].map((i) => ({
        eventId,
        firstName: `Test${i}`,
        lastName: "Test",
        email: `test${i}@example.org`,
        ...newCredentials(),
      })),
    );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pg.close();
});
test("one provider failure does not stop the queue and retry reuses payload and key", async () => {
  expect(
    (await queueInvitations(eventId, adminId, fixture.database!)).queued,
  ).toBe(2);
  expect(
    (await queueInvitations(eventId, adminId, fixture.database!)).queued,
  ).toBe(0);
  const requests: { body: string; key: string }[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push({
        body: String(init.body),
        key: (init.headers as Record<string, string>)["Idempotency-Key"],
      });
      index++;
      return index === 1
        ? Response.json({ error: "temporary" }, { status: 503 })
        : Response.json({ id: `provider-${index}` });
    }),
  );
  expect(await processMail()).toEqual({ sent: 1, errors: 1 });
  const jobs = await database.select().from(s.emailLogs);
  expect(jobs.filter((j) => j.status === "SENT")).toHaveLength(1);
  const failed = jobs.find((j) => j.status === "QUEUED")!;
  expect(failed.payloadEncrypted).toBeTruthy();
  await database
    .update(s.events)
    .set({ name: "Changed after first attempt" })
    .where(eq(s.events.id, eventId));
  await database
    .update(s.emailLogs)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(s.emailLogs.id, failed.id));
  expect(await processMail()).toEqual({ sent: 1, errors: 0 });
  expect(requests[0]).toEqual(requests[2]);
});
test("expired lease older than provider idempotency window requires review", async () => {
  const [job] = await database.select().from(s.emailLogs).limit(1);
  await database
    .update(s.emailLogs)
    .set({
      status: "SENDING",
      firstAttemptAt: new Date(Date.now() - 25 * 3600000),
      leaseUntil: new Date(0),
      nextAttemptAt: new Date(0),
    })
    .where(eq(s.emailLogs.id, job.id));
  expect(await claimMail(fixture.database!)).toBeNull();
  const [result] = await database
    .select()
    .from(s.emailLogs)
    .where(eq(s.emailLogs.id, job.id));
  expect(result.status).toBe("ERROR");
  expect(result.errorCode).toBe("REVIEW_REQUIRED");
  expect(
    (await queueInvitations(eventId, adminId, fixture.database!)).queued,
  ).toBe(0);
});
