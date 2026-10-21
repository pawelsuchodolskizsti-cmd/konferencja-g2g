import { sql } from "drizzle-orm";
import type { Database } from "./index";
import {
  openPii,
  sealPii,
  PII_PREFIX,
  openImportRows,
  sealImportRows,
} from "./pii";

type Row = Record<string, unknown>;
function rows(result: unknown): Row[] {
  return Array.isArray(result) ? result : (result as { rows: Row[] }).rows;
}
const fields = [
  "first_name",
  "last_name",
  "email",
  "certificate_name_override",
] as const;
function logicalPerson(row: Row) {
  return {
    ...row,
    ...Object.fromEntries(
      fields.map((f) => [
        f,
        row[f] === null ? null : openPii(String(row[f]), f),
      ]),
    ),
  };
}

/** Run only AFTER the compatible reader/writer has reached production.
 * All updates and exact-value checks commit together or roll back together.
 * Logs deliberately contain counts only, never plaintext or ciphertext.
 */
export async function migrateParticipantPii(
  database: Pick<Database, "transaction">,
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '15s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    await tx.execute(
      sql`LOCK TABLE participants, import_batches IN SHARE ROW EXCLUSIVE MODE`,
    );
    const before = rows(
      await tx.execute(sql`SELECT * FROM participants ORDER BY id`),
    );
    const batches = rows(
      await tx.execute(sql`SELECT * FROM import_batches ORDER BY id`),
    );
    const original = before.map(logicalPerson);
    const originalBatches = batches.map((b) => ({
      ...b,
      rows: openImportRows(b.rows),
    }));
    let migrated = 0;
    for (const person of before) {
      if (
        fields.every(
          (f) => person[f] === null || String(person[f]).startsWith(PII_PREFIX),
        )
      )
        continue;
      const values = fields.map((f) =>
        person[f] === null ? null : sealPii(openPii(String(person[f]), f), f),
      );
      await tx.execute(
        sql`UPDATE participants SET first_name=${values[0]}, last_name=${values[1]}, email=${values[2]}, certificate_name_override=${values[3]} WHERE id=${person.id}`,
      );
      migrated++;
    }
    let migratedBatches = 0;
    for (const batch of batches) {
      const raw =
        typeof batch.rows === "string" ? JSON.parse(batch.rows) : batch.rows;
      if (!Array.isArray(raw)) continue;
      await tx.execute(
        sql`UPDATE import_batches SET rows=${JSON.stringify(sealImportRows(raw))}::jsonb WHERE id=${batch.id}`,
      );
      migratedBatches++;
    }
    const after = rows(
      await tx.execute(sql`SELECT * FROM participants ORDER BY id`),
    );
    const afterBatches = rows(
      await tx.execute(sql`SELECT * FROM import_batches ORDER BY id`),
    );
    if (
      JSON.stringify(original) !== JSON.stringify(after.map(logicalPerson)) ||
      JSON.stringify(originalBatches) !==
        JSON.stringify(
          afterBatches.map((b) => ({ ...b, rows: openImportRows(b.rows) })),
        )
    )
      throw new Error(
        "PII migration verification failed; transaction rolled back",
      );
    if (
      after.some((p) =>
        fields.some(
          (f) => p[f] !== null && !String(p[f]).startsWith(PII_PREFIX),
        ),
      )
    )
      throw new Error(
        "PII migration left unprotected fields; transaction rolled back",
      );
    // Prevent an outdated worker or raw import from reintroducing plaintext.
    await tx.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='participants'::regclass AND conname='participant_pii_encrypted_v1') THEN
        ALTER TABLE participants ADD CONSTRAINT participant_pii_encrypted_v1 CHECK (
          starts_with(first_name, 'g2g:pii:v1:') AND starts_with(last_name, 'g2g:pii:v1:') AND starts_with(email, 'g2g:pii:v1:') AND
          (certificate_name_override IS NULL OR starts_with(certificate_name_override, 'g2g:pii:v1:'))
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='import_batches'::regclass AND conname='import_pii_encrypted_v1') THEN
        ALTER TABLE import_batches ADD CONSTRAINT import_pii_encrypted_v1 CHECK (
          jsonb_typeof(rows) = 'object' AND rows ? 'g2gEncryptedRows' AND
          jsonb_typeof(rows->'g2gEncryptedRows') = 'string' AND
          starts_with(rows->>'g2gEncryptedRows', 'g2g:pii:v1:')
        );
      END IF;
    END $$`);
    return {
      participantsVerified: after.length,
      participantsMigrated: migrated,
      importBatchesVerified: afterBatches.length,
      importBatchesMigrated: migratedBatches,
      exactValuesVerified: true,
    };
  });
}
