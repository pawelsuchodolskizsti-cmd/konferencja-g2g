import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import * as s from "../src/db/schema";
import { encrypt, newCredentials } from "../src/server/crypto";
import type { Database } from "../src/db";

const fixture = vi.hoisted(() => ({ database: null as Database | null }));
vi.mock("@/db", () => ({ db: () => fixture.database }));
vi.mock("../src/server/smtp-transport", () => ({
  sendSmtp: vi.fn(async () => ({ queueId: "SYNTHETIC" })),
}));
import { sendSmtp } from "../src/server/smtp-transport";
import { SmtpFailure } from "../src/server/smtp-message";
import {
  createOrganizational,
  getOrganizational,
  launchOrganizational,
  listOrganizational,
  processOrganizational,
  retryOrganizational,
  reconcileOrganizational,
  resolveOrganizational,
  saveOrganizationalDraft,
} from "../src/server/organizational-mail";

const pg = new PGlite();
const db = drizzle(pg);
let eventId: string;
let adminId: string;
let people: string[] = [];
let counter = 0;

beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "example".repeat(16);
  process.env.APP_ENV = "production";
  process.env.APP_URL = "https://konferencja.example.org";
  delete process.env.VERCEL_ENV;
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile("drizzle/" + entry.tag + ".sql", "utf8"));
  fixture.database = db as unknown as Database;
  const [admin] = await db
    .insert(s.admins)
    .values({
      email: "organizer@example.org",
      passwordHash: "synthetic",
    })
    .returning();
  adminId = admin.id;
  const [event] = await db
    .insert(s.events)
    .values({
      slug: "organization",
      name: "Głowa do Góry",
      organizer: "Fundacja",
      location: "Warszawa",
      startsAt: new Date("2027-01-02T10:00:00Z"),
      endsAt: new Date("2027-01-02T18:00:00Z"),
      certificateUnlockAt: new Date("2027-01-03T10:00:00Z"),
      mailFrom: "konferencja@oneday.com.pl",
    })
    .returning();
  eventId = event.id;
  await db.insert(s.smtpSettings).values({
    eventId,
    passwordEncrypted: encrypt("synthetic-test-password"),
  });
  const rows = await db
    .insert(s.participants)
    .values([
      {
        eventId,
        firstName: "Jan",
        lastName: "Próbny",
        email: "jan@example.org",
        secondaryEmail: "jan2@example.org",
        ...newCredentials(),
      },
      {
        eventId,
        firstName: "Ewa",
        lastName: "Próbna",
        email: "ewa@example.org",
        ...newCredentials(),
      },
    ])
    .returning({ id: s.participants.id });
  people = rows.map((r) => r.id);
});

afterAll(async () => {
  vi.useRealTimers();
  await pg.close();
});

beforeEach(() => {
  counter++;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + counter * 600001);
  vi.mocked(sendSmtp).mockReset();
  vi.mocked(sendSmtp).mockImplementation(async () => ({
    queueId: "SYNTHETIC",
  }));
});

async function draft(name: string) {
  const { id } = await createOrganizational(eventId, adminId);
  await saveOrganizationalDraft(eventId, id, adminId, {
    subject: "Wiadomość " + name + " " + counter,
    body: "Witaj {{firstName}}, Twój kod to {{accessCode}}. {{panelUrl}}",
  });
  return id;
}

test("draft and selection never send mail; one SMTP message includes To and CC and existing access code", async () => {
  const id = await draft("pierwsza");
  const overview = await listOrganizational(eventId);
  expect(overview.people).toHaveLength(2);
  expect(overview.campaigns.some((c) => c.id === id)).toBe(true);
  expect(sendSmtp).not.toHaveBeenCalled();
  expect(
    (await launchOrganizational(eventId, id, adminId, { ids: people })).queued,
  ).toBe(2);
  expect(sendSmtp).not.toHaveBeenCalled();
  await expect(
    launchOrganizational(eventId, id, adminId, { ids: people }),
  ).rejects.toThrow();
  await expect(
    saveOrganizationalDraft(eventId, id, adminId, {
      subject: "Nie zmieniaj",
      body: "Kolejna wiadomość",
    }),
  ).rejects.toThrow();

  const encryptedRows = await db
    .select()
    .from(s.organizationalDeliveries)
    .where(eq(s.organizationalDeliveries.campaignId, id));
  expect(encryptedRows).toHaveLength(2);
  expect(
    encryptedRows.every(
      (row) => !row.recipientsEncrypted.includes("@example.org"),
    ),
  ).toBe(true);
  const first = await processOrganizational(eventId, id, adminId);
  expect(first.sent).toBe(1);
  expect(sendSmtp).toHaveBeenCalledTimes(1);
  const payload = vi.mocked(sendSmtp).mock.calls[0][0];
  expect(payload.to).toBe("jan@example.org");
  expect(payload.cc).toBe("jan2@example.org");
  const all = await db.select().from(s.participants);
  const code = JSON.parse(
    (await import("../src/server/crypto")).decrypt(
      all.find((p) => p.id === people[0])!.credentials,
    ),
  ).accessCode as string;
  expect(payload.html).toContain(code);
  expect(payload.html).toContain("/uczestnik");
  vi.setSystemTime(Date.now() + 31000);
  const second = await processOrganizational(eventId, id, adminId);
  expect(second.sent).toBe(1);
  const deliveries = await getOrganizational(eventId, id);
  expect(deliveries.deliveries.every((row) => row.status === "ACCEPTED")).toBe(
    true,
  );
  expect(deliveries.deliveries.every((row) => row.acceptedAt)).toBe(true);
  expect(deliveries.deliveries.every((row) => row.lastAttemptAt)).toBe(true);
  expect(
    deliveries.deliveries.find((row) => row.participantId === people[0])
      ?.recipients.cc,
  ).toBe("jan2@example.org");
});

test("definitive recipient rejection permits explicit retry of one person only", async () => {
  const id = await draft("retry");
  await launchOrganizational(eventId, id, adminId, { ids: [people[0]] });
  vi.setSystemTime(Date.now() + 40000);
  vi.mocked(sendSmtp).mockRejectedValueOnce(
    new SmtpFailure("RECIPIENT", 550, "5.1.1"),
  );
  const failed = await processOrganizational(eventId, id, adminId);
  expect(failed.errors).toBe(1);
  const [item] = (await getOrganizational(eventId, id)).deliveries;
  expect(item.status).toBe("FAILED");
  expect(item.errorCode).toBe("SMTP_RECIPIENT_550_5.1.1");
  expect(
    (await retryOrganizational(eventId, id, item.id, adminId)).queued,
  ).toBe(true);
  vi.setSystemTime(Date.now() + 31000);
  expect((await processOrganizational(eventId, id, adminId)).sent).toBe(1);
  expect((await getOrganizational(eventId, id)).deliveries[0].status).toBe(
    "ACCEPTED",
  );
  await expect(
    retryOrganizational(eventId, id, item.id, adminId),
  ).rejects.toThrow();
});

test("uncertain SMTP acceptance is never retried, even after explicit user request", async () => {
  const id = await draft("uncertain");
  await launchOrganizational(eventId, id, adminId, { ids: [people[1]] });
  vi.setSystemTime(Date.now() + 40000);
  vi.mocked(sendSmtp).mockRejectedValueOnce(new SmtpFailure("ACCEPTANCE"));
  expect((await processOrganizational(eventId, id, adminId)).stopped).toBe(
    true,
  );
  const [item] = (await getOrganizational(eventId, id)).deliveries;
  expect(item.status).toBe("REVIEW_REQUIRED");
  await expect(
    retryOrganizational(eventId, id, item.id, adminId),
  ).rejects.toThrow();
  expect((await processOrganizational(eventId, id, adminId)).sent).toBe(0);
  expect(sendSmtp).toHaveBeenCalledTimes(1);
});

test("expired last lease recovers without SMTP; a live lease and other campaign remain untouched", async () => {
  const id = await draft("interrupted");
  await launchOrganizational(eventId, id, adminId, { ids: people });
  const items = (await getOrganizational(eventId, id)).deliveries;
  await db
    .update(s.organizationalDeliveries)
    .set({
      status: "SENDING",
      leaseToken: crypto.randomUUID(),
      leaseUntil: new Date(Date.now() - 1),
    })
    .where(eq(s.organizationalDeliveries.id, items[0].id));
  await db
    .update(s.organizationalDeliveries)
    .set({
      status: "SENDING",
      leaseToken: crypto.randomUUID(),
      leaseUntil: new Date(Date.now() + 60000),
    })
    .where(eq(s.organizationalDeliveries.id, items[1].id));
  expect((await reconcileOrganizational(eventId, id, adminId)).reconciled).toBe(
    1,
  );
  const after = (await getOrganizational(eventId, id)).deliveries;
  expect(after.find((row) => row.id === items[0].id)?.status).toBe(
    "REVIEW_REQUIRED",
  );
  expect(after.find((row) => row.id === items[1].id)?.status).toBe("SENDING");
  expect((await reconcileOrganizational(eventId, id, adminId)).reconciled).toBe(
    0,
  );
  await expect(
    retryOrganizational(eventId, id, items[0].id, adminId),
  ).rejects.toThrow();
  await expect(
    resolveOrganizational(eventId, id, items[0].id, adminId, {
      outcome: "NOT_ACCEPTED",
      confirmation: "",
    }),
  ).rejects.toThrow();
  await resolveOrganizational(eventId, id, items[0].id, adminId, {
    outcome: "NOT_ACCEPTED",
    confirmation: "SPRAWDZONO W HOME.PL",
  });
  expect(sendSmtp).not.toHaveBeenCalled();
  expect(
    (await retryOrganizational(eventId, id, items[0].id, adminId)).queued,
  ).toBe(true);
  expect(sendSmtp).not.toHaveBeenCalled();
});
test("archive preserves encrypted exact message snapshot and all campaign recipients/statuses", async () => {
  const id = await draft("snapshot");
  await launchOrganizational(eventId, id, adminId, { ids: [people[0]] });
  vi.setSystemTime(Date.now() + 40000);
  await processOrganizational(eventId, id, adminId);
  const payload = vi.mocked(sendSmtp).mock.calls[0][0];
  const [stored] = await db
    .select()
    .from(s.organizationalDeliveries)
    .where(eq(s.organizationalDeliveries.campaignId, id));
  expect(stored.contentEncrypted).not.toContain("Witaj");
  const { organizationalArchive } =
    await import("../src/server/organizational-archive");
  const archive = await organizationalArchive(eventId);
  const exported = archive.campaigns.find((c) => c.id === id)!;
  expect(exported.deliveries).toHaveLength(1);
  expect(exported.deliveries[0].content).toEqual({
    subject: payload.subject,
    html: payload.html,
  });
  expect(exported.deliveries[0].recipients).toEqual({
    to: payload.to,
    cc: payload.cc,
  });
  expect(exported.deliveries[0].status).toBe("ACCEPTED");
  expect(exported.deliveries[0].contentEvidence).toBe("saved-before-smtp");
});
