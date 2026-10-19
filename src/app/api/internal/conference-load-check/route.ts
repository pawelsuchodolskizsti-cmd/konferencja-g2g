import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  participants,
  attendance,
  certificates,
  auditLogs,
} from "@/db/schema";
import { newCredentials, decrypt } from "@/server/crypto";
import { probe } from "./config";
export const runtime = "nodejs";
export const maxDuration = 60;
const slug = `load-probe-${probe.eventId}`;
function allowed(req: Request) {
  const digest = createHash("sha256")
    .update(req.headers.get("authorization") || "")
    .digest();
  return (
    process.env.VERCEL_ENV === "production" &&
    Date.now() < probe.expires + (req.method === "DELETE" ? 86400000 : 0) &&
    timingSafeEqual(digest, Buffer.from(probe.hash, "hex"))
  );
}
async function realFingerprint() {
  const database = db();
  const rows = await Promise.all([
    database
      .select()
      .from(events)
      .where(ne(events.id, probe.eventId))
      .orderBy(events.id),
    database
      .select()
      .from(participants)
      .where(ne(participants.eventId, probe.eventId))
      .orderBy(participants.id),
    database
      .select({ record: attendance })
      .from(attendance)
      .innerJoin(participants, eq(participants.id, attendance.participantId))
      .where(ne(participants.eventId, probe.eventId))
      .orderBy(attendance.id),
    database
      .select({ record: certificates })
      .from(certificates)
      .innerJoin(participants, eq(participants.id, certificates.participantId))
      .where(ne(participants.eventId, probe.eventId))
      .orderBy(certificates.id),
  ]);
  return {
    hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    events: rows[0].length,
    participants: rows[1].length,
  };
}
async function handle(req: Request) {
  if (!allowed(req))
    return Response.json({ error: "Not found" }, { status: 404 });
  const headers = { "Cache-Control": "private, no-store" };
  if (req.method === "POST") {
    const baseline = await realFingerprint();
    await db().transaction(async (tx) => {
      await tx
        .insert(events)
        .values({
          id: probe.eventId,
          slug,
          name: "IZOLOWANY TEST OBCIĄŻENIA",
          organizer: "Test techniczny",
          location: "Test",
          startsAt: new Date("2020-01-01"),
          endsAt: new Date("2020-01-02"),
          certificateUnlockAt: new Date("2020-01-02"),
          published: false,
          mailFrom: "load@example.test",
          info: JSON.stringify(baseline),
        })
        .onConflictDoNothing();
      const [event] = await tx
        .select()
        .from(events)
        .where(eq(events.id, probe.eventId))
        .for("update");
      if (event.slug !== slug || event.published)
        throw Error("Fixture mismatch");
      const existing = await tx
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.eventId, probe.eventId));
      if (existing.length) return;
      const people = await tx
        .insert(participants)
        .values(
          Array.from({ length: 250 }, (_, i) => ({
            ...newCredentials(),
            eventId: probe.eventId,
            firstName: i % 2 ? "Anna" : "Łukasz",
            lastName: `Obciążeniowy ${String(i + 1).padStart(3, "0")}`,
            email: `load-${probe.eventId}-${i}@example.test`,
          })),
        )
        .returning({ id: participants.id });
      await tx
        .insert(attendance)
        .values(
          people.map((p) => ({
            participantId: p.id,
            method: "MANUAL" as const,
          })),
        );
    });
    const people = await db()
      .select({ id: participants.id, credentials: participants.credentials })
      .from(participants)
      .where(eq(participants.eventId, probe.eventId))
      .orderBy(participants.id);
    return Response.json(
      {
        eventId: probe.eventId,
        accounts: people.map((p) => ({
          id: p.id,
          code: JSON.parse(decrypt(p.credentials)).accessCode,
        })),
      },
      { headers },
    );
  }
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, probe.eventId));
  if (!event)
    return Response.json(
      { clean: true, current: await realFingerprint() },
      { headers },
    );
  if (event.slug !== slug || event.published)
    return Response.json({ error: "Fixture mismatch" }, { status: 409 });
  if (req.method === "DELETE") {
    const baseline = JSON.parse(event.info);
    await db().transaction(async (tx) => {
      await tx
        .select()
        .from(events)
        .where(and(eq(events.id, probe.eventId), eq(events.slug, slug)))
        .for("update");
      await tx.delete(auditLogs).where(eq(auditLogs.eventId, probe.eventId));
      await tx
        .delete(events)
        .where(and(eq(events.id, probe.eventId), eq(events.slug, slug)));
    });
    return Response.json(
      { clean: true, baseline, current: await realFingerprint() },
      { headers },
    );
  }
  const issued = await db()
    .select({ id: certificates.id })
    .from(certificates)
    .innerJoin(participants, eq(participants.id, certificates.participantId))
    .where(eq(participants.eventId, probe.eventId));
  return Response.json(
    {
      baseline: JSON.parse(event.info),
      current: await realFingerprint(),
      issued: issued.length,
      region: process.env.VERCEL_REGION,
      deployment: process.env.VERCEL_URL,
    },
    { headers },
  );
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;

