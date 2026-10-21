import { TrainingCarousel } from "./training-carousel";
import { materialNotice } from "@/lib/material-notice";
import styles from "@/app/uczestnik/panel/panel.module.css";

export function ParticipantMaterials({
  files,
  adminEventId,
}: {
  files: { id: string; title: string }[];
  adminEventId?: string;
}) {
  return (
    <section
      id="materialy"
      className={styles.card}
      aria-labelledby="files-title"
    >
      <div className={styles.sectionLabel}>06 / Materiały dla Ciebie</div>
      <h2 id="files-title">Materiały konferencyjne</h2>
      <p>{materialNotice}</p>
      <TrainingCarousel label="E-booki, przewijaj w lewo i w prawo">
        {files.map((file) => (
          <article className={styles.course} key={file.id}>
            <span className={styles.platform}>E-book • PDF</span>
            <h3>{file.title}</h3>
            <a
              className={styles.communityAction}
              href={
                adminEventId
                  ? `/api/admin/events/${adminEventId}/materials/${file.id}`
                  : `/api/participant/materials/${file.id}`
              }
              download
            >
              <span>Pobierz e-book</span>
              <span className={styles.communityArrow} aria-hidden="true">
                ↓
              </span>
            </a>
          </article>
        ))}
      </TrainingCarousel>
    </section>
  );
}
