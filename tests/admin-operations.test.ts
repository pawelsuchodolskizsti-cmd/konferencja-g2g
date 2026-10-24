import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db", () => ({ db: () => state.database }));
import {
  createParticipant,
  resetCredentials,
  undoAttendance,
  selectedPeople,
  exportReport,
  savePrivacyRequest,
  privacyOverview,
  personalData,
  saveTeamMember,
  manageMaterial,
  cleanupData,
  history,
} from "../src/server/admin-operations";
import { requireEvent } from "../src/server/auth";
import { decrypt, encrypt, hashToken } from "../src/server/crypto";
import { participantList, updateParticipant } from "../src/server/admin-data";
import { downloadMaterial } from "../src/server/materials";
import { setMaterialsUnlocked } from "../src/server/material-access";
import { filterParticipants } from "../src/lib/participant-filter";
const pg = new PGlite();
const database = drizzle(pg);
const db = database as unknown as Database;
let eventId: string, adminId: string, personId: string, otherEventId: string;
beforeAll(async () => {
  state.database = db;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "pepper".repeat(10);
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  const [a] = await database
    .insert(s.admins)
    .values({ email: "admin@example.test", passwordHash: "unused" })
    .returning();
  adminId = a.id;
  const values = {
    name: "Test",
    organizer: "Fundacja",
    location: "Sala",
    startsAt: new Date("2020-01-01"),
    endsAt: new Date("2020-01-02"),
    certificateUnlockAt: new Date("2020-01-02"),
    mailFrom: "test@example.org",
  };
  const [e] = await database
    .insert(s.events)
    .values({ ...values, slug: "admin-tests" })
    .returning();
  eventId = e.id;
  const [other] = await database
    .insert(s.events)
    .values({ ...values, slug: "other" })
    .returning();
  otherEventId = other.id;
  await database.insert(s.adminEvents).values({ eventId, adminId });
  personId = (
    await createParticipant(
      eventId,
      adminId,
      { firstName: "Anna", lastName: "Testowa", email: "anna@example.test" },
      db,
    )
  ).id;
});
afterAll(() => pg.close());
test("manual participant creation does not grant attendance and permits shared email", async () => {
  expect(await database.select().from(s.attendance)).toHaveLength(0);
  const second = await createParticipant(
    eventId,
    adminId,
    { firstName: "Ewa", lastName: "Testowa", email: "anna@example.test" },
    db,
  );
  expect(second.id).not.toBe(personId);
  expect(
    (await database.select().from(s.participants)).filter(
      (p) => p.email === "anna@example.test",
    ),
  ).toHaveLength(2);
});
test("staff role can check in, but not export or manage an event", async () => {
  const [staff] = await database
    .insert(s.admins)
    .values({ email: "staff@example.test", passwordHash: "unused" })
    .returning();
  await database
    .insert(s.adminEvents)
    .values({ eventId, adminId: staff.id, role: "CHECKIN" });
  await expect(
    requireEvent(staff.id, eventId, db, "CHECKIN"),
  ).resolves.toMatchObject({ role: "CHECKIN" });
  await expect(requireEvent(staff.id, eventId, db)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    requireEvent(staff.id, otherEventId, db, "CHECKIN"),
  ).rejects.toMatchObject({ status: 403 });
});
test("filters and explicit selection agree for screen and export, invalid scope rejected", async () => {
  await database
    .insert(s.attendance)
    .values({ participantId: personId, method: "MANUAL" });
  const p = await selectedPeople(eventId, { filter: "present" });
  expect(p).toHaveLength(1);
  expect(filterParticipants(p, { q: p[0].accessCode })).toHaveLength(1);
  const csv = await (
    await exportReport(eventId, adminId, "attendance", { filter: "absent" })
  ).text();
  // Osoba bez obecności może mieć ten sam e-mail co osoba z obecnością.
  // Filtr musi działać po identyfikatorze uczestnika, nie po adresie.
  expect(csv).toContain("anna@example.test");
  const absent = await selectedPeople(eventId, { filter: "absent" });
  expect(absent.every((person) => person.id !== personId)).toBe(true);
  const filtered = await (
    await exportReport(eventId, adminId, "attendance", { q: "Anna" })
  ).text();
  expect(filtered).toContain("anna@example.test");
  await expect(
    selectedPeople(otherEventId, { ids: [personId] }),
  ).rejects.toMatchObject({ status: 400 });
});
test("credential rotation preserves attendance, revokes sessions and old QR", async () => {
  const [before] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.id, personId));
  await database.insert(s.sessions).values({
    participantId: personId,
    tokenHash: hashToken("session"),
    expiresAt: new Date(Date.now() + 10000),
  });
  await resetCredentials(
    eventId,
    adminId,
    personId,
    { confirmation: "ZMIEŃ KODY" },
    db,
  );
  const [after] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.id, personId));
  expect(after.qrHash).not.toBe(before.qrHash);
  expect(after.accessHash).not.toBe(before.accessHash);
  expect(JSON.parse(decrypt(after.credentials)).accessCode).toHaveLength(6);
  expect(await database.select().from(s.sessions)).toHaveLength(0);
  expect(await database.select().from(s.attendance)).toHaveLength(1);
  await expect(
    resetCredentials(
      otherEventId,
      adminId,
      personId,
      { confirmation: "ZMIEŃ KODY" },
      db,
    ),
  ).rejects.toMatchObject({ status: 404 });
});
test("attendance reversal needs a reason and refuses already issued certificates", async () => {
  await expect(
    undoAttendance(eventId, adminId, personId, { reason: "" }, db),
  ).rejects.toThrow();
  await database
    .insert(s.certificates)
    .values({ participantId: personId, number: "TEST" });
  await expect(
    undoAttendance(
      eventId,
      adminId,
      personId,
      { reason: "Pomyłka obsługi" },
      db,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await database
    .delete(s.certificates)
    .where(eq(s.certificates.participantId, personId));
  await undoAttendance(
    eventId,
    adminId,
    personId,
    { reason: "Pomyłka obsługi" },
    db,
  );
  expect(await database.select().from(s.attendance)).toHaveLength(0);
});
test("email correction allowed after sent mail, blocked during queued mail", async () => {
  await database
    .insert(s.emailLogs)
    .values({ participantId: personId, kind: "INVITATION", status: "SENT" });
  await expect(
    updateParticipant(
      eventId,
      adminId,
      personId,
      {
        firstName: "Anna",
        lastName: "Testowa",
        email: "corrected@example.test",
      },
      db,
    ),
  ).resolves.toEqual({ id: personId });
  await database
    .update(s.emailLogs)
    .set({ status: "QUEUED" })
    .where(eq(s.emailLogs.participantId, personId));
  await expect(
    updateParticipant(
      eventId,
      adminId,
      personId,
      { firstName: "Anna", lastName: "Testowa", email: "another@example.test" },
      db,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await database
    .update(s.emailLogs)
    .set({ status: "SENT" })
    .where(eq(s.emailLogs.participantId, personId));
});
test("data export excludes secrets, tokens and anonymous survey answers", async () => {
  const response = await personalData(eventId, adminId, personId);
  const text = await response.text();
  expect(text).toContain("corrected@example.test");
  expect(text).not.toContain("credentials");
  expect(text).not.toContain("accessCode");
  expect(text).not.toContain("passwordHash");
});
test("privacy request checks event scope and retains acknowledgement separately", async () => {
  await expect(
    savePrivacyRequest(otherEventId, adminId, {
      participantId: personId,
      kind: "ACCESS",
      status: "OPEN",
      note: "",
    }),
  ).rejects.toMatchObject({ status: 404 });
  await savePrivacyRequest(eventId, adminId, {
    participantId: personId,
    kind: "ACCESS",
    status: "OPEN",
    note: "Prośba o kopię danych",
  });
  const info = await privacyOverview(eventId);
  expect(info.requests).toHaveLength(1);
  expect(info.people[0].acknowledgedAt).toBeNull();
});
test("hidden materials are unavailable even by direct URL; published materials retain attendance requirement", async () => {
  const [m] = await database
    .insert(s.materials)
    .values({
      eventId,
      title: "Test",
      filename: "test.pdf",
      mimeType: "application/pdf",
      encryptedContent: encrypt(Buffer.from("%PDF-test").toString("base64")),
      published: false,
    })
    .returning();
  await database
    .insert(s.attendance)
    .values({ participantId: personId, method: "MANUAL" });
  await expect(downloadMaterial(personId, m.id, db)).rejects.toMatchObject({
    status: 403,
  });
  await setMaterialsUnlocked(eventId, adminId, true);
  await expect(downloadMaterial(personId, m.id, db)).rejects.toMatchObject({
    status: 404,
  });
  await manageMaterial(eventId, adminId, m.id, "PATCH", {
    title: "Nowy tytuł",
    published: true,
  });
  expect((await downloadMaterial(personId, m.id, db)).status).toBe(200);
  await expect(
    manageMaterial(otherEventId, adminId, m.id, "DELETE"),
  ).rejects.toMatchObject({ status: 404 });
});
test("administrator cannot demote own account", async () => {
  await expect(
    saveTeamMember(eventId, adminId, {
      email: "admin@example.test",
      role: "CHECKIN",
    }),
  ).rejects.toMatchObject({ status: 409 });
});
test("cleanup deletes expired imports only and keeps active imports", async () => {
  const row = {
    row: 2,
    firstName: "Test",
    lastName: "Test",
    email: "test@example.test",
    errors: [],
  };
  await database.insert(s.importBatches).values([
    { eventId, adminId, rows: [row], expiresAt: new Date(0) },
    { eventId, adminId, rows: [row], expiresAt: new Date(Date.now() + 60000) },
  ]);
  expect((await cleanupData(eventId, adminId)).imports).toBe(1);
  expect(await database.select().from(s.importBatches)).toHaveLength(1);
});

test("controller can read data but cannot administer or check in", async () => {
  await saveTeamMember(eventId, adminId, {
    email: "controller@example.test",
    password: "test-controller-password",
    role: "CONTROLLER",
  });
  const [controller] = await database
    .select()
    .from(s.admins)
    .where(eq(s.admins.email, "controller@example.test"));
  await expect(
    requireEvent(controller.id, eventId, db, "READ"),
  ).resolves.toMatchObject({ role: "CONTROLLER" });
  await expect(
    requireEvent(controller.id, eventId, db, "ADMIN"),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    requireEvent(controller.id, eventId, db, "CHECKIN"),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    requireEvent(controller.id, otherEventId, db, "READ"),
  ).rejects.toMatchObject({ status: 403 });
});

test("manual duplicate is rejected without changing existing credentials", async () => {
  const before = await database.select().from(s.participants);
  await expect(
    createParticipant(
      eventId,
      adminId,
      { firstName: " eWa ", lastName: "TESTOWA", email: "anna@example.test" },
      db,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await database.select().from(s.participants)).toEqual(before);
});

test("activity uses all successful login records, isolates events and keeps shared mailboxes separate", async () => {
  const a = await createParticipant(
    eventId,
    adminId,
    { firstName: "Aktywna", lastName: "Osoba", email: "activity@example.test" },
    db,
  );
  const b = await createParticipant(
    eventId,
    adminId,
    {
      firstName: "Nieaktywna",
      lastName: "Osoba",
      email: "activity@example.test",
    },
    db,
  );
  const first = new Date("2026-10-01T08:00:00Z");
  const last = new Date("2026-10-20T08:00:00Z");
  await database.insert(s.auditLogs).values([
    {
      eventId,
      targetId: a.id,
      action: "PARTICIPANT_PRIVACY_ACK_2026-10-15-v1",
      createdAt: first,
    },
    {
      eventId,
      targetId: a.id,
      action: "PARTICIPANT_PRIVACY_ACK_future-version",
      createdAt: last,
    },
    {
      eventId: otherEventId,
      targetId: b.id,
      action: "PARTICIPANT_PRIVACY_ACK_2026-10-15-v1",
    },
    { eventId, targetId: b.id, action: "PARTICIPANT_CREATED" },
    ...Array.from({ length: 60 }, () => ({
      eventId,
      targetId: b.id,
      action: "SMTP_EMAIL_ACCEPTED",
    })),
  ]);
  const people = await participantList(eventId);
  const active = people.filter((p) => p.id === a.id);
  expect(active).toHaveLength(1);
  expect(new Date(active[0].firstLoginAt!).toISOString()).toBe(
    first.toISOString(),
  );
  expect(new Date(active[0].lastLoginAt!).toISOString()).toBe(
    last.toISOString(),
  );
  expect(people.find((p) => p.id === b.id)?.firstLoginAt).toBeNull();
  expect(people.find((p) => p.id === b.id)?.lastLoginAt).toBeNull();
});

test("history search and pagination continue to find encrypted SMTP recipients without crossing event boundaries", async () => {
  await database.insert(s.auditLogs).values(
    Array.from({ length: 103 }, (_, i) => ({
      eventId,
      adminId,
      targetId: personId,
      action: "SMTP_SELECTED_ACCEPTED lookup@example.test #" + i,
    })),
  );
  await database
    .insert(s.auditLogs)
    .values({
      eventId: otherEventId,
      adminId,
      action: "SMTP_TEST_ACCEPTED lookup@example.test",
    });
  const raw = await pg.query<{ action: string }>(
    "SELECT action FROM audit_logs WHERE action LIKE 'SMTP_SELECTED_ACCEPTED %'",
  );
  expect(
    raw.rows.every((row) => !row.action.includes("lookup@example.test")),
  ).toBe(true);
  const first = await history(
    eventId,
    new URL("https://test.invalid/?q=LOOKUP%40EXAMPLE.TEST"),
  );
  const second = await history(
    eventId,
    new URL("https://test.invalid/?q=LOOKUP%40EXAMPLE.TEST&offset=100"),
  );
  expect(first).toHaveLength(100);
  expect(second).toHaveLength(3);
  expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(103);
  expect([...first, ...second].every((row) => row.targetId === personId)).toBe(
    true,
  );
  expect(
    await history(
      eventId,
      new URL("https://test.invalid/?q=lookup&target=" + adminId),
    ),
  ).toHaveLength(0);
});
