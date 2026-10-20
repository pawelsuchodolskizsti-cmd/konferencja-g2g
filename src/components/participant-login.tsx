"use client";

import {
  PARTICIPANT_PRIVACY_VERSION,
  participantPrivacySummary,
} from "@/lib/participant-privacy";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/uczestnik/participant-login.module.css";

export function ParticipantLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loginMode, setLoginMode] = useState<"first" | "returning" | null>(
    null,
  );

  return (
    <form
      className={styles.form}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !loginMode) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/auth/participant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: data.get("code"),
              loginMode,
              privacyAcknowledged: loginMode === "first" && acknowledged,
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
      <div
        className={styles.loginModes}
        role="group"
        aria-label="Sposób logowania"
      >
        {(["first", "returning"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={loginMode === mode}
            disabled={busy}
            onClick={() => {
              setLoginMode(mode);
              setAcknowledged(false);
              setError("");
            }}
          >
            {mode === "first" ? "Loguję się pierwszy raz" : "Wchodzę ponownie"}
          </button>
        ))}
      </div>
      {loginMode && (
        <>
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
            6 znaków: wielkie litery i cyfry. Kod znajdziesz w wiadomości
            e-mail.
          </p>
          {loginMode === "first" && (
            <>
              <section
                className={styles.privacy}
                aria-labelledby="privacy-title"
              >
                <h2 id="privacy-title">Twoje dane w Strefie Uczestnika</h2>
                <p>{participantPrivacySummary}</p>
                <Link
                  className={styles.privacyLink}
                  href="/uczestnik/klauzula"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Przeczytaj pełną klauzulę informacyjną
                </Link>
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
            </>
          )}
          {loginMode === "returning" && (
            <p className={styles.hint}>
              Wpisz swój dotychczasowy kod. Ponowne wejście jest dostępne po
              wcześniejszym potwierdzeniu klauzuli RODO.
            </p>
          )}
          {error && (
            <p id="code-error" role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || (loginMode === "first" && !acknowledged)}
          >
            <span>{busy ? "Otwieranie strefy…" : "Wejdź do strefy"}</span>
          </button>
        </>
      )}
    </form>
  );
}
