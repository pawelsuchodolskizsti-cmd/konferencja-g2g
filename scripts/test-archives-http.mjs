import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
process.loadEnvFile(".env.local");
assert.equal(process.env.APP_ENV, "development");
assert.equal(new URL(process.env.APP_URL).hostname, "localhost");
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
const origin = process.env.APP_URL;
async function req(path, cookie = "", method = "GET", body, expected = 200) {
  const r = await fetch(origin + path, {
    method,
    headers: { cookie, origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(
    r.status,
    expected,
    method + " " + path + ": " + (r.status === expected ? "" : await r.text()),
  );
  return r;
}
const admin = JSON.parse(await readFile(".local/access.json", "utf8"));
const cookie = (await req("/api/auth/admin", "", "POST", admin)).headers
  .get("set-cookie")
  .split(";")[0];
const [event] = await (await req("/api/admin/events", cookie)).json();
const base = "/api/admin/events/" + event.id;
const start = performance.now();
const archive = await (
  await req(base + "/archives", cookie, "POST", {}, 201)
).json();
const bytes = new Uint8Array(
  await (await req(base + "/archives/" + archive.id, cookie)).arrayBuffer(),
);
const files = unzipSync(bytes);
assert.equal(archive.byteLength, bytes.length);
assert.ok(files["attendance.csv"]);
assert.ok(files["ankieta.xlsx"]);
assert.ok(files["wiadomosci-organizacyjne.json"]);
assert.equal(
  Object.keys(files).some((name) => name.endsWith(".pdf")),
  false,
);
const codes = new TextDecoder().decode(files["uczestnicy-z-kodami.csv"]);
assert.equal(codes.trim().split("\r\n").length - 1, archive.participantCount);
assert.ok(
  bytes.length < 10 * 1024 * 1024,
  "Archive exceeds the 10 MiB regression budget",
);
assert.ok(
  performance.now() - start < 60000,
  "Archive exceeds the 60s route duration",
);
await writeFile(".local/fixtures/archive.zip", bytes);
const controller = JSON.parse(
  await readFile(".local/controller-access.json", "utf8"),
);
const cc = (await req("/api/auth/admin", "", "POST", controller)).headers
  .get("set-cookie")
  .split(";")[0];
await req(base + "/archives", cc);
await req(base + "/archives/" + archive.id, cc);
await req(base + "/archives", cc, "POST", {}, 403);
await req(
  base + "/archives/" + archive.id,
  cc,
  "DELETE",
  { confirmation: "USUŃ ARCHIWUM" },
  403,
);
await req(base + "/data-cleanup", cc, "POST", {}, 403);
await req(base + "/data-cleanup/preview", cc, "POST", {}, 403);
console.log(
  JSON.stringify({
    participants: archive.participantCount,
    files: Object.keys(files).length,
    bytes: bytes.length,
    elapsedSeconds: Math.round((performance.now() - start) / 100) / 10,
    permissions: "OK",
  }),
);

// A fresh synthetic account verifies cleanup without removing the 250 fixtures.
const original = (await (await req(base, cookie)).json()).event;
const before = (await (await req(base, cookie)).json()).people
  .map((p) => p.id)
  .sort();
const cleanupEmail = `archive-cleanup-${Date.now()}@example.test`;
const person = await (
  await req(
    base + "/participants",
    cookie,
    "POST",
    {
      firstName: "Archiwum",
      lastName: "Testowe",
      email: cleanupEmail,
    },
    201,
  )
).json();
try {
  await req(base, cookie, "PATCH", {
    ...original,
    startsAt: "2099-01-01T09:00:00Z",
    endsAt: "2099-01-01T17:00:00Z",
    certificateUnlockAt: "2099-01-01T17:00:00Z",
  });
  const preview = await (
    await req(base + "/data-cleanup/preview", cookie, "POST", {
      ids: [person.id],
    })
  ).json();
  const result = await (
    await req(base + "/data-cleanup", cookie, "POST", {
      ids: [person.id],
      fingerprint: preview.fingerprint,
      confirmation: "USUŃ WYBRANYCH",
    })
  ).json();
  assert.equal(result.deleted, 1);
  const after = (await (await req(base, cookie)).json()).people
    .map((p) => p.id)
    .sort();
  assert.deepEqual(after, before);
  const saved = new Uint8Array(
    await (
      await req(base + "/archives/" + result.archiveId, cookie)
    ).arrayBuffer(),
  );
  const savedFiles = unzipSync(saved);
  assert.ok(
    new TextDecoder()
      .decode(savedFiles["uczestnicy-z-kodami.csv"])
      .includes(cleanupEmail),
  );
  console.log(
    "OK: cleanup archived all 251 accounts, removed only the synthetic extra account and preserved the original 250.",
  );
} finally {
  await req(base, cookie, "PATCH", original);
  const remaining = (await (await req(base, cookie)).json()).people;
  if (remaining.some((p) => p.id === person.id))
    await req(base + "/participants/" + person.id, cookie, "DELETE");
}
