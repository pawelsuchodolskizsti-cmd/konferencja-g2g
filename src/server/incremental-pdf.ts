import {
  PDFDocument,
  PDFRawStream,
  PDFName,
  PDFRef,
  PDFDict,
  PDFArray,
  PDFObject,
} from "pdf-lib";

// The artwork bytes are immutable and shared by concurrent downloads.
// Each request parses only a small skeleton and appends a standard PDF revision.
export async function prepareIncrementalPdf(original: Uint8Array) {
  const document = await PDFDocument.load(original, { updateMetadata: false });
  // Photoshop editing data is not painted on the page. Remove it and only
  // unreachable objects; retain the exact JPEG, colour profile and page content.
  for (const page of document.getPages())
    page.node.delete(PDFName.of("PieceInfo"));
  const reachable = new Set<number>();
  function visit(object: PDFObject | undefined): void {
    if (!object) return;
    if (object instanceof PDFRef) {
      if (reachable.has(object.objectNumber)) return;
      reachable.add(object.objectNumber);
      visit(document.context.lookup(object));
    } else if (object instanceof PDFRawStream) visit(object.dict);
    else if (object instanceof PDFDict)
      for (const [, value] of object.entries()) visit(value);
    else if (object instanceof PDFArray)
      for (const value of object.asArray()) visit(value);
  }
  visit(document.context.trailerInfo.Root);
  visit(document.context.trailerInfo.Info);
  visit(document.context.trailerInfo.ID);
  for (const [ref] of document.context.enumerateIndirectObjects())
    if (!reachable.has(ref.objectNumber)) document.context.delete(ref);
  original = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
  });
  const streamRefs = new Set<number>();
  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      streamRefs.add(ref.objectNumber);
      document.context.assign(
        ref,
        PDFRawStream.of(object.dict.clone(document.context), new Uint8Array()),
      );
    }
  }
  const tail = Buffer.from(
    original.subarray(Math.max(0, original.length - 2048)),
  ).toString("latin1");
  const matches = [...tail.matchAll(/startxref\s+(\d+)/g)];
  if (!matches.length) throw new Error("Brak tablicy odsyłaczy szablonu PDF.");
  const previousXref = Number(matches[matches.length - 1][1]);
  const skeleton = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
  });
  return { original, skeleton, streamRefs, previousXref };
}
export async function appendPdfRevision(
  base: Awaited<ReturnType<typeof prepareIncrementalPdf>>,
  document: PDFDocument,
): Promise<readonly Uint8Array[]> {
  await document.flush();
  const parts: Buffer[] = [Buffer.from("\n")];
  let offset = base.original.length + 1;
  const entries: string[] = [];
  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (base.streamRefs.has(ref.objectNumber)) continue;
    const prefix = Buffer.from(
      `${ref.objectNumber} ${ref.generationNumber} obj\n`,
    );
    const body = Buffer.alloc(object.sizeInBytes());
    object.copyBytesInto(body, 0);
    const suffix = Buffer.from("\nendobj\n");
    entries.push(
      `${ref.objectNumber} 1\n${String(offset).padStart(10, "0")} ${String(ref.generationNumber).padStart(5, "0")} n \n`,
    );
    parts.push(prefix, body, suffix);
    offset += prefix.length + body.length + suffix.length;
  }
  const trailer = document.context.obj({
    Size: document.context.largestObjectNumber + 1,
    Root: document.context.trailerInfo.Root,
    Info: document.context.trailerInfo.Info,
    ID: document.context.trailerInfo.ID,
    Prev: base.previousXref,
  });
  parts.push(
    Buffer.from(
      `xref\n${entries.join("")}trailer\n${trailer.toString()}\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return [base.original, Buffer.concat(parts)];
}
export function pdfStream(parts: readonly Uint8Array[]) {
  let part = 0,
    offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      while (part < parts.length && offset >= parts[part].length) {
        part++;
        offset = 0;
      }
      if (part === parts.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 65536, parts[part].length);
      controller.enqueue(parts[part].subarray(offset, end));
      offset = end;
    },
  });
}
