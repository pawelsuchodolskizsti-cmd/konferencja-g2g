import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import publicStyles from "@/app/home.module.css";
import adminStyles from "./admin-shell.module.css";

export function ConferenceShell({
  children,
  current = "home",
}: {
  children: ReactNode;
  current?: "home" | "participant" | "admin";
}) {
  const styles = current === "admin" ? adminStyles : publicStyles;
  return (
    <main className={styles.page} data-section={current}>
      <div className={styles.art} aria-hidden="true">
        {current === "admin" && (
          <>
            <div className={styles.halo} />
            <div className={styles.tiles}>
              <div className={styles.tileOne} />
              <div className={styles.tileTwo} />
              <div className={styles.tileThree} />
              <div className={styles.tileFour} />
            </div>
            <div className={styles.orbit} />
            <div className={styles.dots}>
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
            <svg className={styles.grain} width="100%" height="100%">
              <filter id="paper-grain">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.72"
                  numOctaves="3"
                  stitchTiles="stitch"
                />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect
                width="100%"
                height="100%"
                filter="url(#paper-grain)"
                opacity="0.23"
              />
            </svg>
          </>
        )}
      </div>

      <header className={styles.header}>
        {current === "home" && (
          <Image
            className={styles.projectLogo}
            src="/branding/g2g-horizontal.png"
            alt="Logo projektu g2g"
            width={2106}
            height={747}
            priority
          />
        )}
        <details className={styles.menu}>
          <summary className={styles.menuButton}>
            <span className={styles.menuIcon} aria-hidden="true">
              <span />
              <span />
            </span>
            Menu
          </summary>
          <nav className={styles.menuPanel} aria-label="Menu główne">
            <Link
              href="/"
              aria-current={current === "home" ? "page" : undefined}
            >
              Strona główna
            </Link>
            <Link
              href="/uczestnik"
              aria-current={current === "participant" ? "page" : undefined}
            >
              Strefa użytkownika <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </details>
      </header>

      {children}
    </main>
  );
}
