import { isDemoParticipant } from "./demo-participant";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type Database } from "@/db";
import { auditLogs, events } from "@/db/schema";
import { assert } from "./errors";
export async function materialsUnlocked(
  eventId: string,
  database: Database = db(),
) {
  const [last] = await database
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.eventId, eventId),
        inArray(auditLogs.action, ["MATERIALS_UNLOCKED", "MATERIALS_LOCKED"]),
      ),
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(1);
  return last?.action === "MATERIALS_UNLOCKED";
}
export async function setMaterialsUnlocked(
  eventId: string,
  adminId: string,
  unlocked: boolean,
) {
  return db().transaction(async (tx) => {
    const [event] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    assert(event, 404, "Brak konferencji.");
    await tx.insert(auditLogs).values({
      eventId,
      adminId,
      action: unlocked ? "MATERIALS_UNLOCKED" : "MATERIALS_LOCKED",
    });
    return { unlocked };
  });
}

export async function materialsAvailableForParticipant(
  person: { id: string; eventId: string },
  database: Database = db(),
) {
  return (
    isDemoParticipant(person) ||
    (await materialsUnlocked(person.eventId, database))
  );
}
