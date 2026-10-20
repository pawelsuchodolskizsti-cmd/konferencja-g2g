import { beforeAll, afterAll, beforeEach, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { newCredentials, decrypt } from "../src/server/crypto";
import {
  PARTICIPANT_PRIVACY_ACTION,
  PARTICIPANT_PRIVACY_VERSION,
} from "../src/lib/participant-privacy";
const state = vi.hoisted(() => ({
  database: undefined as unknown,
  token: "",
  set: vi.fn(),
}));
vi.mock("@/db", () => ({ db: () => state.database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: state.set,
    get: () => (state.token ? { value: state.token } : undefined),
  }),
}));
import { loginParticipant, requireParticipant } from "../src/server/auth";
import { participantList } from "../src/server/admin-data";
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string;
let otherEventId: string;
let seq = 0;
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "returning-login-test-".repeat(4);
  for (const file of [
    "0000_initial",
    "0001_schema",
    "0002_schema",
    "0003_schema",
    "0004_anonymous_survey",
    "0005_schema",
    "0006_schema",
    "0008_smtp_campaign",
    "0009_courses_unlock",
  ])
    await pg.exec(await readFile(`drizzle/${file}.sql`, "utf8"));
  const values = {
    name: "Test",
    organizer: "Test",
    location: "Test",
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 3600000),
    certificateUnlockAt: new Date(),
    mailFrom: "test@example.org",
  };
  const events = await database
    .insert(schema.events)
    .values([
      { ...values, slug: "login-test" },
      { ...values, slug: "other-login-test" },
    ])
    .returning();
  eventId = events[0].id;
  otherEventId = events[1].id;
});
beforeEach(() => {
  state.set.mockClear();
  state.token = "";
});
afterAll(async () => pg.close());
async function person() {
  const credentials = newCredentials();
  const [p] = await database
    .insert(schema.participants)
    .values({
      eventId,
      firstName: "Test",
      lastName: String(++seq),
      email: "shared@example.test",
      ...credentials,
    })
    .returning();
  return {
    ...p,
    code: JSON.parse(decrypt(credentials.credentials)).accessCode as string,
  };
}
test("first login requires explicit acknowledgement of the current version", async () => {
  const p = await person();
  await expect(
    loginParticipant(p.code, "first", false, PARTICIPANT_PRIVACY_VERSION),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    loginParticipant(p.code, "first", true, "old"),
  ).rejects.toMatchObject({ status: 400 });
  expect(state.set).not.toHaveBeenCalled();
  expect(
    await database
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.participantId, p.id)),
  ).toHaveLength(0);
});
test("returning cannot bypass acknowledgement, even with forged checkbox or another person's acknowledgement", async () => {
  const p = await person();
  const other = await person();
  await database.insert(schema.auditLogs).values({
    eventId,
    targetId: other.id,
    action: PARTICIPANT_PRIVACY_ACTION,
  });
  await expect(
    loginParticipant(
      p.code,
      "missing",
      true,
      PARTICIPANT_PRIVACY_VERSION,
      "returning",
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(state.set).not.toHaveBeenCalled();
  expect(
    await database
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.participantId, p.id)),
  ).toHaveLength(0);
});
test("old version or wrong conference does not authorize returning login", async () => {
  const p = await person();
  await database.insert(schema.auditLogs).values([
    { eventId, targetId: p.id, action: "PARTICIPANT_PRIVACY_ACK_old" },
    {
      eventId: otherEventId,
      targetId: p.id,
      action: PARTICIPANT_PRIVACY_ACTION,
    },
  ]);
  await expect(
    loginParticipant(p.code, "old", false, "", "returning"),
  ).rejects.toMatchObject({ status: 403 });
  expect(state.set).not.toHaveBeenCalled();
});
test("first then returning login works without repeating privacy acknowledgement and updates activity", async () => {
  const p = await person();
  await loginParticipant(p.code, "valid", true, PARTICIPANT_PRIVACY_VERSION);
  const [ack] = await database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.targetId, p.id),
        eq(schema.auditLogs.action, PARTICIPANT_PRIVACY_ACTION),
      ),
    );
  const old = new Date("2026-01-01T10:00:00Z");
  await database
    .update(schema.auditLogs)
    .set({ createdAt: old })
    .where(eq(schema.auditLogs.id, ack.id));
  state.set.mockClear();
  await loginParticipant(p.code.toLowerCase(), "valid", false, "", "returning");
  expect(state.set).toHaveBeenCalledOnce();
  state.token = state.set.mock.calls[0][1];
  expect((await requireParticipant()).id).toBe(p.id);
  const audits = await database
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.targetId, p.id));
  expect(
    audits.filter((a) => a.action === PARTICIPANT_PRIVACY_ACTION),
  ).toHaveLength(1);
  expect(audits.filter((a) => a.action === "PARTICIPANT_LOGIN")).toHaveLength(
    1,
  );
  const activity = (await participantList(eventId)).find(
    (row) => row.id === p.id,
  )!;
  expect(new Date(activity.firstLoginAt!).getTime()).toBe(old.getTime());
  expect(new Date(activity.lastLoginAt!).getTime()).toBeGreaterThan(
    old.getTime(),
  );
});
test("returning login rejects unknown codes and retains per-code rate limits", async () => {
  await expect(
    loginParticipant("ZZZZZZ", "invalid", false, "", "returning"),
  ).rejects.toMatchObject({ status: 401 });
  const p = await person();
  for (let i = 0; i < 8; i++)
    await expect(
      loginParticipant(p.code, "limited", false, "", "returning"),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    loginParticipant(p.code, "limited", false, "", "returning"),
  ).rejects.toMatchObject({ status: 429 });
});
