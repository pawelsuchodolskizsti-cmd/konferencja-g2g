import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  test,
  vi,
} from "vitest";
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
      return { queueId: "SYNTHETIC123" };
    },
  ),
  verifySmtp: vi.fn(async () => undefined),
}));
import { sendSmtp } from "../src/server/smtp-transport";
import { SmtpFailure } from "../src/server/smtp-message";
import {
  sendSmtpTest,
  smtpOverview,
  saveSmtpPassword,
  startSmtpCampaign,
  processSmtpBatch,
} from "../src/server/smtp-campaign";

const pg = new PGlite();
const database = drizzle(pg);
let eventId: string;
let adminId: string;
let clock = Date.now() + 60000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});
afterEach(() => {
  clock = Date.now() + 60000;
  vi.useRealTimers();
});

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

async function extraEvent(slug: string, addresses: string[]) {
  const [base] = await database
    .select()
    .from(s.events)
    .where(eq(s.events.id, eventId));
  const [event] = await database
    .insert(s.events)
    .values({ ...base, id: undefined, slug })
    .returning();
  await database.insert(s.participants).values(
    addresses.map((email, i) => ({
      eventId: event.id,
      email,
      firstName: `Osoba${i}`,
      lastName: slug,
      ...newCredentials(),
    })),
  );
  await saveSmtpPassword(event.id, adminId, { password: "synthetic-only" });
  await startSmtpCampaign(event.id, adminId);
  return event.id;
}

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

test.each([250, 500])(
  "%i invitations preserve separate recipients and obey pacing across 10 concurrent workers",
  async (count) => {
    const [stressEvent] = await database
      .insert(s.events)
      .values({
        slug: `smtp-stress-${count}`,
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
    const rows = Array.from({ length: count }, (_, index) => ({
      eventId: event,
      firstName: `Uczestnik${index + 1}`,
      lastName: "Testowy",
      email: `shared${String(index % 25).padStart(2, "0")}@example.org`,
      ...newCredentials(),
    }));
    await database.insert(s.participants).values(rows);
    await saveSmtpPassword(event, adminId, { password: "synthetic-only" });

    const pending = await smtpOverview(event);
    expect(pending.total).toBe(count);
    expect(pending.uniqueEmails).toBe(25);
    expect(pending.duplicateRecipients).toBe(count - 25);
    expect((await startSmtpCampaign(event, adminId)).queued).toBe(count);
    expect((await startSmtpCampaign(event, adminId)).queued).toBe(0);
    fixture.sent.length = 0;

    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => processSmtpBatch(event, adminId)),
    );
    expect(concurrent.reduce((sum, batch) => sum + batch.sent, 0)).toBe(1);
    expect(concurrent.every((batch) => batch.retryAfterMs > 0)).toBe(true);
    for (let round = 1; round < count; round++) {
      vi.setSystemTime(Date.now() + 3000);
      expect((await processSmtpBatch(event, adminId)).sent).toBe(1);
    }
    const final = await smtpOverview(event);
    expect(final.queued).toBe(0);
    expect(final.errors).toBe(0);
    expect(final.sent).toBe(count);
    expect(fixture.sent).toHaveLength(count);
    const receipts = await database
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.eventId, event));
    expect(
      receipts.filter(
        (r) => r.action === "SMTP_EMAIL_ACCEPTED queue=SYNTHETIC123",
      ),
    ).toHaveLength(count);
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
    expect(new Set(codes).size).toBe(count);
    for (const code of codes) {
      expect(
        fixture.sent.filter((payload) => payload.html.includes(code)),
      ).toHaveLength(1);
    }
  },
  180000,
);

test("invitation identifies the recipient and organizer without duplicating a code already in the template", async () => {
  const { invitation } = await import("../src/server/mail");
  const { htmlToText } = await import("../src/server/smtp-message");
  const [event] = await database
    .select()
    .from(s.events)
    .where(eq(s.events.id, eventId));
  const [person] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.eventId, eventId));
  const code = JSON.parse(decrypt(person.credentials)).accessCode as string;
  for (const mailBody of [
    "Witaj {{firstName}}, Twój kod: {{accessCode}}",
    "Zapraszamy na {{eventName}}.",
  ]) {
    const mail = await invitation(
      { ...person, firstName: "<Anna>" },
      { ...event, mailBody },
    );
    const text = htmlToText(mail.html);
    expect(text).toContain(`Zaproszenie dla: <Anna> ${person.lastName}`);
    expect(text.split(code)).toHaveLength(2);
    expect(text.split("https://conference.example.org/uczestnik")).toHaveLength(
      2,
    );
    expect(text).toContain("Fundacja One Day");
    expect(text).toContain("konferencja@oneday.com.pl");
    expect(mail.html).not.toContain("<Anna>");
    expect(mail.html).toContain('<html lang="pl">');
  }
});

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
  vi.setSystemTime(Date.now() + 3000);
  const waiting = await processSmtpBatch(eventId, adminId);
  expect(waiting.sent).toBe(0);
  expect(waiting.retryAfterMs).toBeGreaterThan(0);
  vi.setSystemTime(Date.now() + 27000);
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
  for (let i = 0; i < 3; i++) {
    await processSmtpBatch(eventId, adminId);
    vi.setSystemTime(Date.now() + 30000);
  }
  const [log] = await database
    .select()
    .from(s.emailLogs)
    .where(eq(s.emailLogs.participantId, duplicate.id));
  expect(log.status).toBe("ERROR");
  expect(log.errorCode).toBe("DUPLICATE_PARTICIPANT_BLOCKED");
});

test("global pacing covers different events and a waiting mailbox does not block other recipients", async () => {
  const first = await extraEvent("pacing-a", ["pacing@example.org"]);
  const second = await extraEvent("pacing-b", [
    "pacing@example.org",
    "other@example.org",
  ]);
  expect((await processSmtpBatch(first, adminId)).sent).toBe(1);
  expect((await processSmtpBatch(second, adminId)).retryAfterMs).toBe(3000);
  vi.setSystemTime(Date.now() + 3000);
  expect((await processSmtpBatch(second, adminId)).sent).toBe(0);
  expect((await processSmtpBatch(second, adminId)).sent).toBe(1);
  vi.setSystemTime(Date.now() + 27000);
  expect((await processSmtpBatch(second, adminId)).sent).toBe(1);
});

test("temporary pre-acceptance failure retries safely, while an ambiguous DATA result is never resent", async () => {
  const event = await extraEvent("safe-retry", ["safe-retry@example.org"]);
  vi.mocked(sendSmtp).mockRejectedValueOnce(new SmtpFailure("CONNECT"));
  const failed = await processSmtpBatch(event, adminId);
  expect(failed).toMatchObject({
    sent: 0,
    errors: 0,
    retryAfterMs: 60000,
    stopped: false,
  });
  const before = (await smtpOverview(event)).diagnostics[0];
  expect(before.status).toBe("QUEUED");
  vi.setSystemTime(Date.now() + 60000);
  expect((await processSmtpBatch(event, adminId)).sent).toBe(1);
  const accepted = (await smtpOverview(event)).diagnostics[0];
  expect(accepted.attemptedAt).toEqual(before.attemptedAt);
  expect(accepted.messageId).toBe(before.messageId);
  expect((await processSmtpBatch(event, adminId)).sent).toBe(0);

  vi.setSystemTime(Date.now() + 60000);
  const uncertain = await extraEvent("uncertain-retry", [
    "uncertain@example.org",
  ]);
  vi.mocked(sendSmtp).mockRejectedValueOnce(new SmtpFailure("ACCEPTANCE"));
  expect(await processSmtpBatch(uncertain, adminId)).toMatchObject({
    errors: 1,
    stopped: true,
  });
  expect((await startSmtpCampaign(uncertain, adminId)).queued).toBe(0);
  expect((await processSmtpBatch(uncertain, adminId)).sent).toBe(0);
  vi.setSystemTime(Date.now() + 60000);
  const policy = await extraEvent("policy-rejection", ["policy@example.org"]);
  vi.mocked(sendSmtp).mockRejectedValueOnce(
    new SmtpFailure("RECIPIENT", 550, "5.7.1"),
  );
  expect(await processSmtpBatch(policy, adminId)).toMatchObject({
    errors: 1,
    stopped: true,
  });
});

test("personalized test sends exactly once to override address without changing campaign or codes", async () => {
  await saveSmtpPassword(eventId, adminId, {
    password: "synthetic-test-password",
  });
  const [person] = await database.select().from(s.participants);
  await database
    .update(s.events)
    .set({
      mailSubject: "{{firstName}}, ważne informacje",
      mailBody: "Dzień dobry, {{firstName}}! Twój kod: {{accessCode}}",
    })
    .where(eq(s.events.id, eventId));
  const before = await database.select().from(s.emailLogs);
  const count = fixture.sent.length;
  const input = {
    email: "preview@example.test",
    participantId: person.id,
    requestId: crypto.randomUUID(),
  };
  expect(await sendSmtpTest(eventId, adminId, input)).toMatchObject({
    status: "ACCEPTED",
    duplicate: false,
  });
  expect(await sendSmtpTest(eventId, adminId, input)).toMatchObject({
    status: "ACCEPTED",
    duplicate: true,
  });
  expect(fixture.sent).toHaveLength(count + 1);
  const payload = fixture.sent.at(-1)!;
  expect(payload.to).toBe(input.email);
  expect(payload.html).toContain(person.firstName);
  expect(payload.html).toContain(
    JSON.parse(decrypt(person.credentials)).accessCode,
  );
  expect(await database.select().from(s.emailLogs)).toEqual(before);
  expect(
    (
      await database
        .select()
        .from(s.participants)
        .where(eq(s.participants.id, person.id))
    )[0].credentials,
  ).toBe(person.credentials);
  await expect(
    sendSmtpTest(eventId, adminId, {
      ...input,
      participantId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(fixture.sent).toHaveLength(count + 1);
});
