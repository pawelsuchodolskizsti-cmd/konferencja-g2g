import { and, eq } from "drizzle-orm";
import type { Database } from "../src/db";
import { participants, auditLogs } from "../src/db/schema";

export async function markTestParticipants(
  database: Pick<Database, "transaction">,
) {
  return database.transaction(async (tx) => {
    const people = await tx.select().from(participants);
    const targets = new Set([
      "g2g.test.001453@example.com",
      "prezentacja.g2g@example.com",
    ]);
    let marked = 0;
    for (const person of people) {
      if (!targets.has(person.email.trim().toLowerCase())) continue;
      const existing = await tx
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetId, person.id),
            eq(auditLogs.action, "PARTICIPANT_TEST_ACCOUNT"),
          ),
        );
      if (existing.length) continue;
      await tx
        .insert(auditLogs)
        .values({
          eventId: person.eventId,
          targetId: person.id,
          action: "PARTICIPANT_TEST_ACCOUNT",
        });
      marked++;
    }
    return { marked };
  });
}
