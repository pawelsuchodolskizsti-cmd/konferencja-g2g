import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { participants } from "@/db/schema";
import { decrypt } from "@/server/crypto";
import { PARTICIPANT_PRIVACY_VERSION } from "@/lib/participant-privacy";
import { probe } from "../conference-load-check/config";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  if (
    process.env.VERCEL_ENV !== "production" ||
    Date.now() > probe.expires ||
    !timingSafeEqual(
      createHash("sha256")
        .update(req.headers.get("authorization") || "")
        .digest(),
      Buffer.from(probe.hash, "hex"),
    )
  )
    return new Response(null, { status: 404 });
  const accounts = await db()
    .select({ credentials: participants.credentials })
    .from(participants)
    .where(eq(participants.eventId, probe.eventId));
  if (accounts.length !== 250)
    return Response.json(
      { error: "Expected exactly 250 isolated accounts" },
      { status: 409 },
    );
  const diagnosticOnly = new URL(req.url).searchParams.get("loginOnly") === "1";
  const origin = "https://konferencja-g2g.pl",
    cookies: string[] = [];
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const body = new ReadableStream({
    async start(out) {
      const emit = (data: unknown) =>
        out.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      emit({
        startedAt: new Date().toISOString(),
        generatorRegion: process.env.VERCEL_REGION,
        concurrency: 250,
      });
      try {
        for (const kind of (diagnosticOnly ? ["login"] : ["login", "panel", "pdf"])) {
          const start = performance.now();
          const rows: {
            status?: number;
            ms: number;
            headersMs?: number;
            bytes?: number;
            error?: string;
          }[] = [];
          await Promise.all(
            accounts.map(async (p, i) => {
              const begun = performance.now();
              const row: {
                status?: number;
                ms: number;
                headersMs?: number;
                bytes?: number;
                error?: string;
              } = { ms: 0 };
              try {
                const path =
                  kind === "login"
                    ? "/api/auth/participant"
                    : kind === "panel"
                      ? "/uczestnik/panel"
                      : "/api/participant/certificate";
                const init: RequestInit =
                  kind === "login"
                    ? {
                        method: "POST",
                        headers: { origin, "content-type": "application/json" },
                        body: JSON.stringify({
                          code: JSON.parse(decrypt(p.credentials)).accessCode,
                          privacyAcknowledged: true,
                          privacyVersion: PARTICIPANT_PRIVACY_VERSION,
                        }),
                      }
                    : { headers: { cookie: cookies[i] } };
                const r = await fetch(origin + path, {
                  ...init,
                  signal: AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(90000),
                  ]),
                });
                row.status = r.status;
                row.headersMs = Math.round(performance.now() - begun);
                if (!r.ok) {
                  // Finish all in-flight requests before cleaning up fixtures.
                  throw Error(`HTTP ${r.status}`);
                }
                if (kind === "login") {
                  await r.json();
                  cookies[i] = r.headers.get("set-cookie")!.split(";")[0];
                }
                if (kind === "panel") {
                  if (
                    new URL(r.url).pathname !== "/uczestnik/panel" ||
                    !(await r.text()).includes("/api/participant/certificate")
                  )
                    throw Error("Panel validation failed");
                }
                if (kind === "pdf") {
                  if (
                    !r.headers.get("content-type")?.includes("application/pdf")
                  )
                    throw Error("Not PDF");
                  let size = 0,
                    tail = "";
                  const digest = createHash("sha256");
                  const reader = r.body!.getReader();
                  for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (
                      !size &&
                      Buffer.from(value).subarray(0, 5).toString() !== "%PDF-"
                    )
                      throw Error("Invalid PDF header");
                    size += value.length;
                    digest.update(value);
                    tail = Buffer.from(value).subarray(-100).toString();
                  }
                  if (
                    size < 13000000 ||
                    size > 15000000 ||
                    !tail.includes("%%EOF")
                  )
                    throw Error("Incomplete PDF");
                  row.bytes = size;
                  if (r.headers.get("etag") !== `"${digest.digest("hex")}"`)
                    throw Error("PDF integrity check failed");
                }
              } catch (e) {
                row.error = e instanceof Error ? e.message : String(e);
              }
              row.ms = Math.round(performance.now() - begun);
              rows.push(row);
            }),
          );
          const good = rows.filter((r) => !r.error),
            times = good.map((r) => r.ms).sort((a, b) => a - b),
            headers = good.map((r) => r.headersMs!).sort((a, b) => a - b);
          emit({
            kind,
            requests: rows.length,
            successful: good.length,
            errors: rows.length - good.length,
            elapsedSeconds: (performance.now() - start) / 1000,
            p50ms: times[Math.floor(times.length * 0.5)],
            p95ms: times[Math.floor(times.length * 0.95)],
            maxMs: times.at(-1),
            headersP95ms: headers[Math.floor(headers.length * 0.95)],
            bytes: good.reduce((s, r) => s + (r.bytes || 0), 0),
            failures: rows.filter((r) => r.error).slice(0, 5),
          });
          if (good.length !== 250) throw Error("Stop: request failures");
        }
        emit({ pass: true, finishedAt: new Date().toISOString() });
      } catch (e) {
        emit({
          pass: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        out.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

