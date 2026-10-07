import { beforeAll, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { encrypt } from "../src/server/crypto";
import { codesWorkbook, exportRows } from "../src/server/ticket-export";
import { participants } from "../src/db/schema";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
});

test("mail merge export preserves existing codes, leading zeros, Polish text and literal spreadsheet content", () => {
  const person = {
    id: "synthetic-id",
    firstName: "Łukasz",
    lastName: "=1+1",
    email: "test@example.com",
    credentials: encrypt(
      JSON.stringify({ accessCode: "001234", qrToken: "synthetic-token" }),
    ),
  } as typeof participants.$inferSelect;
  const rows = exportRows([person], "https://konferencja-g2g.pl");
  expect(exportRows([person], "https://konferencja-g2g.pl")).toEqual(rows);
  const book = XLSX.read(codesWorkbook(rows), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  expect(sheet.A2.v).toBe("Łukasz");
  expect(sheet.B2.v).toBe("=1+1");
  expect(sheet.B2.f).toBeUndefined();
  expect(sheet.D2.t).toBe("s");
  expect(sheet.D2.v).toBe("001234");
  expect(sheet.F2.v).toBe("bilet-synthetic-id.pdf");
});
