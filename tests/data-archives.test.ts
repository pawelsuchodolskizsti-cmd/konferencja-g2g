import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import * as s from "../src/db/schema";
import { adminPermission } from "../src/lib/admin-permissions";
const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db", () => ({ db: () => state.database }));
import {
  createArchive,
  listArchives,
  downloadArchive,
  cleanupPreview,
  clearSelectedParticipants,
  removeArchive,
} from "../src/server/data-archives";
import { encrypt } from "../src/server/crypto";
import { createParticipant } from "../src/server/admin-operations";
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string,
  otherEventId: string,
  adminId: string,
  personId: string,
  keepId: string;
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "pepper".repeat(10);
  process.env.APP_URL = "http://localhost:3000";
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const e of journal.entries)
    await pg.exec(await readFile(`drizzle/${e.tag}.sql`, "utf8"));
  adminId = (
    await database
      .insert(s.admins)
      .values({ email: "archives@example.test", passwordHash: "unused" })
      .returning()
  )[0].id;
  const values = {
    name: "Archiwum",
    organizer: "Fundacja",
    location: "Sala",
    startsAt: new Date("2099-01-01"),
    endsAt: new Date("2099-01-02"),
    certificateUnlockAt: new Date("2099-01-02"),
    mailFrom: "test@example.org",
  };
  eventId = (
    await database
      .insert(s.events)
      .values({ ...values, slug: "archive" })
      .returning()
  )[0].id;
  otherEventId = (
    await database
      .insert(s.events)
      .values({ ...values, slug: "other" })
      .returning()
  )[0].id;
  personId = (
    await createParticipant(eventId, adminId, {
      firstName: "Anna",
      lastName: "Testowa",
      email: "test@example.test",
    })
  ).id;
  keepId = (
    await createParticipant(eventId, adminId, {
      firstName: "Jan",
      lastName: "Kowalski",
      email: "jan@example.test",
    })
  ).id;
  const [campaign] = await database
    .insert(s.organizationalCampaigns)
    .values({
      eventId,
      adminId,
      subject: "Archiwalny temat",
      body: "Archiwalna pełna treść {{firstName}}",
      launchedAt: new Date(),
    })
    .returning();
  await database.insert(s.organizationalDeliveries).values([
    {
      campaignId: campaign.id,
      participantId: personId,
      recipientsEncrypted: encrypt(JSON.stringify({ to: "test@example.test" })),
      contentEncrypted: encrypt(
        JSON.stringify({
          subject: "Archiwalny temat",
          html: "<p>Archiwalna pełna treść Anna</p>",
        }),
      ),
      messageId: "<synthetic-accepted@example.test>",
      status: "ACCEPTED",
      attempts: 1,
      acceptedAt: new Date(),
    },
    {
      campaignId: campaign.id,
      participantId: keepId,
      recipientsEncrypted: encrypt(JSON.stringify({ to: "jan@example.test" })),
      messageId: "<synthetic-queued@example.test>",
      status: "QUEUED",
    },
  ]);
});
afterAll(() => pg.close());
test("archive contains reports and organizational messages, encrypts payload and isolates events", async () => {
  const a = await createArchive(eventId, adminId);
  expect(a.participantCount).toBe(2);
  expect((await listArchives(eventId))[0].id).toBe(a.id);
  expect(await listArchives(otherEventId)).toEqual([]);
  await expect(downloadArchive(otherEventId, adminId, a.id)).rejects.toThrow();
  const bytes = new Uint8Array(
    await (await downloadArchive(eventId, adminId, a.id)).arrayBuffer(),
  );
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toContain("attendance.csv");
  expect(Object.keys(files)).toContain("ankieta.xlsx");
  expect(Object.keys(files).some((name) => name.endsWith(".pdf"))).toBe(false);
  const organizational = JSON.parse(
    new TextDecoder().decode(files["wiadomosci-organizacyjne.json"]),
  );
  expect(organizational.campaigns).toHaveLength(1);
  expect(organizational.campaigns[0].body).toBe(
    "Archiwalna pełna treść {{firstName}}",
  );
  expect(organizational.campaigns[0].deliveries).toHaveLength(2);
  expect(
    organizational.campaigns[0].deliveries.find(
      (d: { status: string }) => d.status === "ACCEPTED",
    ).content.html,
  ).toContain("Anna");
  expect(
    (await database.select().from(s.dataArchives))[0].payload,
  ).not.toContain("Kowalski");
}, 30000);
test("cleanup rejects missing confirmation, other event IDs and stale preview without deleting", async () => {
  const preview = await cleanupPreview(eventId, { ids: [personId] });
  await expect(
    clearSelectedParticipants(eventId, adminId, {
      ids: [personId],
      fingerprint: preview.fingerprint,
      confirmation: "",
    }),
  ).rejects.toThrow();
  await expect(
    cleanupPreview(otherEventId, { ids: [personId] }),
  ).rejects.toThrow();
  await database
    .update(s.participants)
    .set({ updatedAt: new Date(Date.now() + 1000) })
    .where(eq(s.participants.id, personId));
  await expect(
    clearSelectedParticipants(eventId, adminId, {
      ids: [personId],
      fingerprint: preview.fingerprint,
      confirmation: "USUŃ WYBRANYCH",
    }),
  ).rejects.toThrow();
  expect(await database.select().from(s.participants)).toHaveLength(2);
});
test("cleanup saves archive, deletes only selected account and sessions, preserves settings and other person", async () => {
  await database.insert(s.sessions).values({
    participantId: personId,
    tokenHash: "test-session",
    expiresAt: new Date("2099-01-01"),
  });
  const preview = await cleanupPreview(eventId, { ids: [personId] });
  const r = await clearSelectedParticipants(eventId, adminId, {
    ids: [personId],
    fingerprint: preview.fingerprint,
    confirmation: "USUŃ WYBRANYCH",
  });
  expect(r.deleted).toBe(1);
  expect(
    (await database.select().from(s.participants)).map((p) => p.id),
  ).toEqual([keepId]);
  expect(await database.select().from(s.sessions)).toHaveLength(0);
  expect(await database.select().from(s.events)).toHaveLength(2);
  expect((await listArchives(eventId)).some((a) => a.id === r.archiveId)).toBe(
    true,
  );
}, 30000);
test("archive deletion requires exact confirmation and preserves live participants", async () => {
  const [a] = await listArchives(eventId);
  await expect(
    removeArchive(eventId, adminId, a.id, { confirmation: "" }),
  ).rejects.toThrow();
  await removeArchive(eventId, adminId, a.id, {
    confirmation: "USUŃ ARCHIWUM",
  });
  await expect(downloadArchive(eventId, adminId, a.id)).rejects.toThrow();
  expect(await database.select().from(s.participants)).toHaveLength(1);
});
test("controller can only list/download archives; cleanup and archive writes require admin", () => {
  expect(adminPermission("GET", ["events", eventId, "archives"])).toBe("READ");
  expect(adminPermission("GET", ["events", eventId, "archives", "id"])).toBe(
    "READ",
  );
  for (const method of ["POST", "DELETE", "PATCH"])
    for (const route of [
      ["archives"],
      ["archives", "id"],
      ["data-cleanup"],
      ["data-cleanup", "preview"],
    ])
      expect(adminPermission(method, ["events", eventId, ...route])).toBe(
        "ADMIN",
      );
});

test("failed archive prevents cleanup; started conference cannot be reset", async () => {
  const preview = await cleanupPreview(eventId, { ids: [keepId] });
  const input = {
    ids: [keepId],
    fingerprint: preview.fingerprint,
    confirmation: "USUŃ WYBRANYCH",
  };
  const key = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = "invalid";
  try {
    await expect(
      clearSelectedParticipants(eventId, adminId, input),
    ).rejects.toThrow();
  } finally {
    process.env.DATA_ENCRYPTION_KEY = key;
  }
  expect(await database.select().from(s.participants)).toHaveLength(1);
  await database
    .update(s.events)
    .set({ startsAt: new Date("2020-01-01") })
    .where(eq(s.events.id, eventId));
  await expect(
    clearSelectedParticipants(eventId, adminId, input),
  ).rejects.toThrow("przed konferencją");
  expect(await database.select().from(s.participants)).toHaveLength(1);
});
