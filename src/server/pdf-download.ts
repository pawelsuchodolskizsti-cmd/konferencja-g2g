import { createHash } from "node:crypto";
import { pdfStream } from "./incremental-pdf";

// Call only after checking current session, attendance and certificate eligibility.
export function pdfDownload(req: Request, parts: readonly Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  const etag = `"${hash.digest("hex")}"`;
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="certyfikat.pdf"',
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    ETag: etag,
  });
  let start = 0,
    end = size - 1,
    status = 200;
  const range = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (range && (!ifRange || ifRange === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1]
        ? Number(match[1])
        : Math.max(0, size - Number(match[2]));
      end =
        match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    // Unsupported/multipart ranges are ignored and receive the full representation.
  }
  const selected: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const from = Math.max(0, start - offset);
    const to = Math.min(part.length, end + 1 - offset);
    if (to > from) selected.push(part.subarray(from, to));
    offset += part.length;
  }
  headers.set("Content-Length", String(end - start + 1));
  return new Response(pdfStream(selected), { status, headers });
}
