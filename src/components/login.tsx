"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/uczestnik/participant-login.module.css";
import adminStyles from "./admin-login.module.css";

export function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={`${styles.form} ${adminStyles.form}`}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/auth/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: data.get("email"),
              password: data.get("password"),
            }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || "Nie udało się zalogować. Spróbuj ponownie.",
            );
          router.push("/admin");
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
      <label htmlFor="admin-email">Adres e-mail</label>
      <div className={styles.inputWrap}>
        <input
          id="admin-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Twój adres e-mail"
          aria-describedby={error ? "admin-login-error" : undefined}
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
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      </div>
      <label className={adminStyles.passwordLabel} htmlFor="admin-password">
        Hasło
      </label>
      <div className={styles.inputWrap}>
        <input
          id="admin-password"
          name="password"
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
          placeholder="Twoje hasło"
          aria-describedby={error ? "admin-login-error" : undefined}
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
          <rect x="5" y="10" width="14" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
        </svg>
      </div>
      {error && (
        <p id="admin-login-error" role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        <span>{busy ? "Logowanie…" : "Zaloguj się"}</span>
      </button>
    </form>
  );
}
