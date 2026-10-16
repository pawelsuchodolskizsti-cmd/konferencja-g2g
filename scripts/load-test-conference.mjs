import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { newCredentials, decrypt } from "../src/server/crypto.ts";
import { PARTICIPANT_PRIVACY_VERSION } from "../src/lib/participant-privacy.ts";
process.loadEnvFile(".env.local");
assert.equal(process.env.APP_ENV, "development");
assert.equal(new URL(process.env.APP_URL).hostname, "localhost");
assert.ok(
  ["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  ),
  "Local test database required",
);
const origin = process.env.APP_URL;
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const runId = randomUUID();
const count = 250;
const [event] =
  await sql`INSERT INTO events (slug,name,organizer,location,starts_at,ends_at,certificate_unlock_at,mail_from) VALUES (${`load-${runId}`},'Test obciążenia 250','Test','Lokalnie','2020-01-01','2020-01-02','2020-01-02','load@example.test') RETURNING id`;
const rows = Array.from({ length: count }, (_, i) => {
  const c = newCredentials();
  return {
    id: randomUUID(),
    event_id: event.id,
    first_name: i % 2 ? "Anna" : "Łukasz",
    last_name: `Testowy ${String(i + 1).padStart(3, "0")}`,
    email: `load-${runId}-${i}@example.test`,
    access_hash: c.accessHash,
    qr_hash: c.qrHash,
    credentials: c.credentials,
  };
});
await sql`INSERT INTO participants ${sql(rows)}`;
await sql`INSERT INTO attendance ${sql(rows.map((p) => ({ participant_id: p.id, method: "MANUAL" })))}`;
const cookies = [];
const results = [];
async function phase(name, work) {
  const begin = performance.now();
  const times = [];
  const failures = [];
  let bytes = 0;
  await Promise.all(
    rows.map(async (p, i) => {
      const started = performance.now();
      try {
        const size = await work(p, i);
        bytes += size || 0;
      } catch (e) {
        failures.push({ i, error: e.message });
      }
      times.push(performance.now() - started);
    }),
  );
  times.sort((a, b) => a - b);
  const result = {
    phase: name,
    concurrency: count,
    requests: count,
    errors: failures.length,
    elapsedSeconds: +((performance.now() - begin) / 1000).toFixed(2),
    p50ms: Math.round(times[Math.floor(times.length * 0.5)]),
    p95ms: Math.round(times[Math.floor(times.length * 0.95)]),
    maxMs: Math.round(times.at(-1)),
    bytes,
  };
  results.push(result);
  console.log(JSON.stringify(result));
  if (failures.length) console.log(JSON.stringify(failures.slice(0, 5)));
  assert.equal(failures.length, 0, `${name}: failures`);
}
try {
  await phase("login-shared-IP", async (p, i) => {
    const { accessCode } = JSON.parse(decrypt(p.credentials));
    const r = await fetch(origin + "/api/auth/participant", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        code: accessCode,
        privacyAcknowledged: true,
        privacyVersion: PARTICIPANT_PRIVACY_VERSION,
      }),
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(r.status, 200, await r.text());
    cookies[i] = r.headers.get("set-cookie").split(";")[0];
  });
  await phase("participant-panel", async (_, i) => {
    const r = await fetch(origin + "/uczestnik/panel", {
      headers: { cookie: cookies[i] },
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(r.status, 200);
    assert.equal(new URL(r.url).pathname, "/uczestnik/panel");
    const html = await r.text();
    assert.ok(html.includes("/api/participant/certificate"));
    return Buffer.byteLength(html);
  });
  for (const label of [
    "certificates-first-download",
    "certificates-repeat-download",
  ])
    await phase(label, async (_, i) => {
      const r = await fetch(origin + "/api/participant/certificate", {
        headers: { cookie: cookies[i] },
        signal: AbortSignal.timeout(60000),
      });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("content-type"), /application\/pdf/);
      let bytes = 0;
      let tail = Buffer.alloc(0);
      for await (const chunk of r.body) {
        if (!bytes)
          assert.equal(Buffer.from(chunk).subarray(0, 5).toString(), "%PDF-");
        bytes += chunk.length;
        tail = Buffer.from(chunk).subarray(-100);
      }
      assert.ok(bytes > 13000000 && bytes < 15000000);
      assert.ok(tail.toString().includes("%%EOF"));
      return bytes;
    });
  const issued =
    await sql`SELECT count(*)::int AS n FROM certificates c JOIN participants p ON c.participant_id=p.id WHERE p.event_id=${event.id}`;
  assert.equal(issued[0].n, count);
  await mkdir(".local/load-test", { recursive: true });
  await writeFile(
    ".local/load-test/results.json",
    JSON.stringify(
      {
        runId,
        environment:
          "local production build + PGlite, single database connection, all clients share IP",
        date: new Date().toISOString(),
        participants: count,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 250 unique users, one IP, full PDF bodies consumed, repeat downloads idempotent.",
  );
} finally {
  await sql`DELETE FROM events WHERE id=${event.id}`;
  await sql.end();
}
