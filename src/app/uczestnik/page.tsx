import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { ConferenceShell } from "@/components/conference-shell";
import { ParticipantLogin } from "@/components/participant-login";
import styles from "./participant-login.module.css";

export const metadata: Metadata = {
  title: "Strefa użytkownika | Głowa do Góry",
};

export default function Page() {
  return (
    <ConferenceShell current="participant">
      <section className={styles.content} aria-labelledby="participant-title">
        <div className={styles.card}>
          <Link className={styles.conference} href="/">
            Konferencja Głowa do Góry
          </Link>
          <div className={styles.titleRow}>
            <h1 id="participant-title" className={styles.title}>
              Twoja
              <br />
              strefa<span>.</span>
            </h1>
            <Image
              className={styles.projectLogo}
              src="/branding/g2g-vertical.png"
              alt="Logo projektu g2g"
              width={1024}
              height={1536}
              priority
            />
          </div>
          <p className={styles.intro}>
            Twoje materiały, szkolenia i certyfikat.
            <br />
            Wszystko w jednym miejscu.
          </p>
          <ParticipantLogin />
        </div>
        <Link href="/" className={styles.back}>
          <span aria-hidden="true">←</span> Wróć do konferencji
        </Link>
      </section>
    </ConferenceShell>
  );
}
