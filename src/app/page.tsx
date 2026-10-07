import type { Metadata } from "next";
import { ConferenceShell } from "@/components/conference-shell";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Głowa do Góry | Konferencja",
  description: "Konferencja Głowa do Góry. Strefa uczestnika.",
};

export default function Home() {
  return (
    <ConferenceShell>
      <section className={styles.hero} aria-labelledby="conference-title">
        <p className={styles.eyebrow}>Konferencja</p>
        <h1 className={styles.title} id="conference-title">
          <span>Głowa do</span>
          <span>Góry</span>
        </h1>
      </section>
    </ConferenceShell>
  );
}
