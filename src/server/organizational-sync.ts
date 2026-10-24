import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { organizationalDeliveries, participants } from "@/db/schema";
import { participantMailRecipients } from "@/lib/mail-recipients";
import { encrypt } from "./crypto";
import { assert } from "./errors";

// Caller holds the event and participant locks, in that order. Claims take the
// same event lock before leasing a message, so edits cannot race an SMTP attempt.
export async function syncOrganizationalParticipant(
  database: Pick<Database, "select" | "update">,
  person: typeof participants.$inferSelect,
) {
  const pending = await database
    .select()
    .from(organizationalDeliveries)
    .where(
      and(
        eq(organizationalDeliveries.participantId, person.id),
        inArray(organizationalDeliveries.status, [
          "QUEUED",
          "FAILED",
          "SENDING",
          "REVIEW_REQUIRED",
        ]),
      ),
    )
    .for("update");
  assert(
    !pending.some(
      (row) => row.status === "SENDING" || row.status === "REVIEW_REQUIRED",
    ),
    409,
    "Najpierw zakończ lub rozlicz niepewną wysyłkę wiadomości organizacyjnej tej osoby. Dane i kod nie zostały zmienione.",
  );
  if (!pending.length) return;
  await database
    .update(organizationalDeliveries)
    .set({
      recipientsEncrypted: encrypt(
        JSON.stringify(participantMailRecipients(person)),
      ),
      contentEncrypted: null,
    })
    .where(
      inArray(
        organizationalDeliveries.id,
        pending.map((row) => row.id),
      ),
    );
}
