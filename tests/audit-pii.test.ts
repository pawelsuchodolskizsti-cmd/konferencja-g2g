import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "../src/db";
import { auditLogs } from "../src/db/schema";
import { openAuditAction, sealAuditAction } from "../src/db/audit-pii";
import { migrateAuditPii } from "../src/db/migrate-audit-pii";
const pg = new PGlite();
const database = drizzle(pg);
beforeAll(async () => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  await pg.exec(
    "CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, admin_id uuid, action text NOT NULL, target_id uuid, created_at timestamptz NOT NULL DEFAULT now())",
  );
});
afterAll(() => pg.close());
test("SMTP details use randomized authenticated encryption; operation predicates and exact display survive", async () => {
  const original =
    "SMTP_SELECTED_ACCEPTED Łukasz@example.org, other@example.org";
  const sealed = sealAuditAction(original);
  expect(sealed).toMatch(/^SMTP_SELECTED_ACCEPTED g2g:pii:v1:/);
  expect(sealed).not.toContain("@example.org");
  expect(sealAuditAction(original)).not.toBe(sealed);
  expect(sealAuditAction(sealed)).toBe(sealed);
  expect(openAuditAction(sealed)).toBe(original);
  expect(openAuditAction(original)).toBe(original);
  expect(sealAuditAction("PARTICIPANT_TEST_ACCOUNT")).toBe(
    "PARTICIPANT_TEST_ACCOUNT",
  );
  expect(sealAuditAction("PARTICIPANT_PRIVACY_ACK_%")).toBe(
    "PARTICIPANT_PRIVACY_ACK_%",
  );
  await database.insert(auditLogs).values({ action: original });
  const raw = await pg.query<{ action: string }>(
    "SELECT action FROM audit_logs",
  );
  expect(raw.rows[0].action).not.toContain("@example.org");
  expect((await database.select().from(auditLogs))[0].action).toBe(original);
});
test("legacy migration preserves every logical value, ID and timestamp, and can run twice", async () => {
  await pg.query("INSERT INTO audit_logs(action) VALUES ($1),($2)", [
    "SMTP_TEST_REVIEW SMTP_ACCEPTANCE test@example.org",
    "PARTICIPANT_TEST_ACCOUNT",
  ]);
  const before = (
    await pg.query<{ action: string }>("SELECT * FROM audit_logs ORDER BY id")
  ).rows.map((row) => ({ ...row, action: openAuditAction(row.action) }));
  const result = await migrateAuditPii(database as unknown as Database);
  expect(result.auditRowsMigrated).toBe(1);
  expect(result.exactValuesVerified).toBe(true);
  const after = (
    await pg.query<{ action: string }>("SELECT * FROM audit_logs ORDER BY id")
  ).rows;
  expect(
    after.map((row) => ({ ...row, action: openAuditAction(row.action) })),
  ).toEqual(before);
  expect(after.every((row) => !row.action.includes("@"))).toBe(true);
  expect(
    (await migrateAuditPii(database as unknown as Database)).auditRowsMigrated,
  ).toBe(0);
});
test("wrong key fails closed without changing stored history", async () => {
  const before = (await pg.query("SELECT * FROM audit_logs ORDER BY id")).rows;
  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  try {
    await expect(
      migrateAuditPii(database as unknown as Database),
    ).rejects.toThrow();
  } finally {
    process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  }
  expect((await pg.query("SELECT * FROM audit_logs ORDER BY id")).rows).toEqual(
    before,
  );
});
