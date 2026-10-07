import { ConferenceProgram } from "@/components/conference-program";
import { db } from "@/db";
import { events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ConferenceShell } from "@/components/conference-shell";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Głowa do Góry | Konferencja",
  description: "Konferencja Głowa do Góry. Strefa uczestnika.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const [event] = await db()
    .select({ agenda: events.agenda })
    .from(events)
    .where(and(eq(events.slug, "glowa-do-gory"), eq(events.published, true)))
    .limit(1);
  return (
    <ConferenceShell>
      <section className={styles.hero} aria-labelledby="conference-title">
        <p className={styles.eyebrow}>Konferencja</p>
        <h1 className={styles.title} id="conference-title">
          <span>Głowa do</span>
          <span>Góry</span>
        </h1>
      </section>
      {!!event?.agenda.length && (
        <section
          id="program"
          className={styles.programSection}
          aria-labelledby="program-title"
        >
          <p className={styles.eyebrow}>27 października 2026 · Warszawa</p>
          <h2 id="program-title">Program konferencji</h2>
          <p>Teatr Garnizon Sztuki</p>
          <ConferenceProgram items={event.agenda} />
        </section>
      )}
    </ConferenceShell>
  );
}
