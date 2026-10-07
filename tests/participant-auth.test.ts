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

const pg = new PGlite();
const database = drizzle(pg);
let participantId: string;
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper".repeat(8);
  await pg.exec(await readFile("drizzle/0000_initial.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0001_schema.sql", "utf8"));
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

test("valid code cannot create a session before attendance is confirmed", async () => {
  await expect(loginParticipant("ABC123", "absent")).rejects.toMatchObject({
    status: 403,
  });
  expect(state.set).not.toHaveBeenCalled();
  expect(await database.select().from(schema.sessions)).toHaveLength(0);
});

test("an existing session is rejected until check-in and after attendance removal", async () => {
  state.token = "a".repeat(43);
  await database
    .insert(schema.sessions)
    .values({
      participantId,
      tokenHash: hashToken(state.token),
      expiresAt: new Date(Date.now() + 3600000),
    });
  await expect(requireParticipant()).rejects.toMatchObject({ status: 403 });
  await database
    .insert(schema.attendance)
    .values({ participantId, method: "QR" });
  await expect(requireParticipant()).resolves.toMatchObject({
    id: participantId,
  });
  await expect(loginParticipant("ABC123", "present")).resolves.toBeUndefined();
  expect(state.set).toHaveBeenCalledWith(
    "participant_session",
    expect.any(String),
    expect.any(Object),
  );
  await database
    .delete(schema.attendance)
    .where(eq(schema.attendance.participantId, participantId));
  await expect(requireParticipant()).rejects.toMatchObject({ status: 403 });
});
