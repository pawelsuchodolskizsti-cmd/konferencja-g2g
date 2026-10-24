import { sql } from "drizzle-orm";
import type { Database } from "./index";
import { openAuditAction, sealAuditAction } from "./audit-pii";

type Row = { id: string; action: string; [key: string]: unknown };
const rows = (result: unknown): Row[] =>
  Array.isArray(result) ? result : (result as { rows: Row[] }).rows;

/** Only changes ciphertext representation. IDs, timestamps and logical actions
 * are compared exactly in one transaction; any mismatch rolls back everything. */
export async function migrateAuditPii(database: Pick<Database, "transaction">) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(sql`LOCK TABLE audit_logs IN SHARE ROW EXCLUSIVE MODE`);
    const before = rows(
      await tx.execute(sql`SELECT * FROM audit_logs ORDER BY id`),
    );
    const logical = before.map((row) => ({
      ...row,
      action: openAuditAction(row.action),
    }));
    let migrated = 0;
    for (const row of before) {
      const encrypted = sealAuditAction(row.action);
      if (encrypted === row.action) continue;
      await tx.execute(
        sql`UPDATE audit_logs SET action=${encrypted} WHERE id=${row.id}`,
      );
      migrated++;
    }
    const after = rows(
      await tx.execute(sql`SELECT * FROM audit_logs ORDER BY id`),
    );
    if (
      JSON.stringify(logical) !==
      JSON.stringify(
        after.map((row) => ({
          ...row,
          action: openAuditAction(row.action),
        })),
      )
    )
      throw new Error(
        "Audit encryption verification failed; transaction rolled back",
      );
    if (after.some((row) => sealAuditAction(row.action) !== row.action))
      throw new Error(
        "Audit encryption left plaintext; transaction rolled back",
      );
    return {
      auditRowsVerified: after.length,
      auditRowsMigrated: migrated,
      exactValuesVerified: true,
    };
  });
}
