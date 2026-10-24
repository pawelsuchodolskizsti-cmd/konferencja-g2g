import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import * as s from "../src/db/schema";
import { decrypt, encrypt, newCredentials } from "../src/server/crypto";
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

import { updateParticipant } from "../src/server/admin-data";
import { resetCredentials } from "../src/server/admin-operations";

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

test("retry processing stays on its single delivery even when other recipients are queued", async () => {
  const id = await draft("single-target");
  await launchOrganizational(eventId, id, adminId, { ids: people });
  const before = (await getOrganizational(eventId, id)).deliveries;
  const target = before.find((row) => row.participantId === people[0])!;
  const other = before.find((row) => row.participantId === people[1])!;
  vi.mocked(sendSmtp).mockRejectedValueOnce(
    new SmtpFailure("RECIPIENT", 550, "5.1.1"),
  );
  expect(
    (await processOrganizational(eventId, id, adminId, target.id)).errors,
  ).toBe(1);
  await retryOrganizational(eventId, id, target.id, adminId);
  // Throttling this target must not fall back to another ready recipient.
  expect(
    (await processOrganizational(eventId, id, adminId, target.id)).sent,
  ).toBe(0);
  expect(sendSmtp).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 31000);
  expect(
    (await processOrganizational(eventId, id, adminId, target.id)).sent,
  ).toBe(1);
  expect(sendSmtp).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(sendSmtp)
      .mock.calls.every(([payload]) => payload.to === "jan@example.org"),
  ).toBe(true);
  expect(
    (await getOrganizational(eventId, id)).deliveries.find(
      (row) => row.id === other.id,
    ),
  ).toEqual(other);
  // A second request for an accepted target also must not drain the queue.
  vi.setSystemTime(Date.now() + 31000);
  expect(
    (await processOrganizational(eventId, id, adminId, target.id)).sent,
  ).toBe(0);
  expect(sendSmtp).toHaveBeenCalledTimes(2);
  const foreign = await draft("foreign-target");
  await launchOrganizational(eventId, foreign, adminId, { ids: [people[1]] });
  const foreignTarget = (await getOrganizational(eventId, foreign))
    .deliveries[0];
  await expect(
    processOrganizational(eventId, id, adminId, foreignTarget.id),
  ).rejects.toThrow("Nie znaleziono wiadomości");
  expect(sendSmtp).toHaveBeenCalledTimes(2);
});

async function isolatedPerson() {
  const [person] = await db
    .insert(s.participants)
    .values({
      eventId,
      firstName: "Osoba",
      lastName: "Syntetyczna",
      email: "sync-" + counter + "@example.org",
      ...newCredentials(),
    })
    .returning();
  return person;
}

test("queued and failed messages follow participant edits and new codes, while accepted snapshots stay intact", async () => {
  const person = await isolatedPerson();
  const acceptedId = await draft("accepted-history");
  await launchOrganizational(eventId, acceptedId, adminId, {
    ids: [person.id],
  });
  await processOrganizational(eventId, acceptedId, adminId);
  const [acceptedBefore] = await db
    .select()
    .from(s.organizationalDeliveries)
    .where(eq(s.organizationalDeliveries.campaignId, acceptedId));
  const failedId = await draft("failed-current");
  await launchOrganizational(eventId, failedId, adminId, { ids: [person.id] });
  vi.setSystemTime(Date.now() + 31000);
  vi.mocked(sendSmtp).mockRejectedValueOnce(
    new SmtpFailure("RECIPIENT", 550, "5.1.1"),
  );
  await processOrganizational(eventId, failedId, adminId);
  const queuedId = await draft("queued-current");
  await launchOrganizational(eventId, queuedId, adminId, { ids: [person.id] });
  const newEmail = "updated-" + counter + "@example.org";
  await updateParticipant(
    eventId,
    adminId,
    person.id,
    {
      firstName: "Aktualna",
      lastName: "Poprawiona",
      email: newEmail,
      secondaryEmail: "copy-" + counter + "@example.org",
    },
    fixture.database!,
  );
  await resetCredentials(
    eventId,
    adminId,
    person.id,
    { confirmation: "ZMIEŃ KODY" },
    fixture.database!,
  );
  const [updated] = await db
    .select()
    .from(s.participants)
    .where(eq(s.participants.id, person.id));
  const oldCode = JSON.parse(decrypt(person.credentials)).accessCode;
  const newCode = JSON.parse(decrypt(updated.credentials)).accessCode;
  expect(newCode).not.toBe(oldCode);
  for (const campaignId of [failedId, queuedId]) {
    const [row] = await db
      .select()
      .from(s.organizationalDeliveries)
      .where(eq(s.organizationalDeliveries.campaignId, campaignId));
    expect(JSON.parse(decrypt(row.recipientsEncrypted))).toEqual({
      to: newEmail,
      cc: "copy-" + counter + "@example.org",
    });
    expect(row.contentEncrypted).toBeNull();
  }
  const target = (await getOrganizational(eventId, failedId)).deliveries[0];
  await retryOrganizational(eventId, failedId, target.id, adminId);
  vi.setSystemTime(Date.now() + 31000);
  expect(
    (await processOrganizational(eventId, failedId, adminId, target.id)).sent,
  ).toBe(1);
  const payload = vi.mocked(sendSmtp).mock.calls.at(-1)![0];
  expect(payload.to).toBe(newEmail);
  expect(payload.cc).toBe("copy-" + counter + "@example.org");
  expect(payload.html).toContain("Aktualna");
  expect(payload.html).toContain(newCode);
  expect(payload.html).not.toContain(oldCode);
  expect(
    (await getOrganizational(eventId, queuedId)).deliveries[0].status,
  ).toBe("QUEUED");
  const [acceptedAfter] = await db
    .select()
    .from(s.organizationalDeliveries)
    .where(eq(s.organizationalDeliveries.campaignId, acceptedId));
  expect(acceptedAfter).toEqual(acceptedBefore);
  // A previously queued message also renders current values on its first attempt.
  vi.setSystemTime(Date.now() + 31000);
  await processOrganizational(eventId, queuedId, adminId);
  expect(vi.mocked(sendSmtp).mock.calls.at(-1)![0].html).toContain(newCode);
  expect(vi.mocked(sendSmtp).mock.calls.at(-1)![0].to).toBe(newEmail);
});

test.each(["SENDING", "REVIEW_REQUIRED"] as const)(
  "participant edits roll back while organizational delivery is %s",
  async (status) => {
    const person = await isolatedPerson();
    const id = await draft("guard-" + status);
    await launchOrganizational(eventId, id, adminId, { ids: [person.id] });
    await db
      .update(s.organizationalDeliveries)
      .set({ status })
      .where(eq(s.organizationalDeliveries.campaignId, id));
    await expect(
      updateParticipant(
        eventId,
        adminId,
        person.id,
        {
          firstName: "Zmiana",
          lastName: person.lastName,
          email: "changed-" + counter + "@example.org",
        },
        fixture.database!,
      ),
    ).rejects.toThrow("Najpierw zakończ lub rozlicz");
    await expect(
      resetCredentials(
        eventId,
        adminId,
        person.id,
        { confirmation: "ZMIEŃ KODY" },
        fixture.database!,
      ),
    ).rejects.toThrow("Najpierw zakończ lub rozlicz");
    const [after] = await db
      .select()
      .from(s.participants)
      .where(eq(s.participants.id, person.id));
    expect(after).toEqual(person);
    expect((await getOrganizational(eventId, id)).deliveries[0].status).toBe(
      status,
    );
    expect(sendSmtp).not.toHaveBeenCalled();
  },
);
