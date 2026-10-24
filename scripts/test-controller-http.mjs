import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
process.loadEnvFile(".env.local");
assert.equal(process.env.APP_ENV, "development");
assert.equal(new URL(process.env.APP_URL).hostname, "localhost");
const origin = process.env.APP_URL;
async function request(
  path,
  cookie = "",
  method = "GET",
  body,
  expected = 200,
) {
  const r = await fetch(origin + path, {
    method,
    headers: { cookie, origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(r.status, expected, `${method} ${path}: ${r.status}`);
  return r;
}
const admin = JSON.parse(await readFile(".local/access.json", "utf8"));
const adminCookie = (
  await request("/api/auth/admin", "", "POST", admin)
).headers
  .get("set-cookie")
  .split(";")[0];
const events = await (await request("/api/admin/events", adminCookie)).json();
const base = `/api/admin/events/${events[0].id}`;
const account = {
  email: `controller-${randomUUID()}@example.test`,
  password: randomUUID(),
  role: "CONTROLLER",
};
await request(`${base}/team`, adminCookie, "POST", account);
const cookie = (await request("/api/auth/admin", "", "POST", account)).headers
  .get("set-cookie")
  .split(";")[0];
const overview = await (await request(base, cookie)).json();
const p = overview.people[0];
for (const suffix of [
  "/privacy",
  "/history",
  "/survey",
  "/survey-summary",
  "/survey-export?format=csv",
  "/reports?kind=attendance",
  "/reports?kind=privacy",
  "/reports?kind=certificates",
  `/codes-export?format=csv&ids=${p.id}`,
  `/participants/${p.id}/data`,
])
  await request(base + suffix, cookie);
await request(`${base}/reports`, cookie, "POST", {
  kind: "attendance",
  ids: p.id,
});
for (const [suffix, method] of [
  ["", "PATCH"],
  ["/participants", "POST"],
  [`/participants/${p.id}`, "PATCH"],
  [`/participants/${p.id}`, "DELETE"],
  [`/participants/${p.id}/reset`, "POST"],
  [`/participants/${p.id}/undo-checkin`, "POST"],
  [`/participants/${p.id}/certificate`, "GET"],
  ["/checkin", "POST"],
  ["/checkin-people?q=Test", "GET"],
  ["/team", "GET"],
  ["/team", "POST"],
  ["/privacy", "POST"],
  ["/cleanup", "POST"],
  ["/purge", "POST"],
  ["/materials", "POST"],
  ["/survey", "POST"],
  ["/invitation", "POST"],
  ["/audit-encryption", "POST"],
  ["/organizational/00000000-0000-4000-8000-000000000001/reconcile", "POST"],
  ["/organizational/00000000-0000-4000-8000-000000000001/resolve", "POST"],
  ["/courses", "POST"],
])
  await request(
    base + suffix,
    cookie,
    method,
    method === "GET" ? undefined : {},
    403,
  );
await request("/api/admin/events/setup", cookie, "POST", {}, 403);
const page = await request("/admin", cookie);
assert.match(await page.text(), /Kontroler danych/);
const scanner = await request("/skanowaniebiletow", cookie);
assert.equal(new URL(scanner.url).pathname, "/admin");
await writeFile(".local/controller-access.json", JSON.stringify(account));
console.log(
  "OK: controller read/report access; 19 forbidden write/admin/check-in routes; scanner redirect.",
);
