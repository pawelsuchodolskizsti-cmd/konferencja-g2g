import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { auditLogs, certificates } from "@/db/schema";
import { certificateAvailable, presentParticipant } from "./attendance";
import { assert } from "./errors";

export async function renderCertificate(input: {
  name: string;
  eventName: string;
  organizer: string;
  date: string;
  number: string;
}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), "assets/NotoSans-Regular.ttf")),
    { subset: true },
  );
  const page = pdf.addPage([841.89, 595.28]);
  const ink = rgb(0.07, 0.17, 0.24);
  const blue = rgb(0.07, 0.36, 0.87);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 842,
    height: 595,
    color: rgb(0.98, 0.99, 1),
  });
  page.drawRectangle({
    x: 26,
    y: 26,
    width: 790,
    height: 543,
    borderWidth: 1,
    borderColor: rgb(0.75, 0.81, 0.9),
  });
  page.drawRectangle({ x: 26, y: 549, width: 790, height: 20, color: blue });
  function center(
    text: string,
    y: number,
    size: number,
    fontFace: PDFFont = font,
  ) {
    while (fontFace.widthOfTextAtSize(text, size) > 720 && size > 10) size--;
    page.drawText(text, {
      x: (842 - fontFace.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font: fontFace,
      color: ink,
    });
  }
  center(input.organizer, 490, 15);
  center("CERTYFIKAT UCZESTNICTWA", 416, 30);
  center("Potwierdzamy, że", 355, 15);
  center(input.name, 304, 32);
  center("uczestniczył(a) w konferencji", 260, 15);
  center(input.eventName, 220, 22);
  center(input.date, 175, 16);
  page.drawLine({
    start: { x: 330, y: 138 },
    end: { x: 512, y: 138 },
    color: blue,
    thickness: 2,
  });
  center(`Numer certyfikatu: ${input.number}`, 83, 10);
  pdf.setTitle("Certyfikat uczestnictwa");
  pdf.setAuthor(input.organizer);
  return Buffer.from(await pdf.save());
}
export async function generateCertificate(
  participantId: string,
  database: Database = db(),
) {
  const { person, event } = await presentParticipant(participantId, database);
  assert(
    certificateAvailable(event),
    403,
    "Certyfikat będzie dostępny po zakończeniu konferencji.",
  );
  const [existing] = await database
    .select()
    .from(certificates)
    .where(eq(certificates.participantId, participantId));
  const number =
    existing?.number ||
    `CONF-${event.startsAt.getUTCFullYear()}-${person.id.toUpperCase()}`;
  const pdf = await renderCertificate({
    name: `${person.firstName} ${person.lastName}`,
    eventName: event.name,
    organizer: event.organizer,
    date: new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "long",
      timeZone: event.timezone,
    }).format(event.startsAt),
    number,
  });
  if (!existing)
    await database.transaction(async (tx) => {
      const inserted = await tx
        .insert(certificates)
        .values({ participantId, number })
        .onConflictDoNothing()
        .returning();
      if (inserted.length)
        await tx
          .insert(auditLogs)
          .values({
            eventId: event.id,
            action: "CERTIFICATE_GENERATED",
            targetId: participantId,
          });
    });
  return { pdf, number };
}
