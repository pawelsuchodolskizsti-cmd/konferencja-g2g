import { ConferenceProgram } from "@/components/conference-program";
import { db } from "@/db";
import { events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Image from "next/image";
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
      <section
        id="organizatorzy"
        className={styles.organizers}
        aria-labelledby="organizers-title"
      >
        <h2 id="organizers-title">Organizator i partnerzy</h2>
        <div className={styles.organizerGrid}>
          {[
            {
              role: "Organizator",
              name: "Fundacja One Day",
              position: styles.oneDay,
            },
            {
              role: "Patronat honorowy",
              name: "Rzecznik Praw Dziecka",
              position: styles.childRights,
            },
            {
              role: "Partner współzapraszający",
              name: "Ogólnopolskie Stowarzyszenie Placówek Opiekuńczo-Wychowawczych „Dla Naszych Dzieci”",
              position: styles.association,
            },
          ].map((partner) => (
            <article key={partner.role} className={styles.organizerCard}>
              <h3>{partner.role}</h3>
              <div className={`${styles.partnerLogo} ${partner.position}`}>
                <Image
                  src="/branding/organizatorzy-zrodlo.jpg"
                  alt={partner.name}
                  width={2858}
                  height={1905}
                  sizes="1920px"
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </ConferenceShell>
  );
}
