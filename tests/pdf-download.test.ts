import { expect, test } from "vitest";
import { pdfDownload } from "../src/server/pdf-download";
const original = Buffer.from("%PDF-12345678901234567890%%EOF");
const parts = [original.subarray(0, 9), original.subarray(9)];
const request = (headers: Record<string, string> = {}) =>
  new Request("https://example.test/certificate", { headers });
test("full download and resumed parts preserve every PDF byte", async () => {
  const full = pdfDownload(request(), parts);
  expect(full.status).toBe(200);
  expect(full.headers.get("content-length")).toBe(String(original.length));
  const etag = full.headers.get("etag")!;
  expect(Buffer.from(await full.arrayBuffer()).equals(original)).toBe(true);
  const first = pdfDownload(request({ range: "bytes=0-10" }), parts);
  const second = pdfDownload(
    request({ range: "bytes=11-", "if-range": etag }),
    parts,
  );
  expect(first.status).toBe(206);
  expect(second.status).toBe(206);
  const joined = Buffer.concat([
    Buffer.from(await first.arrayBuffer()),
    Buffer.from(await second.arrayBuffer()),
  ]);
  expect(joined.equals(original)).toBe(true);
});
test("changed certificate never mixes revisions during resume", async () => {
  const r = pdfDownload(
    request({ range: "bytes=10-", "if-range": '"old"' }),
    parts,
  );
  expect(r.status).toBe(200);
  expect(Buffer.from(await r.arrayBuffer()).equals(original)).toBe(true);
});
test("suffix ranges, invalid offsets and multipart fallback", async () => {
  const suffix = pdfDownload(request({ range: "bytes=-5" }), parts);
  expect(suffix.status).toBe(206);
  expect(await suffix.text()).toBe("%%EOF");
  for (const range of ["bytes=999-", "bytes=9-2", "bytes=-0"]) {
    const r = pdfDownload(request({ range }), parts);
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe(`bytes */${original.length}`);
  }
  expect(pdfDownload(request({ range: "bytes=0-2,8-10" }), parts).status).toBe(
    200,
  );
});
