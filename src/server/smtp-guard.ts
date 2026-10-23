import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, rateLimits } from "@/db/schema";
import { mailAddresses } from "@/lib/mail-recipients";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function claimSingleSmtp(input: {
  requestId: string;
  eventId: string;
  adminId: string;
  targetId: string;
  action: string;
  to: string;
  cc?: string;
  content: string;
}) {
  return db().transaction(async (tx) => {
    const globalKey = "smtp:dispatch:konferencja@oneday.com.pl";
    const [global] = await tx
      .insert(rateLimits)
      .values({
        key: globalKey,
        count: 0,
        resetsAt: new Date(0),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: { count: sql`${rateLimits.count}` },
      })
      .returning();
    const [existing] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.id, input.requestId));
    if (existing) return { state: "REPLAY" as const };
    const now = Date.now();
    const keys = mailAddresses(input).map(
      (email) => `smtp:mailbox:${hash(email)}`,
    );
    const fingerprint = `smtp:content:${hash(JSON.stringify([input.eventId, input.targetId, mailAddresses(input).sort(), input.content]))}`;
    const [duplicate] = await tx
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, fingerprint));
    if (duplicate && duplicate.resetsAt.getTime() > now)
      return { state: "DUPLICATE" as const };
    let wait = Math.max(0, global.resetsAt.getTime() - now);
    for (const key of keys) {
      const [limit] = await tx
        .select()
        .from(rateLimits)
        .where(eq(rateLimits.key, key));
      if (limit) wait = Math.max(wait, limit.resetsAt.getTime() - now);
    }
    if (wait > 0) return { state: "WAIT" as const, retryAfterMs: wait };
    const [claim] = await tx
      .insert(auditLogs)
      .values({
        id: input.requestId,
        eventId: input.eventId,
        adminId: input.adminId,
        targetId: input.targetId,
        action: input.action,
      })
      .onConflictDoNothing()
      .returning({ id: auditLogs.id });
    if (!claim) return { state: "REPLAY" as const };
    await tx
      .update(rateLimits)
      .set({ resetsAt: new Date(now + 3000) })
      .where(eq(rateLimits.key, globalKey));
    for (const [key, duration] of [
      ...keys.map((key) => [key, 30000] as const),
      [fingerprint, 600000] as const,
    ]) {
      await tx
        .insert(rateLimits)
        .values({ key, count: 0, resetsAt: new Date(now + duration) })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: { resetsAt: new Date(now + duration) },
        });
    }
    return { state: "CLAIMED" as const };
  });
}
