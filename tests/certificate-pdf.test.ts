import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { expect, test } from "vitest";
import { renderCertificate } from "../src/server/certificate-pdf";

const details = {
  eventName: "GŁOWA DO GÓRY",
  organizer: "Fundacja One Day",
  date: "27 października 2026",
  number: "CONF-2026-TEST",
};

test("certificate retains every original artwork stream and page dimensions", async () => {
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
  const originalStreams = streamHashes(template);
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
