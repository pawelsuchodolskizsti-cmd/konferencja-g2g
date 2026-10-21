import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import * as s from "../src/db/schema";
import { encrypt, hashToken, newCredentials } from "../src/server/crypto";
import { PARTICIPANT_PRIVACY_ACTION } from "../src/lib/participant-privacy";
const state = vi.hoisted(() => ({ database: undefined as unknown, token: "" }));
vi.mock("@/db", () => ({ db: () => state.database }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: state.token }) }),
}));
import { GET, PATCH } from "../src/app/api/admin/[...path]/route";
import { GET as materialGET } from "../src/app/api/participant/materials/[id]/route";

const pg = new PGlite();
const database = drizzle(pg);
const tokens: Record<string, string> = {};
let eventId: string,
  otherEventId: string,
  personId: string,
  otherPersonId: string;
let ownMaterial: string, otherMaterial: string;
const origin = "https://conference.example.test";
beforeAll(async () => {
  state.database = database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "security-test-pepper".repeat(4);
  process.env.APP_URL = origin;
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  const events = await database
    .insert(s.events)
    .values(
      ["security-a", "security-b"].map((slug) => ({
        slug,
        name: slug,
        organizer: "Test",
        location: "Test",
        startsAt: new Date(0),
        endsAt: new Date(1),
        certificateUnlockAt: new Date(1),
        mailFrom: "test@example.test",
      })),
    )
    .returning();
  [eventId, otherEventId] = events.map((e) => e.id);
  const people = await database
    .insert(s.participants)
    .values(
      events.map((e) => ({
        eventId: e.id,
        firstName: "Synthetic",
        lastName: "Test",
        email: "test@example.test",
        ...newCredentials(),
      })),
    )
    .returning();
  [personId, otherPersonId] = people.map((p) => p.id);
  for (const [i, role] of (
    ["ADMIN", "CHECKIN", "CONTROLLER"] as const
  ).entries()) {
    const [a] = await database
      .insert(s.admins)
      .values({ email: `${role}@example.test`, passwordHash: "unused" })
      .returning();
    await database
      .insert(s.adminEvents)
      .values({ adminId: a.id, eventId, role });
    tokens[role] = String(i).repeat(43);
    await database
      .insert(s.sessions)
      .values({
        adminId: a.id,
        tokenHash: hashToken(tokens[role]),
        expiresAt: new Date(Date.now() + 3600000),
      });
  }
  const [disabled] = await database
    .insert(s.admins)
    .values({
      email: "disabled@example.test",
      passwordHash: "unused",
      active: false,
    })
    .returning();
  tokens.disabled = "d".repeat(43);
  await database
    .insert(s.sessions)
    .values({
      adminId: disabled.id,
      tokenHash: hashToken(tokens.disabled),
      expiresAt: new Date(Date.now() + 3600000),
    });
  tokens.participant = "p".repeat(43);
  tokens.expired = "x".repeat(43);
  await database.insert(s.sessions).values([
    {
      participantId: personId,
      tokenHash: hashToken(tokens.participant),
      expiresAt: new Date(Date.now() + 3600000),
    },
    {
      participantId: personId,
      tokenHash: hashToken(tokens.expired),
      expiresAt: new Date(0),
    },
  ]);
  await database
    .insert(s.auditLogs)
    .values({
      eventId,
      targetId: personId,
      action: PARTICIPANT_PRIVACY_ACTION,
    });
  await database
    .insert(s.attendance)
    .values({ participantId: personId, method: "MANUAL" });
  const materials = await database
    .insert(s.materials)
    .values(
      events.map((e) => ({
        eventId: e.id,
        title: "Test",
        filename: "test.pdf",
        mimeType: "application/pdf",
        encryptedContent: encrypt(Buffer.from("%PDF-test").toString("base64")),
        published: true,
      })),
    )
    .returning();
  [ownMaterial, otherMaterial] = materials.map((m) => m.id);
});
afterAll(async () => {
  await pg.close();
});
async function adminRequest(
  role: string,
  event: string,
  suffix: string[],
  method = "GET",
  requestOrigin = origin,
) {
  state.token = tokens[role] || "";
  const path = ["events", event, ...suffix];
  const request = new Request(`${origin}/api/admin/${path.join("/")}`, {
    method,
    headers: { origin: requestOrigin, "content-type": "application/json" },
    ...(method === "GET"
      ? {}
      : {
          body: JSON.stringify({
            firstName: "Changed",
            lastName: "Changed",
            email: "changed@example.test",
          }),
        }),
  });
  return (method === "GET" ? GET : PATCH)(request, {
    params: Promise.resolve({ path }),
  });
}
test("anonymous, participant and disabled administrator cannot read administrative data", async () => {
  for (const role of ["anonymous", "participant", "disabled", "expired"])
    expect((await adminRequest(role, eventId, ["privacy"])).status).toBe(401);
});
test("role permissions apply at API boundary and do not modify participants", async () => {
  const before = await database.select().from(s.participants);
  expect((await adminRequest("CONTROLLER", eventId, ["privacy"])).status).toBe(
    200,
  );
  for (const role of ["CONTROLLER", "CHECKIN"]) {
    expect(
      (await adminRequest(role, eventId, ["participants", personId], "PATCH"))
        .status,
    ).toBe(403);
    expect((await adminRequest(role, eventId, ["team"])).status).toBe(403);
  }
  expect((await adminRequest("CHECKIN", eventId, ["privacy"])).status).toBe(
    403,
  );
  expect(
    (await adminRequest("CONTROLLER", eventId, ["checkin-people"])).status,
  ).toBe(403);
  expect(await database.select().from(s.participants)).toEqual(before);
});
test("foreign event and participant identifiers do not permit reading or editing other conferences", async () => {
  const before = await database.select().from(s.participants);
  for (const role of ["ADMIN", "CHECKIN", "CONTROLLER"])
    expect((await adminRequest(role, otherEventId, ["privacy"])).status).toBe(
      403,
    );
  expect(
    (
      await adminRequest(
        "ADMIN",
        eventId,
        ["participants", otherPersonId],
        "PATCH",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await adminRequest("ADMIN", eventId, [
        "participants",
        otherPersonId,
        "data",
      ])
    ).status,
  ).toBe(404);
  expect(await database.select().from(s.participants)).toEqual(before);
});
test("cross-site write is rejected before any participant changes", async () => {
  const before = await database.select().from(s.participants);
  expect(
    (
      await adminRequest(
        "ADMIN",
        eventId,
        ["participants", personId],
        "PATCH",
        "https://attacker.example.test",
      )
    ).status,
  ).toBe(403);
  expect(await database.select().from(s.participants)).toEqual(before);
});
test("participant material download is bound to their conference and session", async () => {
  const get = (id: string) =>
    materialGET(new Request(`${origin}/api/participant/materials/${id}`), {
      params: Promise.resolve({ id }),
    });
  state.token = tokens.participant;
  expect((await get(ownMaterial)).status).toBe(200);
  expect((await get(otherMaterial)).status).toBe(404);
  state.token = tokens.expired;
  expect((await get(ownMaterial)).status).toBe(401);
  state.token = tokens.ADMIN;
  expect((await get(ownMaterial)).status).toBe(401);
});
