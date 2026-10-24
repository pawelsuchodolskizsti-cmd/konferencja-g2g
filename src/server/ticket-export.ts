import { eq, asc, and, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { participants, events, auditLogs } from "@/db/schema";
import { decrypt } from "./crypto";
import { assert } from "./errors";
import { selectedPeople } from "./admin-operations";
import type { ParticipantFilter } from "@/lib/participant-filter";
import { safeCsv } from "./imports";

type Person = typeof participants.$inferSelect;
export function exportRows(people: Person[], origin: string) {
  return [
    ["Imię", "Nazwisko", "Email", "Kod", "Link do strefy"],
    ...people.map((person) => {
      const { accessCode } = JSON.parse(decrypt(person.credentials));
      return [
        person.firstName,
        person.lastName,
        person.email,
        String(accessCode),
        origin + "/uczestnik",
      ];
    }),
  ];
}
export function codesWorkbook(rows: string[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [22, 28, 42, 14, 44].map((wch) => ({ wch }));
  for (let row = 1; row < rows.length; row++) {
    sheet[`D${row + 1}`].z = "@";
  }
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Uczestnicy i kody");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

export async function exportTickets(
  eventId: string,
  adminId: string,
  format: "xlsx" | "csv",
  _offset = 0,
  selection: ParticipantFilter = {},
) {
  void _offset;
  assert(
    format === "xlsx" || format === "csv",
    410,
    "Generowanie zaproszeń PDF zostało wyłączone. Użyj eksportu kodów.",
  );
  const origin = new URL(process.env.APP_URL!).origin;
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(event, 404, "Brak konferencji.");
  const selected = await selectedPeople(eventId, selection);
  assert(selected.length, 400, "Brak uczestników dla wybranego filtra.");
  const people = await db()
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.eventId, eventId),
        inArray(
          participants.id,
          selected.map((p) => p.id),
        ),
      ),
    )
    .orderBy(asc(participants.createdAt), asc(participants.id));
  const rows = exportRows(people, origin);
  const content =
    format === "csv"
      ? "\uFEFF" + rows.map((row) => row.map(safeCsv).join(";")).join("\r\n")
      : codesWorkbook(rows);
  await db()
    .insert(auditLogs)
    .values({
      eventId,
      adminId,
      action: "PARTICIPANT_CODES_EXPORTED",
      targetId: eventId,
    });
  return new Response(
    typeof content === "string" ? content : new Uint8Array(content),
    {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="uczestnicy-z-kodami.' + format + '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
