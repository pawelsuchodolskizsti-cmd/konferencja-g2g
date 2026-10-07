"use client";

import { useEffect, useState } from "react";
import type { AgendaItem } from "@/db/schema";
import { ConferenceProgram } from "./conference-program";
import { programStatus } from "./program-status";
import styles from "./participant-program.module.css";

export function ParticipantProgram({
  items,
  startsAt,
  timezone,
  initialNow,
}: {
  items: AgendaItem[];
  startsAt: string;
  timezone: string;
  initialNow: string;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    const update = () => setNow(new Date());
    const interval = window.setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const { current, next, state } = programStatus(
    items,
    startsAt,
    timezone,
    now,
  );
  const date = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(new Date(startsAt));
  return (
    <div className={styles.program}>
      <div className={styles.highlights} aria-live="polite" aria-atomic="true">
        <section
          className={styles.current}
          aria-label="Aktualny punkt programu"
        >
          <p className={styles.label}>Teraz</p>
          {current ? (
            <Slot item={current} />
          ) : (
            <p className={styles.message}>
              {state === "before"
                ? `Zaczynamy ${date} o ${next?.start}.`
                : state === "after"
                  ? "Wszystkie punkty programu już się zakończyły."
                  : state === "empty"
                    ? "Program pojawi się wkrótce."
                    : "Chwila przerwy przed kolejnym punktem programu."}
            </p>
          )}
        </section>
        {next && (
          <section className={styles.next} aria-label="Następny punkt programu">
            <p className={styles.label}>Następnie</p>
            <Slot item={next} />
          </section>
        )}
      </div>
      <details className={styles.full}>
        <summary>
          <span className={styles.expand}>Rozwiń cały plan</span>
          <span className={styles.collapse}>Zwiń cały plan</span>
          <span className={styles.chevron} aria-hidden="true">
            ⌄
          </span>
        </summary>
        <ConferenceProgram items={items} />
      </details>
    </div>
  );
}

function Slot({ item }: { item: AgendaItem }) {
  return (
    <>
      <p className={styles.time}>
        {item.start} do {item.end}
      </p>
      <h3>{item.title}</h3>
      {item.speaker && <p className={styles.speaker}>{item.speaker}</p>}
      {item.guest && (
        <p className={styles.speaker}>Gość specjalny: {item.guest}</p>
      )}
    </>
  );
}
