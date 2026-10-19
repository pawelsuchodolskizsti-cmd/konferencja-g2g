import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { hashToken, newCredentials } from "../src/server/crypto";

const state = vi.hoisted(() => ({
  database: undefined as unknown,
  token: "",
  set: vi.fn(),
}));
vi.mock("@/db", () => ({ db: () => state.database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.token ? { value: state.token } : undefined),
    set: state.set,
  }),
}));
import { loginParticipant, requireParticipant } from "../src/server/auth";

import {
  PARTICIPANT_PRIVACY_VERSION,
  PARTICIPANT_PRIVACY_ACTION,
} from "../src/lib/participant-privacy";
const pg = new PGlite();
const database = drizzle(pg);
let participantId: string;
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper".repeat(8);
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0005_schema.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0006_schema.sql", "utf8"));
  const [event] = await database
    .insert(schema.events)
    .values({
      slug: "auth-test",
      name: "Test",
      organizer: "Test",
      location: "Sala",
      startsAt: new Date("2026-10-27T09:00:00Z"),
      endsAt: new Date("2026-10-27T17:00:00Z"),
      certificateUnlockAt: new Date("2026-10-27T17:00:00Z"),
      mailFrom: "test@example.org",
    })
    .returning();
  const [person] = await database
    .insert(schema.participants)
    .values({
      ...newCredentials(),
      accessHash: hashToken("ABC123"),
      eventId: event.id,
      firstName: "Test",
      lastName: "Uczestnik",
      email: "test@example.org",
    })
    .returning();
  participantId = person.id;
});
afterAll(async () => pg.close());

test("missing privacy agreement prevents login, also before attendance", async () => {
  await expect(loginParticipant("ABC123", "absent")).rejects.toMatchObject({ status: 400 });
  expect(state.set).not.toHaveBeenCalled();
  expect(await database.select().from(schema.sessions)).toHaveLength(0);
});

test("privacy consent is required, but session remains valid before check-in and after attendance removal", async () => {
  state.token = "a".repeat(43);
  await database.insert(schema.sessions).values({
    participantId,
    tokenHash: hashToken(state.token),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await expect(requireParticipant()).rejects.toMatchObject({ status: 403 });
  // Samo zeskanowanie QR nie zastępuje zaakceptowania klauzuli RODO.
  await expect(loginParticipant("ABC123", "missing")).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    loginParticipant("ABC123", "old", true, "old-version"),
  ).rejects.toMatchObject({ status: 400 });
  expect(await database.select().from(schema.auditLogs)).toHaveLength(0);
  await expect(
    loginParticipant("ABC123", "present", true, PARTICIPANT_PRIVACY_VERSION),
  ).resolves.toBeUndefined();
  const records = await database.select().from(schema.auditLogs);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    targetId: participantId,
    action: PARTICIPANT_PRIVACY_ACTION,
  });
  await expect(requireParticipant()).resolves.toMatchObject({
    id: participantId,
  });

  expect(state.set).toHaveBeenCalledWith(
    "participant_session",
    expect.any(String),
    expect.any(Object),
  );
  await database
    .delete(schema.attendance)
    .where(eq(schema.attendance.participantId, participantId));
  await expect(requireParticipant()).resolves.toMatchObject({ id: participantId });
});

test("250 distinct participants can log in through one shared Wi-Fi IP", async () => {
  const [original] = await database
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.id, participantId));
  const codes = Array.from(
    { length: 250 },
    (_, i) => `W${String(i).padStart(5, "0")}`,
  );
  const people = await database
    .insert(schema.participants)
    .values(
      codes.map((code, i) => ({
        ...newCredentials(),
        accessHash: hashToken(code),
        eventId: original.eventId,
        firstName: "Test",
        lastName: `WiFi ${i}`,
        email: `wifi-${i}@example.test`,
      })),
    )
    .returning({ id: schema.participants.id });
  await database
    .insert(schema.attendance)
    .values(
      people.map((p) => ({ participantId: p.id, method: "QR" as const })),
    );
  const results = await Promise.allSettled(
    codes.map((code) =>
      loginParticipant(code, "shared-wifi", true, PARTICIPANT_PRIVACY_VERSION),
    ),
  );
  expect(results.filter((r) => r.status === "rejected")).toEqual([]);
}, 20000);

test("repeated code guesses remain limited independently of other users", async () => {
  for (let i = 0; i < 8; i++)
    await expect(
      loginParticipant(
        "ZZZZZZ",
        "guessing-ip",
        true,
        PARTICIPANT_PRIVACY_VERSION,
      ),
    ).rejects.toMatchObject({ status: 401 });
  await expect(
    loginParticipant(
      "ZZZZZZ",
      "guessing-ip",
      true,
      PARTICIPANT_PRIVACY_VERSION,
    ),
  ).rejects.toMatchObject({ status: 429 });
  await expect(
    loginParticipant(
      "W00000",
      "guessing-ip",
      true,
      PARTICIPANT_PRIVACY_VERSION,
    ),
  ).resolves.toBeUndefined();
});

test("lost commit acknowledgement does not duplicate a session or privacy record", async () => {
  const beforeSessions = await database.select().from(schema.sessions);
  const beforeAudit = await database.select().from(schema.auditLogs);
  const transaction = database.transaction.bind(database);
  let loseAcknowledgement = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const spy = vi
    .spyOn(database, "transaction")
    .mockImplementation(async (...args) => {
      const result = await transaction(...args);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw Object.assign(
          new Error("simulated connection loss after commit"),
          { code: "ECONNRESET" },
        );
      }
      return result;
    });
  try {
    await loginParticipant(
      "W00001",
      "retry-test",
      true,
      PARTICIPANT_PRIVACY_VERSION,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await database.select().from(schema.sessions)).toHaveLength(
      beforeSessions.length + 1,
    );
    expect(await database.select().from(schema.auditLogs)).toHaveLength(
      beforeAudit.length + 1,
    );
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
});

test("participant can log in while still absent and receive session", async () => {
  const [person] = await database.insert(schema.participants).values({
    ...newCredentials(), accessHash: hashToken("B4F0RE"),
    eventId: (await database.select().from(schema.participants).limit(1))[0].eventId,
    firstName: "Nowa", lastName: "Osoba", email: "early@example.org",
  }).returning();
  expect((await database.select().from(schema.attendance).where(eq(schema.attendance.participantId, person.id)))).toHaveLength(0);
  await expect(loginParticipant("B4F0RE", "before-gate", true, PARTICIPANT_PRIVACY_VERSION)).resolves.toBeUndefined();
  const logs = await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, person.id));
  expect(logs.some((row) => row.action === PARTICIPANT_PRIVACY_ACTION)).toBe(true);
});
