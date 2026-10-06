import { expect, test } from "vitest";
import * as XLSX from "xlsx";
import { safeCsv, spreadsheet, validateRows } from "../src/server/imports";
test("import validates bad emails and duplicates both in file and database", () => {
  const result = validateRows(
    [
      ["Imię", "Nazwisko", "Email"],
      ["Jan", "Test", "A@example.org"],
      ["Jan", "Test", "a@example.org"],
      ["", "Test", "bad"],
      ["Ewa", "Test", "existing@example.org"],
    ],
    new Set(["existing@example.org"]),
  );
  expect(result.filter((r) => !r.errors.length)).toHaveLength(1);
  expect(result[1].errors).toContain("Duplikat w pliku");
  expect(result[2].errors).toHaveLength(2);
  expect(result[3].errors).toContain("Uczestnik już istnieje");
});
test("real XLSX roundtrip retains Polish column labels", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Imię", "Nazwisko", "Email"],
      ["Żaneta", "Łącka", "synthetic@example.org"],
    ]),
    "Uczestnicy",
  );
  const file = new File(
    [XLSX.write(book, { type: "array", bookType: "xlsx" })],
    "participants.xlsx",
  );
  expect((await spreadsheet(file))[1][0]).toBe("Żaneta");
});
test("export neutralizes formulas including leading whitespace", () => {
  expect(safeCsv("=1+1")).toBe('"\'=1+1"');
  expect(safeCsv("  @SUM(A1)")).toContain("'");
  expect(safeCsv("Kowalski")).toBe('"Kowalski"');
});
