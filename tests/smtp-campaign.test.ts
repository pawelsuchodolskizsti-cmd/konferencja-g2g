import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
import { decrypt, newCredentials } from "../src/server/crypto";

const fixture = vi.hoisted(() => ({
  database: null as Database | null,
  sent: [] as { to: string; html: string; attachments?: unknown[] }[],
}));
vi.mock("@/db", () => ({ db: () => fixture.database }));
vi.mock("../src/server/smtp-transport", () => ({
  sendSmtp: vi.fn(
    async (payload: { to: string; html: string; attachments?: unknown[] }) => {
      fixture.sent.push(payload);
    },
  ),
  verifySmtp: vi.fn(async () => undefined),
}));
import { sendSmtp } from "../src/server/smtp-transport";
import { SmtpFailure } from "../src/server/smtp-message";
import {
  smtpOverview,
  saveSmtpPassword,
  startSmtpCampaign,
  processSmtpBatch,
} from "../src/server/smtp-campaign";

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
  await pg.exec(await readFile("drizzle/0009_courses_unlock.sql", "utf8"));
  fixture.database = database as unknown as Database;
  const [admin] = await database
    .insert(s.admins)
    .values({ email: "admin@example.org", passwordHash: "test" })
    .returning();
  adminId = admin.id;
  const [event] = await database
    .insert(s.events)
    .values({
      slug: "smtp-test",
      name: "Głowa do Góry",
      organizer: "Fundacja",
      location: "Sala",
      startsAt: new Date("2027-01-01"),
      endsAt: new Date("2027-01-02"),
      certificateUnlockAt: new Date("2027-01-02"),
      mailFrom: "konferencja@oneday.com.pl",
    })
    .returning();
  eventId = event.id;
  await database.insert(s.participants).values([
    {
      eventId,
      firstName: "Jan",
      lastName: "Test",
      email: "shared@example.org",
      ...newCredentials(),
    },
    {
      eventId,
      firstName: "Ewa",
      lastName: "Test",
      email: "shared@example.org",
      ...newCredentials(),
    },
  ]);
});
afterAll(async () => {
  await pg.close();
});

test("password saves encrypted, without queueing or sending mail", async () => {
  await saveSmtpPassword(eventId, adminId, {
    password: "synthetic-test-password",
  });
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
  expect(new Set(logs.map((log) => log.participantId)).size).toBe(2);
  expect(logs.every((log) => log.status === "QUEUED")).toBe(true);
});

test("250 participant invitations survive 10 concurrent mock-SMTP workers with duplicate addresses", async () => {
  const [stressEvent] = await database
    .insert(s.events)
    .values({
      slug: "smtp-stress",
      name: "Głowa do Góry",
      organizer: "Fundacja",
      location: "Sala",
      startsAt: new Date("2027-04-01"),
      endsAt: new Date("2027-04-02"),
      certificateUnlockAt: new Date("2027-04-02"),
      mailFrom: "konferencja@oneday.com.pl",
    })
    .returning();
  const event = stressEvent.id;
  const rows = Array.from({ length: 250 }, (_, index) => ({
    eventId: event,
    firstName: `Uczestnik${index + 1}`,
    lastName: "Testowy",
    email: `shared${String(index % 25).padStart(2, "0")}@example.org`,
    ...newCredentials(),
  }));
  await database.insert(s.participants).values(rows);
  await saveSmtpPassword(event, adminId, { password: "synthetic-only" });

  const pending = await smtpOverview(event);
  expect(pending.total).toBe(250);
  expect(pending.uniqueEmails).toBe(25);
  expect(pending.duplicateRecipients).toBe(225);
  expect((await startSmtpCampaign(event, adminId)).queued).toBe(250);
  expect((await startSmtpCampaign(event, adminId)).queued).toBe(0);
  fixture.sent.length = 0;

  for (let round = 0; round < 5; round++) {
    await Promise.all(
      Array.from({ length: 10 }, () => processSmtpBatch(event, adminId)),
    );
  }
  const final = await smtpOverview(event);
  expect(final.queued).toBe(0);
  expect(final.errors).toBe(0);
  expect(final.sent).toBe(250);
  expect(fixture.sent).toHaveLength(250);
  expect(new Set(fixture.sent.map((payload) => payload.to)).size).toBe(25);
  expect(
    fixture.sent.every(
      (payload) =>
        !payload.attachments?.length &&
        payload.html.includes("/uczestnik") &&
        !payload.html.includes("cid:") &&
        !payload.html.includes("<img"),
    ),
  ).toBe(true);

  const people = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.eventId, event));
  const codes = people.map(
    (person) =>
      (JSON.parse(decrypt(person.credentials)) as { accessCode: string })
        .accessCode,
  );
  expect(new Set(codes).size).toBe(250);
  for (const code of codes) {
    expect(
      fixture.sent.filter((payload) =>
        payload.html.includes(`<strong>${code}</strong>`),
      ),
    ).toHaveLength(1);
  }
}, 180000);

test("SMTP diagnostics retain safe failure code and message ID without retrying accepted or failed invitations", async () => {
  vi.mocked(sendSmtp).mockRejectedValueOnce(
    new SmtpFailure("RECIPIENT", 550, "5.1.1"),
  );
  const result = await processSmtpBatch(eventId, adminId);
  expect(result.errors).toBe(1);
  const state = await smtpOverview(eventId);
  const failed = state.diagnostics.find((row) => row.status === "ERROR")!;
  expect(failed.errorCode).toBe("SMTP_RECIPIENT_550_5.1.1");
  expect(failed.messageId).toMatch(/^<invitation-.*@oneday\.com\.pl>$/);
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(0);
  const rest = await processSmtpBatch(eventId, adminId);
  expect(rest.sent).toBe(1);
  expect((await smtpOverview(eventId)).errors).toBe(1);
});

test("single test sends once without touching campaign, even with concurrent duplicate requests", async () => {
  const { sendSmtpTest } = await import("../src/server/smtp-campaign");
  const before = await database.select().from(s.emailLogs);
  const count = vi.mocked(sendSmtp).mock.calls.length;
  const input = {
    email: "single@example.org",
    requestId: "0f68da6d-e212-4e22-987d-a98b880cf3bd",
  };
  await Promise.all([
    sendSmtpTest(eventId, adminId, input),
    sendSmtpTest(eventId, adminId, input),
  ]);
  const replay = await sendSmtpTest(eventId, adminId, input);
  expect(replay.status).toBe("ACCEPTED");
  expect(replay.duplicate).toBe(true);
  expect(vi.mocked(sendSmtp).mock.calls.length).toBe(count + 1);
  expect(await database.select().from(s.emailLogs)).toEqual(before);
  const payload = vi.mocked(sendSmtp).mock.calls.at(-1)![0];
  expect(payload.to).toBe(input.email);
  expect(payload.html).not.toContain("TEST-02");
});
test("ambiguous single test cannot resend on replay", async () => {
  const { sendSmtpTest } = await import("../src/server/smtp-campaign");
  vi.mocked(sendSmtp).mockRejectedValueOnce(new SmtpFailure("ACCEPTANCE"));
  const count = vi.mocked(sendSmtp).mock.calls.length;
  const input = {
    email: "single@example.org",
    requestId: "65ca5ae4-64c4-48b9-91cb-e3c5339b7f4f",
  };
  expect((await sendSmtpTest(eventId, adminId, input)).status).toBe(
    "REVIEW_REQUIRED",
  );
  expect((await sendSmtpTest(eventId, adminId, input)).status).toBe(
    "REVIEW_REQUIRED",
  );
  expect(vi.mocked(sendSmtp).mock.calls.length).toBe(count + 1);
});

test("repeated and concurrent imports preserve participants, credentials and sent invitations", async () => {
  const { commitImport } = await import("../src/server/imports");
  const [original] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.eventId, eventId));
  const logsBefore = await database.select().from(s.emailLogs);
  const row = {
    row: 2,
    firstName: original.firstName.toUpperCase(),
    lastName: " " + original.lastName + " ",
    email: original.email,
    errors: [],
  };
  const fresh = {
    row: 3,
    firstName: "Nowa",
    lastName: "Osoba",
    email: original.email,
    errors: [],
  };
  const batches = await database
    .insert(s.importBatches)
    .values(
      [1, 2].map(() => ({
        eventId,
        adminId,
        rows: [row, fresh, fresh],
        expiresAt: new Date(Date.now() + 60000),
      })),
    )
    .returning();
  const results = await Promise.all(
    batches.map((b) => commitImport(b.id, eventId, adminId)),
  );
  expect(results.reduce((n, r) => n + r.imported, 0)).toBe(1);
  expect(
    await database
      .select()
      .from(s.participants)
      .where(eq(s.participants.id, original.id)),
  ).toEqual([original]);
  expect(await database.select().from(s.emailLogs)).toEqual(logsBefore);
  const [reimport] = await database
    .insert(s.importBatches)
    .values({
      eventId,
      adminId,
      rows: [row, fresh],
      expiresAt: new Date(Date.now() + 60000),
    })
    .returning();
  expect((await commitImport(reimport.id, eventId, adminId)).imported).toBe(0);
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(1);
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(0);
});
test("legacy duplicate record never receives a new invitation after first identity was attempted", async () => {
  const [original] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.eventId, eventId));
  const [duplicate] = await database
    .insert(s.participants)
    .values({
      eventId,
      firstName: original.firstName,
      lastName: original.lastName,
      email: original.email,
      ...newCredentials(),
    })
    .returning();
  expect((await startSmtpCampaign(eventId, adminId)).queued).toBe(0);
  await database
    .insert(s.emailLogs)
    .values({ participantId: duplicate.id, kind: "INVITATION" });
  for (let i = 0; i < 3; i++) await processSmtpBatch(eventId, adminId);
  const [log] = await database
    .select()
    .from(s.emailLogs)
    .where(eq(s.emailLogs.participantId, duplicate.id));
  expect(log.status).toBe("ERROR");
  expect(log.errorCode).toBe("DUPLICATE_PARTICIPANT_BLOCKED");
});
