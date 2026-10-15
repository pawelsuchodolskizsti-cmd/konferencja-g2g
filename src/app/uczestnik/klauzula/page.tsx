import type { Metadata } from "next";
import Link from "next/link";
import { ConferenceShell } from "@/components/conference-shell";
import { participantPrivacyParagraphs } from "@/lib/participant-privacy";
import styles from "./privacy.module.css";
export const metadata: Metadata = {
  title: "Klauzula informacyjna | Strefa Uczestnika",
};
export default function Page() {
  return (
    <ConferenceShell current="participant">
      <article className={styles.content}>
        <Link href="/uczestnik" className={styles.back}>
          ← Przejdź do logowania
        </Link>
        <h1>Klauzula informacyjna</h1>
        <h2>Strefa Uczestnika</h2>
        {participantPrivacyParagraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        <Link href="/uczestnik" className={styles.back}>
          ← Przejdź do logowania
        </Link>
      </article>
    </ConferenceShell>
  );
}
