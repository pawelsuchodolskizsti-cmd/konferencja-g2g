import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  PDFDocument,
  PDFRawStream,
  PDFName,
  PDFRef,
  PDFDict,
  PDFArray,
  PDFObject,
} from "pdf-lib";
import { expect, test } from "vitest";
import { renderCertificate } from "../src/server/certificate-pdf";

const details = {
  eventName: "GŁOWA DO GÓRY",
  organizer: "Fundacja One Day",
  date: "27 października 2026",
  number: "CONF-2026-TEST",
};

test("certificate retains all visible artwork streams and page dimensions", async () => {
  const template = await PDFDocument.load(
    await readFile("assets/certificate-template.pdf"),
  );
  const result = await PDFDocument.load(
    await renderCertificate({ ...details, name: "Żaneta Łącka-Świętochowska" }),
  );
  expect(result.getPageCount()).toBe(1);
  expect(result.getPage(0).getSize()).toEqual(template.getPage(0).getSize());
  const streamHashes = (document: PDFDocument) =>
    document.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [createHash("sha256").update(object.getContents()).digest("hex")]
          : [],
      );
  // Only private Photoshop editing data may be removed. All objects reachable
  // from the actual page resources/content must remain byte-for-byte intact.
  const refs = new Set<number>();
  const originalStreams: string[] = [];
  function visit(object: PDFObject | undefined): void {
    if (!object) return;
    if (object instanceof PDFRef) {
      if (refs.has(object.objectNumber)) return;
      refs.add(object.objectNumber);
      visit(template.context.lookup(object));
    } else if (object instanceof PDFRawStream) {
      originalStreams.push(
        createHash("sha256").update(object.getContents()).digest("hex"),
      );
      visit(object.dict);
    } else if (object instanceof PDFDict)
      for (const [key, value] of object.entries()) {
        if (key !== PDFName.of("PieceInfo")) visit(value);
      }
    else if (object instanceof PDFArray)
      for (const value of object.asArray()) visit(value);
  }
  visit(template.context.trailerInfo.Root);

  expect(originalStreams.length).toBeGreaterThan(0);
  expect(streamHashes(result)).toEqual(expect.arrayContaining(originalStreams));
});

test.each([
  "Łukasz Żółć",
  "Anna Maria Katarzyna Świętochowska-Kowalska-Wiśniewska",
])("renders Polish letters and long participant names: %s", async (name) => {
  const result = await renderCertificate({ ...details, name });
  expect((await PDFDocument.load(result)).getPageCount()).toBe(1);
});

test("rejects an empty participant name", async () => {
  await expect(renderCertificate({ ...details, name: " \n " })).rejects.toThrow(
    "Imię i nazwisko",
  );
});

test("concurrent certificates share unchanged artwork but have isolated name overlays", async () => {
  const { renderCertificateParts } =
    await import("../src/server/certificate-pdf");
  const [a, b] = await Promise.all([
    renderCertificateParts({ ...details, name: "Anny Kowalskiej" }),
    renderCertificateParts({ ...details, name: "Jana Nowaka" }),
  ]);
  expect(a[0]).toBe(b[0]);
  expect(a[0].length).toBeLessThan(15 * 1024 * 1024);
  expect(a[1].length).toBeLessThan(100000);
  expect(Buffer.from(a[1]).equals(Buffer.from(b[1]))).toBe(false);
  for (const parts of [a, b])
    expect((await PDFDocument.load(Buffer.concat(parts))).getPageCount()).toBe(
      1,
    );
});
