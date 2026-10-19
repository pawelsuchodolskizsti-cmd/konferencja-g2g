import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
import { newCredentials } from "../src/server/crypto";

const fixture = vi.hoisted(() => ({ database: null as Database | null }));
vi.mock("@/db", () => ({ db: () => fixture.database }));
import { smtpOverview, saveSmtpPassword, startSmtpCampaign } from "../src/server/smtp-campaign";

const pg = new PGlite();
const database = drizzle(pg);
let eventId: string;
let adminId: string;

beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test".repeat(16);
  process.env.APP_ENV = "production";
  process.env.APP_URL = "https://conference.example.org";
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0005_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0006_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0008_smtp_campaign.sql", "utf8"));
  fixture.database = database as unknown as Database;
  const [admin] = await database.insert(s.admins)
    .values({ email: "admin@example.org", passwordHash: "test" }).returning();
  adminId = admin.id;
  const [event] = await database.insert(s.events).values({
    slug: "smtp-test", name: "Głowa do Góry", organizer: "Fundacja",
    location: "Sala", startsAt: new Date("2027-01-01"),
    endsAt: new Date("2027-01-02"), certificateUnlockAt: new Date("2027-01-02"),
    mailFrom: "konferencja@oneday.com.pl",
  }).returning();
  eventId = event.id;
  await database.insert(s.participants).values([
    { eventId, firstName: "Jan", lastName: "Test", email: "shared@example.org", ...newCredentials() },
    { eventId, firstName: "Ewa", lastName: "Test", email: "shared@example.org", ...newCredentials() },
  ]);
});
afterAll(async () => { await pg.close(); });

test("password saves encrypted, without queueing or sending mail", async () => {
  await saveSmtpPassword(eventId, adminId, { password: "synthetic-test-password" });
  const [config] = await database.select().from(s.smtpSettings);
  expect(config.passwordEncrypted).not.toContain("synthetic-test-password");
  expect(await database.select().from(s.emailLogs)).toHaveLength(0);
});
test("each participant with the same email gets a separate queued invitation", async () => {
  const state = await smtpOverview(eventId);
  expect(state.total).toBe(2);
  expect(state.uniqueEmails).toBe(1);
  expect(state.duplicateRecipients).toBe(1);
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(2);
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(0);
  const logs = await database.select().from(s.emailLogs);
  expect(logs).toHaveLength(2);
  expect(new Set(logs.map(log => log.participantId)).size).toBe(2);
  expect(logs.every(log => log.status === "QUEUED")).toBe(true);
});
