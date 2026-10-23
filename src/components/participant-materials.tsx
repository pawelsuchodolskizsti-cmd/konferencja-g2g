import { TrainingCarousel } from "./training-carousel";
import Image from "next/image";
import artwork from "./participant-materials.module.css";
import { materialNotice } from "@/lib/material-notice";
import styles from "@/app/uczestnik/panel/panel.module.css";

function coverForTitle(title: string) {
  const normalized = title.toLocaleLowerCase("pl").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalized.includes("zabierz") && normalized.includes("randk"))
    return { src: "/ebooks/zabierz-siebie-na-randke.png", width: 1300, height: 1300 };
  if (normalized.includes("relacje") && normalized.includes("360"))
    return { src: "/ebooks/relacje-360-stopni.png", width: 1414, height: 2000 };
  return null;
}

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
        {files.map((file) => {
          const cover = coverForTitle(file.title);
          return (
          <article className={`${styles.course} ${artwork.card}`} key={file.id}>
            <span className={styles.platform}>E-book • PDF</span>
            <h3>{file.title}</h3>
            {cover && (
              <Image
                {...cover}
                alt={`Okładka e-booka ${file.title}`}
                className={artwork.cover}
                sizes="(max-width: 600px) 70vw, 320px"
              />
            )}
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
          );
        })}
      </TrainingCarousel>
    </section>
  );
}
