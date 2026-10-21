import { beforeAll, afterAll, test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../src/db";
import * as s from "../src/db/schema";
const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@/db", () => ({ db: () => state.database }));
import {
  beginMaterialUpload,
  appendMaterialChunk,
  finishMaterialUpload,
} from "../src/server/material-uploads";
import {
  materialsUnlocked,
  setMaterialsUnlocked,
} from "../src/server/material-access";
import { downloadMaterial } from "../src/server/materials";
import {
  createParticipant,
  manageMaterial,
} from "../src/server/admin-operations";
const pg = new PGlite();
const database = drizzle(pg);
let eventId: string, adminId: string, personId: string;
beforeAll(async () => {
  state.database = database as unknown as Database;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "pepper".repeat(10);
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  [adminId] = (
    await database
      .insert(s.admins)
      .values({ email: "upload@example.test", passwordHash: "unused" })
      .returning()
  ).map((a) => a.id);
  [eventId] = (
    await database
      .insert(s.events)
      .values({
        slug: "uploads",
        name: "Test",
        organizer: "Test",
        location: "Test",
        startsAt: new Date("2020-01-01"),
        endsAt: new Date("2020-01-02"),
        certificateUnlockAt: new Date("2020-01-02"),
        mailFrom: "test@example.test",
      })
      .returning()
  ).map((e) => e.id);
  personId = (
    await createParticipant(eventId, adminId, {
      firstName: "Test",
      lastName: "Material",
      email: "person@example.test",
    })
  ).id;
});
afterAll(() => pg.close());
test("large original bytes survive encrypted chunks and streamed download; manual gate applies to direct URLs", async () => {
  const bytes = Buffer.alloc(14602674, 42);
  bytes.write("%PDF-");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = await beginMaterialUpload(eventId, adminId, {
    filename: "test.pdf",
    size: bytes.length,
    sha256,
  });
  await expect(
    appendMaterialChunk(
      eventId,
      randomUUID(),
      upload.id,
      0,
      bytes.subarray(0, upload.chunkSize),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    finishMaterialUpload(eventId, adminId, upload.id),
  ).rejects.toMatchObject({ status: 400 });
  for (
    let offset = 0, index = 0;
    offset < bytes.length;
    offset += upload.chunkSize, index++
  )
    await appendMaterialChunk(
      eventId,
      adminId,
      upload.id,
      index,
      bytes.subarray(offset, offset + upload.chunkSize),
    );
  await appendMaterialChunk(
    eventId,
    adminId,
    upload.id,
    0,
    bytes.subarray(0, upload.chunkSize),
  );
  const item = await finishMaterialUpload(eventId, adminId, upload.id);
  expect(await finishMaterialUpload(eventId, adminId, upload.id)).toEqual(item);
  expect(await database.select().from(s.materials)).toHaveLength(1);
  expect(await materialsUnlocked(eventId)).toBe(false);
  await database
    .insert(s.attendance)
    .values({ participantId: personId, method: "MANUAL" });
  await expect(
    downloadMaterial(personId, String(item.id)),
  ).rejects.toMatchObject({ status: 403 });
  await setMaterialsUnlocked(eventId, adminId, true);
  const response = await downloadMaterial(personId, String(item.id));
  expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  const adminResponse = (await manageMaterial(
    eventId,
    adminId,
    String(item.id),
    "GET",
  )) as Response;
  expect(Buffer.from(await adminResponse.arrayBuffer()).equals(bytes)).toBe(
    true,
  );
  await setMaterialsUnlocked(eventId, adminId, false);
  await expect(
    downloadMaterial(personId, String(item.id)),
  ).rejects.toMatchObject({ status: 403 });
});
test("rejects oversized uploads and mismatched checksum", async () => {
  await expect(
    beginMaterialUpload(eventId, adminId, {
      filename: "test.pdf",
      size: 21 * 1024 * 1024,
      sha256: "a".repeat(64),
    }),
  ).rejects.toBeDefined();
  const upload = await beginMaterialUpload(eventId, adminId, {
    filename: "test.pdf",
    size: 5,
    sha256: "a".repeat(64),
  });
  await appendMaterialChunk(
    eventId,
    adminId,
    upload.id,
    0,
    Buffer.from("%PDF-"),
  );
  await expect(
    finishMaterialUpload(eventId, adminId, upload.id),
  ).rejects.toMatchObject({ status: 400 });
});
