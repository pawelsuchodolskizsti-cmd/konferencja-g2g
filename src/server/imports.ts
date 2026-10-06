import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { db, type Database } from "@/db";
import {
  auditLogs,
  importBatches,
  participants,
  type ImportRow,
} from "@/db/schema";
import { assert, AppError } from "./errors";
import { newCredentials } from "./crypto";

export async function spreadsheet(
  file: File,
  csv = false,
): Promise<string[][]> {
  assert(
    file.size > 0 && file.size <= 2 * 1024 * 1024,
    400,
    "Plik musi mieć od 1 bajtu do 2 MB.",
  );
  const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
  assert(
    isXlsx || (csv && file.name.toLowerCase().endsWith(".csv")),
    400,
    csv ? "Wybierz plik XLSX lub CSV." : "Wybierz plik XLSX.",
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isXlsx) {
    assert(
      bytes[0] === 0x50 && bytes[1] === 0x4b,
      400,
      "Nieprawidłowy plik XLSX.",
    );
    let total = 0;
    let files = 0;
    // Check central-directory sizes before allocating decompressed content.
    unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        files++;
        assert(
          total <= 12 * 1024 * 1024 && files <= 120,
          400,
          "Arkusz jest zbyt rozbudowany.",
        );
        return false;
      },
    });
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      sheetRows: 2002,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
  } catch {
    throw new AppError(400, "Nie można odczytać arkusza.");
  }
  assert(workbook.SheetNames.length >= 1, 400, "Arkusz jest pusty.");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const range = XLSX.utils.decode_range(
    sheet["!fullref"] || sheet["!ref"] || "A1",
  );
  assert(
    range.e.r <= 2000 && range.e.c <= 30,
    400,
    "Limit importu: 2000 wierszy i 31 kolumn.",
  );
  return XLSX.utils
    .sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    })
    .map((row) => row.map((cell) => String(cell).trim()));
}
function heading(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s/g, "");
}
export function validateRows(
  raw: string[][],
  existing: Set<string>,
): ImportRow[] {
  assert(raw.length > 1, 400, "Brak uczestników w pliku.");
  const headers = raw[0].map(heading);
  const first = headers.indexOf("imie");
  const last = headers.indexOf("nazwisko");
  const mail = headers.indexOf("email");
  assert(
    first >= 0 && last >= 0 && mail >= 0,
    400,
    "Wymagane kolumny: Imię, Nazwisko, Email.",
  );
  const seen = new Set<string>();
  return raw.slice(1).map((row, index) => {
    const firstName = (row[first] || "").normalize("NFC");
    const lastName = (row[last] || "").normalize("NFC");
    const email = (row[mail] || "").toLowerCase();
    const errors: string[] = [];
    if (!firstName || firstName.length > 100 || /[\x00-\x1f]/.test(firstName))
      errors.push("Nieprawidłowe imię");
    if (!lastName || lastName.length > 100 || /[\x00-\x1f]/.test(lastName))
      errors.push("Nieprawidłowe nazwisko");
    if (!z.email().safeParse(email).success || email.length > 254)
      errors.push("Nieprawidłowy e-mail");
    if (seen.has(email)) errors.push("Duplikat w pliku");
    if (existing.has(email)) errors.push("Uczestnik już istnieje");
    seen.add(email);
    return { row: index + 2, firstName, lastName, email, errors };
  });
}
export async function previewImport(
  eventId: string,
  adminId: string,
  file: File,
) {
  const raw = await spreadsheet(file);
  const existing = await db()
    .select({ email: participants.email })
    .from(participants)
    .where(eq(participants.eventId, eventId));
  const rows = validateRows(raw, new Set(existing.map((p) => p.email)));
  const [batch] = await db()
    .insert(importBatches)
    .values({
      eventId,
      adminId,
      rows,
      expiresAt: new Date(Date.now() + 30 * 60000),
    })
    .returning();
  return {
    id: batch.id,
    rows,
    total: rows.length,
    valid: rows.filter((row) => !row.errors.length).length,
  };
}
export async function commitImport(
  batchId: string,
  eventId: string,
  adminId: string,
  database: Database = db(),
) {
  return database.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.eventId, eventId),
          eq(importBatches.adminId, adminId),
          gt(importBatches.expiresAt, new Date()),
        ),
      )
      .for("update");
    assert(
      batch && !batch.committedAt,
      409,
      "Podgląd wygasł lub import został już zatwierdzony.",
    );
    const values = batch.rows.filter((r) => !r.errors.length);
    assert(values.length, 400, "Brak poprawnych wierszy do importu.");
    let imported = 0;
    for (const row of values) {
      let resolved = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const [person] = await tx
          .insert(participants)
          .values({
            eventId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            ...newCredentials(),
          })
          .onConflictDoNothing()
          .returning({ id: participants.id });
        if (person) {
          imported++;
          resolved = true;
          break;
        }
        const [existing] = await tx
          .select({ id: participants.id })
          .from(participants)
          .where(
            and(
              eq(participants.eventId, eventId),
              eq(participants.email, row.email),
            ),
          );
        if (existing) {
          resolved = true;
          break;
        }
      }
      assert(
        resolved,
        503,
        "Nie udało się nadać unikalnego kodu. Spróbuj ponownie.",
      );
    }
    await tx
      .update(importBatches)
      .set({ committedAt: new Date(), rows: [] })
      .where(eq(importBatches.id, batchId));
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: "PARTICIPANTS_IMPORTED",
      targetId: batchId,
    });
    return {
      imported,
      skipped: values.length - imported,
    };
  });
}
export function safeCsv(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
