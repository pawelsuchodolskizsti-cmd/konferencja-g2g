import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ConferenceShell } from "@/components/conference-shell";
import { Login } from "@/components/login";
import styles from "@/components/admin-login-layout.module.css";

export const metadata: Metadata = {
  title: "Strefa organizatora | Głowa do Góry",
};

export default function Page() {
  return (
    <ConferenceShell current="admin">
      <section className={styles.content} aria-labelledby="admin-title">
        <div className={styles.card}>
          <Link className={styles.conference} href="/">
            Konferencja Głowa do Góry
          </Link>
          <div className={styles.titleRow}>
            <h1 id="admin-title" className={styles.title}>
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
            Strefa organizatora.
            <br />
            Zaloguj się, aby zarządzać konferencją.
          </p>
          <Login />
        </div>
        <Link href="/" className={styles.back}>
          <span aria-hidden="true">←</span> Wróć do konferencji
        </Link>
      </section>
    </ConferenceShell>
  );
}
