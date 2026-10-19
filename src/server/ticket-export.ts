import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, asc, and, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { zipSync } from "fflate";
import { db } from "@/db";
import { participants, events, auditLogs } from "@/db/schema";
import { decrypt } from "./crypto";
import { assert } from "./errors";
import { invitationConfig, selectedPeople } from "./admin-operations";
import type { ParticipantFilter } from "@/lib/participant-filter";
import { safeCsv } from "./imports";
import { pdfStream } from "./incremental-pdf";

type Person = typeof participants.$inferSelect;
type Event = typeof events.$inferSelect;
export const TICKET_BATCH_SIZE = 50;
let invitationBackground: Promise<Buffer> | undefined;
function backgroundBytes() {
  // PDF-compatible copy of the participant panel's portrait background.
  return (invitationBackground ??= readFile(
    path.join(process.cwd(), "assets/invitation-background.jpg"),
  ).catch((error) => {
    invitationBackground = undefined;
    throw error;
  }));
}
export function exportRows(people: Person[], origin: string) {
  return [
    ["Imię", "Nazwisko", "Email", "Kod", "Link do strefy", "Plik biletu"],
    ...people.map((person) => {
      const { accessCode } = JSON.parse(decrypt(person.credentials));
      return [
        person.firstName,
        person.lastName,
        person.email,
        String(accessCode),
        `${origin}/uczestnik`,
        `bilet-${person.id}.pdf`,
      ];
    }),
  ];
}

export function codesWorkbook(rows: string[][]): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [22, 28, 42, 14, 44, 52].map((wch) => ({ wch }));
  for (let row = 1; row < rows.length; row++) {
    sheet[`D${row + 1}`].z = "@";
  }
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Uczestnicy i kody");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

export async function renderTicket(
  person: Person,
  event: Event,
  origin: string,
  fontBytes: Uint8Array,
  invitation?: { title: string; message: string },
) {
  const { accessCode, qrToken } = JSON.parse(decrypt(person.credentials));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.addPage([420, 595]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 420,
    height: 595,
    color: rgb(0.07, 0.42, 0.67),
  });
  if (invitation) {
    const background = await pdf.embedJpg(await backgroundBytes());
    const scale = Math.max(420 / background.width, 595 / background.height);
    const width = background.width * scale;
    const height = background.height * scale;
    page.drawImage(background, {
      x: (420 - width) / 2,
      y: 595 - height,
      width,
      height,
    });
  }
  const center = (text: string, y: number, size: number) => {
    while (font.widthOfTextAtSize(text, size) > 372 && size > 5) size--;
    page.drawText(text, {
      x: (420 - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color: rgb(1, 1, 1),
    });
  };
  center(event.organizer, 558, 12);
  center(event.name, 516, 29);
  center(invitation?.title || "BILET UCZESTNIKA", 488, 11);
  const date = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeZone: event.timezone,
  }).format(event.startsAt);
  const time = (value: Date) =>
    new Intl.DateTimeFormat("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: event.timezone,
    }).format(value);
  center(`${date} | ${time(event.startsAt)} - ${time(event.endsAt)}`, 455, 12);
  center(event.location, 434, 12);
  center(`${person.firstName} ${person.lastName}`, 396, 21);
  if (invitation) {
    const words = invitation.message.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, 10) > 372 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    // Template length is capped; keep up to two fitted lines above the QR.
    const displayed =
      lines.length > 2 ? [lines[0], lines.slice(1).join(" ")] : lines;
    displayed.forEach((text, i) => center(text, 380 - i * 13, 10));
  }
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(`${origin}/checkin/${qrToken}`, {
      width: 480,
      margin: 4,
      errorCorrectionLevel: "M",
    }),
  );
  page.drawImage(qr, { x: 120, y: 174, width: 180, height: 180 });
  center("Pokaż kod QR przy wejściu na konferencję.", 153, 11);
  center("TWÓJ KOD DO STREFY UCZESTNIKA", 118, 9);
  center(String(accessCode), 82, 30);
  center(`${origin}/uczestnik`, 57, 11);
  center("Dostęp do szkoleń po potwierdzeniu obecności.", 30, 9);
  return pdf.save();
}

export async function exportTickets(
  eventId: string,
  adminId: string,
  format: "xlsx" | "csv" | "zip" | "pdf",
  offset = 0,
  selection: ParticipantFilter = {},
) {
  const origin = new URL(process.env.APP_URL!).origin;
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, eventId));
  assert(event, 404, "Brak konferencji.");
  const selected = await selectedPeople(eventId, selection);
  assert(selected.length, 400, "Brak uczestników dla wybranego filtra.");
  const config = await invitationConfig(eventId);
  const query = db()
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
  const people =
    format === "zip"
      ? await query.limit(TICKET_BATCH_SIZE).offset(offset)
      : await query;
  assert(people.length, 400, "Najpierw zaimportuj uczestników.");
  const rows = exportRows(people, origin);
  let content: Uint8Array | string;
  let type: string;
  let filename: string;
  if (format === "pdf") {
    assert(people.length === 1, 400, "Wybierz jednego uczestnika.");
    const font = await readFile(
      path.join(process.cwd(), "assets/NotoSans-Regular.ttf"),
    );
    content = await renderTicket(people[0], event, origin, font, config);
    type = "application/pdf";
    filename = "zaproszenie.pdf";
  } else if (format === "zip") {
    const font = await readFile(
      path.join(process.cwd(), "assets/NotoSans-Regular.ttf"),
    );
    const files: Record<string, Uint8Array> = {
      "uczestnicy-z-kodami.xlsx": codesWorkbook(rows),
    };
    for (const person of people)
      files[`bilet-${person.id}.pdf`] = await renderTicket(
        person,
        event,
        origin,
        font,
        config,
      );
    files["uczestnicy-z-kodami.csv"] = new TextEncoder().encode(
      "\uFEFF" + rows.map((row) => row.map(safeCsv).join(";")).join("\r\n"),
    );
    content = zipSync(files, { level: 1 });
    type = "application/zip";
    filename = `bilety-${offset + 1}-${offset + people.length}.zip`;
  } else if (format === "csv") {
    content =
      "\uFEFF" + rows.map((row) => row.map(safeCsv).join(";")).join("\r\n");
    type = "text/csv; charset=utf-8";
    filename = "uczestnicy-z-kodami.csv";
  } else {
    content = codesWorkbook(rows);
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    filename = "uczestnicy-z-kodami.xlsx";
  }
  await db()
    .insert(auditLogs)
    .values({
      eventId,
      adminId,
      action:
        format === "zip" || format === "pdf"
          ? "TICKETS_EXPORTED"
          : "PARTICIPANT_CODES_EXPORTED",
      targetId: eventId,
    });
  return new Response(
    typeof content === "string"
      ? content
      : format === "zip"
        ? pdfStream([content])
        : new Uint8Array(content),
    {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
