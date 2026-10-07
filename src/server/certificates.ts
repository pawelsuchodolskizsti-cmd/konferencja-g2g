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
  const ink = rgb(0.06, 0.35, 0.55);
  const blue = rgb(0.08, 0.47, 0.68);
  const white = rgb(1, 1, 1);
  page.drawRectangle({ x: 0, y: 0, width: 842, height: 596, color: blue });
  page.drawCircle({ x: 824, y: 575, size: 178, color: white, opacity: 0.09 });
  page.drawCircle({ x: 22, y: 7, size: 147, color: white, opacity: 0.08 });
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      page.drawCircle({
        x: 40 + col * 37,
        y: 280 + row * 37,
        size: 16,
        color: white,
        opacity: 0.13,
      });
    }
  }
  page.drawRectangle({ x: 119, y: 48, width: 675, height: 499, color: white });
  page.drawRectangle({
    x: 133,
    y: 62,
    width: 647,
    height: 471,
    borderWidth: 0.6,
    borderColor: blue,
    borderOpacity: 0.25,
  });
  const logo = await pdf.embedPng(
    await readFile(
      path.join(process.cwd(), "public/branding/g2g-horizontal.png"),
    ),
  );
  const logoSize = logo.scaleToFit(66, 34);
  page.drawImage(logo, { x: 26, y: 490, ...logoSize });
  function center(
    text: string,
    y: number,
    size: number,
    fontFace: PDFFont = font,
  ) {
    while (fontFace.widthOfTextAtSize(text, size) > 589 && size > 8) size--;
    page.drawText(text, {
      x: 456.5 - fontFace.widthOfTextAtSize(text, size) / 2,
      y,
      size,
      font: fontFace,
      color: ink,
    });
  }
  center(input.organizer, 495, 12);
  center("CERTYFIKAT", 431, 41);
  center("U C Z E S T N I C T W A", 402, 12);
  center("Certyfikat otrzymuje", 351, 12);
  center(input.name, 301, 31);
  page.drawLine({
    start: { x: 247, y: 281 },
    end: { x: 666, y: 281 },
    color: blue,
    thickness: 0.7,
    opacity: 0.3,
  });
  center("za udział w konferencji", 249, 12);
  center(input.eventName, 211, 26);
  center(input.date, 177, 13);
  center("Fundacja One Day", 117, 12);
  center("ORGANIZATOR", 100, 8);
  center(`Numer certyfikatu: ${input.number}`, 77, 7);
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
        await tx.insert(auditLogs).values({
          eventId: event.id,
          action: "CERTIFICATE_GENERATED",
          targetId: participantId,
        });
    });
  return { pdf, number };
}

