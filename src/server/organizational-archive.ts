import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizationalCampaigns,
  organizationalDeliveries,
  participants,
} from "@/db/schema";
import { realParticipant } from "./participant-scope";
import { decrypt } from "./crypto";

export async function organizationalArchive(eventId: string) {
  const campaigns = await db()
    .select()
    .from(organizationalCampaigns)
    .where(eq(organizationalCampaigns.eventId, eventId))
    .orderBy(organizationalCampaigns.createdAt);
  const deliveries = await db()
    .select({
      delivery: organizationalDeliveries,
      participant: {
        id: participants.id,
        firstName: participants.firstName,
        lastName: participants.lastName,
      },
    })
    .from(organizationalDeliveries)
    .innerJoin(
      organizationalCampaigns,
      eq(organizationalDeliveries.campaignId, organizationalCampaigns.id),
    )
    .innerJoin(
      participants,
      eq(organizationalDeliveries.participantId, participants.id),
    )
    .where(
      and(
        eq(organizationalCampaigns.eventId, eventId),
        eq(participants.eventId, eventId),
        realParticipant,
      ),
    )
    .orderBy(organizationalDeliveries.createdAt, organizationalDeliveries.id);
  return {
    version: 1,
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      deliveries: deliveries
        .filter((row) => row.delivery.campaignId === campaign.id)
        .map(({ delivery, participant }) => {
          const {
            recipientsEncrypted,
            contentEncrypted,
            leaseToken: _lease,
            ...status
          } = delivery;
          void _lease;
          return {
            ...status,
            participant,
            recipients: JSON.parse(decrypt(recipientsEncrypted)),
            content: contentEncrypted
              ? JSON.parse(decrypt(contentEncrypted))
              : null,
            contentEvidence: contentEncrypted
              ? "saved-before-smtp"
              : "legacy-template-only",
          };
        }),
    })),
    note: "Treść szablonu, odbiorcy, statusy i identyfikatory SMTP są zapisane. Dla wcześniejszych wysyłek bez utrwalonej kopii content=null; nie odtwarzamy niepotwierdzonej treści z aktualnych danych. Status ACCEPTED oznacza przyjęcie przez SMTP, nie doręczenie do skrzynki.",
  };
}
