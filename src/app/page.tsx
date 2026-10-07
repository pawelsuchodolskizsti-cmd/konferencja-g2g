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
      <div className={styles.homeLayout}>
        <section className={styles.hero} aria-labelledby="conference-title">
          <p className={styles.eyebrow}>Konferencja</p>
          <h1 className={styles.title} id="conference-title">
            <svg
              viewBox="0 0 123 219"
              role="img"
              aria-label="Głowa do góry"
              className={styles.originalTitle}
            >
              <defs>
                <clipPath id="title-layout-crop">
                  <rect x="59" y="15" width="174" height="56" />
                  <rect x="18" y="71" width="219" height="67" />
                </clipPath>
                <filter
                  id="title-white-alpha"
                  colorInterpolationFilters="sRGB"
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                >
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.333 0 0 0 -2.333"
                  />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope="2" intercept="0" />
                  </feComponentTransfer>
                  <feMorphology operator="dilate" radius="0.35" />
                </filter>
              </defs>
              <g transform="translate(0 219) rotate(-90) translate(-18 -15)">
                <g clipPath="url(#title-layout-crop)">
                  <image
                    href="/branding/tytul-uklad.png"
                    width="263"
                    height="149"
                    filter="url(#title-white-alpha)"
                  />
                </g>
              </g>
            </svg>
          </h1>
        </section>
        <div className={styles.homeSections}>
          {!!event?.agenda.length && (
            <section
              id="program"
              className={styles.programSection}
              aria-labelledby="program-title"
            >
              <h2 id="program-title" className={styles.verticalProgramTitle}>
                <svg
                  viewBox="80 65 245 1450"
                  role="img"
                  aria-label="Program konferencji Głowa do góry"
                  className={styles.programTitleArtwork}
                >
                  <defs>
                    <filter
                      id="program-title-alpha"
                      colorInterpolationFilters="sRGB"
                      x="0"
                      y="0"
                      width="100%"
                      height="100%"
                    >
                      <feColorMatrix
                        type="matrix"
                        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.333 0 0 0 -2.333"
                      />
                    </filter>
                  </defs>
                  <image
                    href="/branding/program-oryginal.jpg"
                    width="1365"
                    height="1824"
                    filter="url(#program-title-alpha)"
                  />
                </svg>
              </h2>
              <div className={styles.programContent}>
                <p className={styles.eyebrow}>
                  27 października 2026 · Warszawa
                </p>
                <p>Teatr Garnizon Sztuki</p>
                <ol className={styles.posterProgram}>
                  {event.agenda.map((item, index) => (
                    <li key={`${item.start}-${index}`}>
                      {item.block && (
                        <h3 className={styles.posterBlock}>{item.block}</h3>
                      )}
                      <article className={styles.posterEntry}>
                        <div className={styles.posterMeta}>
                          <p className={styles.posterTime}>
                            <time>{item.start}</time> - <time>{item.end}</time>
                          </p>
                          {item.speaker && (
                            <p>
                              <span>Prowadzenie:</span> {item.speaker}
                            </p>
                          )}
                          {item.guest && (
                            <p>
                              <span>Gość specjalny:</span> {item.guest}
                            </p>
                          )}
                        </div>
                        <div className={styles.posterContent}>
                          <h4>{item.title}</h4>
                          {item.description && <p>{item.description}</p>}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}
          <section
            id="organizatorzy"
            className={styles.organizers}
            aria-labelledby="organizers-title"
          >
            <h2 id="organizers-title">Organizator i patronaci</h2>
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
                  <h3>
                    <strong>{partner.role.split(" ")[0]}</strong>
                    {partner.role.includes(" ") &&
                      ` ${partner.role.split(" ").slice(1).join(" ")}`}
                  </h3>
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
          <section
            id="partnerzy"
            className={styles.organizers}
            aria-labelledby="partners-title"
          >
            <h2 id="partners-title">Partnerzy projektu</h2>
            <svg
              width="0"
              height="0"
              aria-hidden="true"
              className={styles.logoFilter}
            >
              <defs>
                <filter
                  id="partner-white-alpha"
                  colorInterpolationFilters="sRGB"
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                >
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"
                  />
                </filter>
              </defs>
            </svg>
            <div className={styles.projectPartnerGrid}>
              {[
                {
                  name: "InCredibles - Program Sebastiana Kulczyka",
                  position: styles.incredibles,
                },
                {
                  name: "Presidential Hotel Warsaw",
                  position: styles.presidential,
                },
                {
                  name: "Yummy - Party Box & Catering",
                  position: styles.yummy,
                },
                { name: "Garnizon Sztuki", position: styles.garnizon },
              ].map((partner) => (
                <div
                  key={partner.name}
                  className={`${styles.projectPartnerLogo} ${partner.position}`}
                >
                  <Image
                    src="/branding/partnerzy-biale-loga.png"
                    alt={partner.name}
                    width={1942}
                    height={809}
                    sizes="1920px"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </ConferenceShell>
  );
}
