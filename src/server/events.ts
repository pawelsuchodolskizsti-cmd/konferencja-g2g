import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminEvents, auditLogs, events } from "@/db/schema";
import { requireEvent } from "./auth";
import { assert } from "./errors";

export const eventInput = z
  .object({
    name: z.string().trim().min(3).max(160),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(3)
      .max(80),
    organizer: z.string().trim().min(2).max(160),
    location: z.string().trim().min(2).max(300),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    certificateUnlockAt: z.coerce.date(),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("pl", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    mailFrom: z.email(),
    mailSubject: z.string().min(1).max(200),
    mailBody: z.string().min(10).max(10000),
    info: z.string().max(5000),
    published: z.boolean(),
    retentionUntil: z.coerce.date().nullable(),
    agenda: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          speaker: z.string().max(200),
          start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        }),
      )
      .max(60),
  })
  .refine(
    (v) => v.endsAt > v.startsAt && v.certificateUnlockAt >= v.endsAt,
    "Koniec musi następować po początku, a certyfikaty można odblokować najwcześniej po zakończeniu wydarzenia.",
  );
export async function saveEvent(
  adminId: string,
  data: unknown,
  eventId?: string,
) {
  const value = eventInput.parse(data);
  value.name = "Głowa do Góry";
  if (eventId) await requireEvent(adminId, eventId);
  return db().transaction(async (tx) => {
    if (!eventId) {
      await tx.execute(sql`select pg_advisory_xact_lock(72401926)`);
      const existing = await tx.select({ id: events.id }).from(events).limit(1);
      assert(
        !existing.length,
        409,
        "Konferencja jest już skonfigurowana. Panel obsługuje tylko Głowę do Góry.",
      );
      value.slug = "glowa-do-gory";
    } else {
      const [existing] = await tx
        .select({ slug: events.slug })
        .from(events)
        .where(eq(events.id, eventId));
      value.slug = existing.slug;
    }
    const [event] = eventId
      ? await tx
          .update(events)
          .set(value)
          .where(eq(events.id, eventId))
          .returning()
      : await tx.insert(events).values(value).returning();
    if (!eventId)
      await tx.insert(adminEvents).values({ adminId, eventId: event.id });
    await tx.insert(auditLogs).values({
      adminId,
      eventId: event.id,
      action: eventId ? "EVENT_UPDATED" : "EVENT_CREATED",
      targetId: event.id,
    });
    return event;
  });
}
export async function adminEventList(adminId: string) {
  return db()
    .select({ id: events.id, name: events.name, slug: events.slug })
    .from(events)
    .innerJoin(
      adminEvents,
      and(eq(events.id, adminEvents.eventId), eq(adminEvents.adminId, adminId)),
    );
}
