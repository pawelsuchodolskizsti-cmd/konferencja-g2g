import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { materials } from "@/db/schema";
import { requireAdmin, requireEvent } from "@/server/auth";
import { ConferenceShell } from "@/components/conference-shell";
import { ParticipantMaterials } from "@/components/participant-materials";
import styles from "@/app/uczestnik/panel/panel.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Podgląd materiałów uczestnika",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const admin = await requireAdmin();
  const eventId = z.uuid().parse((await searchParams).event);
  await requireEvent(admin.id, eventId);
  const files = await db()
    .select({ id: materials.id, title: materials.title })
    .from(materials)
    .where(and(eq(materials.eventId, eventId), eq(materials.published, true)));
  return (
    <ConferenceShell current="participant">
      <div className={styles.panel}>
        <p role="status">
          Podgląd administratora. Wygląd kart w panelu uczestnika po
          odblokowaniu. Ten podgląd nie zmienia dostępu uczestników.
        </p>
        <ParticipantMaterials files={files} adminEventId={eventId} />
      </div>
    </ConferenceShell>
  );
}
