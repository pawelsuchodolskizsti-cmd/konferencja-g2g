import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export async function renderCertificate(input: {
  name: string;
  eventName: string;
  organizer: string;
  date: string;
  number: string;
}) {
  // Keep the supplied artwork, colour profile and page dimensions intact.
  // Only the participant's name is added; the certificate number stays in the DB.
  const pdf = await PDFDocument.load(
    await readFile(path.join(process.cwd(), "assets/certificate-template.pdf")),
  );
  pdf.registerFontkit(fontkit);
  const fontBytes = await readFile(
    path.join(process.cwd(), "public/branding/montserrat-bold.ttf"),
  );
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.getPage(0);
  // Coordinates in PDF points, measured on the original 612.24 × 858.96 page.
  const field = { x: 168, y: 617, width: 444.24, height: 34 };
  const padding = 12;
  const name = input.name.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!name) throw new Error("Imię i nazwisko uczestnika są wymagane.");
  const availableWidth = field.width - 2 * padding;
  const face = fontkit.create(fontBytes);
  const glyphs = face
    .layout(name)
    .glyphs.filter((glyph) => glyph.bbox.height > 0);
  const top =
    Math.max(...glyphs.map((glyph) => glyph.bbox.maxY)) / face.unitsPerEm;
  const bottom =
    Math.min(...glyphs.map((glyph) => glyph.bbox.minY)) / face.unitsPerEm;
  const size = Math.min(
    24,
    availableWidth / font.widthOfTextAtSize(name, 1),
    (field.height - 8) / (top - bottom),
  );
  const textHeight = (top - bottom) * size;
  page.drawText(name, {
    x: field.x + padding,
    y: field.y + (field.height - textHeight) / 2 - bottom * size,
    size,
    font,
    color: rgb(0, 0, 0),
  });
  pdf.setTitle("Certyfikat uczestnictwa");
  pdf.setAuthor(input.organizer);
  return Buffer.from(await pdf.save());
}
