import { afterAll, beforeAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../src/db/schema";
import { openPii, sealPii, PII_PREFIX, openImportRows } from "../src/db/pii";
import { migrateParticipantPii } from "../src/db/migrate-pii";
import { newCredentials } from "../src/server/crypto";
import type { Database } from "../src/db";

const pg = new PGlite();
const db = drizzle(pg);
const migrate = () => migrateParticipantPii(db as unknown as Database);
let eventId: string, batchId: string;
let original: unknown[];
const imports = [
  {
    row: 2,
    firstName: "Żaneta",
    lastName: "Łącka",
    email: "shared@example.test",
    errors: [],
  },
];
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.TOKEN_PEPPER = "test-pepper".repeat(8);
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  for (const entry of journal.entries)
    await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  const [event] = await db
    .insert(s.events)
    .values({
      slug: "pii-test",
      name: "Test",
      organizer: "Test",
      location: "Test",
      startsAt: new Date(0),
      endsAt: new Date(1),
      certificateUnlockAt: new Date(1),
      mailFrom: "test@example.test",
    })
    .returning();
  eventId = event.id;
  const [admin] = await db
    .insert(s.admins)
    .values({ email: "admin@example.test", passwordHash: "test" })
    .returning();
  const [batch] = await db
    .insert(s.importBatches)
    .values({
      eventId,
      adminId: admin.id,
      rows: imports,
      expiresAt: new Date(Date.now() + 60000),
    })
    .returning();
  batchId = batch.id;
  await pg.query("UPDATE import_batches SET rows=$1::jsonb WHERE id=$2", [
    JSON.stringify(imports),
    batchId,
  ]);
  for (let i = 0; i < 250; i++) {
    const c = newCredentials();
    await pg.query(
      "INSERT INTO participants (event_id,first_name,last_name,email,certificate_name_override,access_hash,qr_hash,credentials) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        eventId,
        "Żaneta",
        `Łącka-Świętochowska ${i}`,
        i % 2 ? "shared@example.test" : `p${i}@example.test`,
        i % 3 ? null : "Żanety Łąckiej",
        c.accessHash,
        c.qrHash,
        c.credentials,
      ],
    );
  }
  original = (await pg.query("SELECT * FROM participants ORDER BY id")).rows;
});
afterAll(async () => pg.close());

test("PII uses random authenticated ciphertext and rejects wrong field, key and corruption", () => {
  const a = sealPii("Żaneta", "first_name");
  expect(a).not.toBe(sealPii("Żaneta", "first_name"));
  expect(openPii(a, "first_name")).toBe("Żaneta");
  expect(() => openPii(a, "last_name")).toThrow();
  expect(() => openPii(PII_PREFIX + "broken", "first_name")).toThrow();
  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  try {
    expect(() => openPii(a, "first_name")).toThrow();
  } finally {
    process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  }
});
test("legacy data remains readable before migration", async () => {
  const people = await db.select().from(s.participants);
  expect(people).toHaveLength(250);
  expect(people[0].firstName).toBe("Żaneta");
  expect((await db.select().from(s.importBatches))[0].rows).toEqual(imports);
});
test("wrong key is rejected even before legacy plaintext has been migrated", async () => {
  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  try {
    await expect(migrate()).rejects.toThrow();
  } finally {
    process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  }
  expect(
    (await pg.query("SELECT * FROM participants ORDER BY id")).rows,
  ).toEqual(original);
});
test("failure during updates rolls back every already encrypted row", async () => {
  await pg.exec(`CREATE FUNCTION fail_pii_test_update() RETURNS trigger AS $$ BEGIN
    IF NEW.last_name <> OLD.last_name AND OLD.id = (SELECT id FROM participants ORDER BY id OFFSET 1 LIMIT 1) THEN
      RAISE EXCEPTION 'Synthetic migration failure';
    END IF;
    RETURN NEW;
  END; $$ LANGUAGE plpgsql;
  CREATE TRIGGER fail_pii_test BEFORE UPDATE ON participants FOR EACH ROW EXECUTE FUNCTION fail_pii_test_update();`);
  try {
    await expect(migrate()).rejects.toThrow();
    expect(
      (await pg.query("SELECT * FROM participants ORDER BY id")).rows,
    ).toEqual(original);
  } finally {
    await pg.exec(
      "DROP TRIGGER fail_pii_test ON participants; DROP FUNCTION fail_pii_test_update();",
    );
  }
});
test("250 participant migration preserves every value, credential, identifier and timestamp", async () => {
  const result = await migrate();
  expect(result).toMatchObject({
    participantsVerified: 250,
    participantsMigrated: 250,
    importBatchesMigrated: 1,
    exactValuesVerified: true,
  });
  const raw = (
    await pg.query<Record<string, unknown>>(
      "SELECT * FROM participants ORDER BY id",
    )
  ).rows;
  const decoded = raw.map((p) => ({
    ...p,
    ...Object.fromEntries(
      ["first_name", "last_name", "email", "certificate_name_override"].map(
        (f) => [f, p[f] === null ? null : openPii(String(p[f]), f)],
      ),
    ),
  }));
  expect(decoded).toEqual(original);
  expect(JSON.stringify(raw)).not.toContain("Żaneta");
  expect(JSON.stringify(raw)).not.toContain("@example.test");
  const batch = (
    await pg.query<{ rows: unknown }>(
      "SELECT rows FROM import_batches WHERE id=$1",
      [batchId],
    )
  ).rows[0];
  expect(JSON.stringify(batch.rows)).not.toContain("@example.test");
  expect(openImportRows(batch.rows)).toEqual(imports);
  expect((await migrate()).participantsMigrated).toBe(0);
});
test("ORM edits and import previews remain encrypted; raw plaintext writes are rejected", async () => {
  const [person] = await db.select().from(s.participants);
  await db
    .update(s.participants)
    .set({ firstName: "Łukasz", email: "other@example.test" })
    .where(eq(s.participants.id, person.id));
  const [read] = await db
    .select()
    .from(s.participants)
    .where(eq(s.participants.id, person.id));
  expect(read.firstName).toBe("Łukasz");
  expect(read.email).toBe("other@example.test");
  await db
    .update(s.importBatches)
    .set({ rows: imports })
    .where(eq(s.importBatches.id, batchId));
  expect((await db.select().from(s.importBatches))[0].rows).toEqual(imports);
  await expect(
    pg.query("UPDATE participants SET email='plain@example.test' WHERE id=$1", [
      person.id,
    ]),
  ).rejects.toThrow();
  await expect(
    pg.query("UPDATE import_batches SET rows='[]'::jsonb WHERE id=$1", [
      batchId,
    ]),
  ).rejects.toThrow();
});
test("wrong encryption key aborts migration without changing stored data", async () => {
  const before = await pg.query("SELECT * FROM participants ORDER BY id");
  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  try {
    await expect(migrate()).rejects.toThrow();
  } finally {
    process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  }
  expect(
    (await pg.query("SELECT * FROM participants ORDER BY id")).rows,
  ).toEqual(before.rows);
});
