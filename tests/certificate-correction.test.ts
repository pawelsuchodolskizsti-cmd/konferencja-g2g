import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
import { newCredentials } from "../src/server/crypto";
import { updateParticipant } from "../src/server/admin-data";
import { generateCertificate } from "../src/server/certificates";
import { renderCertificate } from "../src/server/certificate-pdf";
vi.mock("../src/server/certificate-pdf", () => ({
  renderCertificate: vi.fn(async () => Buffer.from("%PDF-test")),
}));
const pg = new PGlite();
const database = drizzle(pg);
const db = database as unknown as Database;
let person: typeof s.participants.$inferSelect;
let eventId: string;
let adminId: string;
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper".repeat(8);
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  const [event] = await database
    .insert(s.events)
    .values({
      slug: "certificate-correction",
      name: "Test",
      organizer: "Fundacja",
      location: "Sala",
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2020-01-02"),
      certificateUnlockAt: new Date("2020-01-02"),
      mailFrom: "test@example.org",
    })
    .returning();
  eventId = event.id;
  const [admin] = await database
    .insert(s.admins)
    .values({ email: "admin@example.org", passwordHash: "test" })
    .returning();
  adminId = admin.id;
  [person] = await database
    .insert(s.participants)
    .values({
      ...newCredentials(),
      eventId,
      firstName: "Żaneta",
      lastName: "Łącka-Świętochowska",
      email: "test@example.org",
    })
    .returning();
  await database
    .insert(s.attendance)
    .values({ participantId: person.id, method: "MANUAL", adminId });
});
afterAll(async () => pg.close());
const input = () => ({
  firstName: person.firstName,
  lastName: person.lastName,
  email: person.email,
});

test("admin correction persists, wins on repeat downloads and can be cleared", async () => {
  const original = await generateCertificate(person.id, db);
  expect(renderCertificate).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Żanety Łąckiej-Świętochowskiej" }),
  );
  await updateParticipant(
    eventId,
    adminId,
    person.id,
    { ...input(), certificateNameOverride: "  Żanety   Testowej " },
    db,
  );
  const [saved] = await database
    .select()
    .from(s.participants)
    .where(eq(s.participants.id, person.id));
  expect(saved.certificateNameOverride).toBe("Żanety Testowej");
  expect(saved.firstName).toBe(person.firstName);
  expect(saved.lastName).toBe(person.lastName);
  const corrected = await generateCertificate(person.id, db);
  expect(corrected.number).toBe(original.number);
  expect(renderCertificate).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Żanety Testowej" }),
  );
  await updateParticipant(eventId, adminId, person.id, input(), db);
  await generateCertificate(person.id, db);
  expect(renderCertificate).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Żanety Testowej" }),
  );
  await updateParticipant(
    eventId,
    adminId,
    person.id,
    { ...input(), certificateNameOverride: " " },
    db,
  );
  await generateCertificate(person.id, db);
  expect(renderCertificate).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Żanety Łąckiej-Świętochowskiej" }),
  );
  expect(await database.select().from(s.certificates)).toHaveLength(1);
  const log = await database.select().from(s.auditLogs);
  expect(
    log.filter((item) => item.action === "PARTICIPANT_UPDATED"),
  ).toHaveLength(3);
});

test("cannot edit a participant through another event", async () => {
  await expect(
    updateParticipant(
      "00000000-0000-4000-8000-000000000000",
      adminId,
      person.id,
      { ...input(), certificateNameOverride: "Nieuprawniona zmiana" },
      db,
    ),
  ).rejects.toMatchObject({ status: 404 });
});

test.each([
  "dla Żanety Testowej",
  "Żanety\nTestowej",
  "Żanety\u0000Testowej",
  "A".repeat(241),
  "<script>",
  "---",
])("rejects invalid correction %j", async (certificateNameOverride) => {
  await expect(
    updateParticipant(
      eventId,
      adminId,
      person.id,
      { ...input(), certificateNameOverride },
      db,
    ),
  ).rejects.toThrow();
});

test("manual correction does not bypass certificate unlock or attendance", async () => {
  await updateParticipant(
    eventId,
    adminId,
    person.id,
    { ...input(), certificateNameOverride: "Żanety Testowej" },
    db,
  );
  await database
    .update(s.events)
    .set({ certificateUnlockAt: new Date("2099-01-01") })
    .where(eq(s.events.id, eventId));
  await expect(generateCertificate(person.id, db)).rejects.toMatchObject({
    status: 403,
  });
  await database
    .update(s.events)
    .set({ certificateUnlockAt: new Date("2020-01-02") })
    .where(eq(s.events.id, eventId));
  await database
    .delete(s.attendance)
    .where(eq(s.attendance.participantId, person.id));
  await expect(generateCertificate(person.id, db)).rejects.toMatchObject({
    status: 403,
  });
});
