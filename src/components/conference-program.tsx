import type { AgendaItem } from "@/db/schema";
import styles from "./conference-program.module.css";

export function ConferenceProgram({ items }: { items: AgendaItem[] }) {
  return (
    <ol className={styles.program}>
      {items.map((item, index) => (
        <li key={`${item.start}-${index}`}>
          {item.block && <h3 className={styles.block}>{item.block}</h3>}
          <article className={styles.entry}>
            <div className={styles.time}>
              <time>{item.start}</time>
              <span>do {item.end}</span>
            </div>
            <div className={styles.content}>
              <h4>{item.title}</h4>
              {item.speaker && (
                <p>
                  <strong>Prowadzenie:</strong> {item.speaker}
                </p>
              )}
              {item.guest && (
                <p>
                  <strong>Gość specjalny:</strong> {item.guest}
                </p>
              )}
              {item.description && (
                <details className={styles.description}>
                  <summary>O wystąpieniu</summary>
                  <p>{item.description}</p>
                </details>
              )}
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
