"use client";

import {
  PARTICIPANT_PRIVACY_VERSION,
  participantPrivacySummary,
  participantPrivacyParagraphs,
} from "@/lib/participant-privacy";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/uczestnik/participant-login.module.css";

export function ParticipantLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <form
      className={styles.form}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/auth/participant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: data.get("code"),
              privacyAcknowledged: acknowledged,
              privacyVersion: PARTICIPANT_PRIVACY_VERSION,
            }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || "Nie udało się zalogować. Spróbuj ponownie.",
            );
          router.push("/uczestnik/panel");
          router.refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Nie udało się połączyć. Spróbuj ponownie.",
          );
          setBusy(false);
        }
      }}
    >
      <label htmlFor="participant-code">Twój kod dostępu</label>
      <div className={styles.inputWrap}>
        <input
          id="participant-code"
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={100}
          placeholder="Np. K7M2PX"
          aria-describedby={error ? "code-hint code-error" : "code-hint"}
          aria-invalid={!!error}
        />
        <svg
          className={styles.keyIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="5" />
          <path d="m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3" />
        </svg>
      </div>
      <p id="code-hint" className={styles.hint}>
        6 znaków: wielkie litery i cyfry. Kod znajdziesz w zaproszeniu.
      </p>
      <section className={styles.privacy} aria-labelledby="privacy-title">
        <h2 id="privacy-title">Twoje dane w Strefie Uczestnika</h2>
        <p>{participantPrivacySummary}</p>
        <details className={styles.privacyDetails}>
          <summary>Przeczytaj pełną klauzulę informacyjną</summary>
          <div>
            {participantPrivacyParagraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </details>
      </section>
      <label className={styles.privacyCheck}>
        <input
          type="checkbox"
          name="privacyAcknowledged"
          required
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>
          Potwierdzam zapoznanie się z klauzulą informacyjną dotyczącą
          przetwarzania moich danych w Strefie Uczestnika.
        </span>
      </label>
      {error && (
        <p id="code-error" role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !acknowledged}>
        <span>{busy ? "Otwieranie strefy…" : "Wejdź do strefy"}</span>
      </button>
    </form>
  );
}
