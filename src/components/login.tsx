"use client";
import { useState } from "react";
import Link from "next/link";
export function Login({ admin = false }: { admin?: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth">
      <Link className="brand" href="/">
        <span>K</span> Konferencje
      </Link>
      <section className="card">
        <div className="eyebrow">
          {admin ? "Dla organizatorów" : "Twoje wydarzenie"}
        </div>
        <h1>{admin ? "Panel fundacji" : "Strefa uczestnika"}</h1>
        <p className="muted">
          {admin
            ? "Zaloguj się, aby zarządzać wydarzeniem."
            : "Wpisz indywidualny kod z wiadomości z zaproszeniem."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const res = await fetch(
                `/api/auth/${admin ? "admin" : "participant"}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(Object.fromEntries(f)),
                },
              );
              const json = await res.json();
              if (!res.ok) throw new Error(json.error);
              window.location.assign(admin ? "/admin" : "/uczestnik/panel");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Nie udało się zalogować.",
              );
              setBusy(false);
            }
          }}
        >
          {admin ? (
            <>
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                />
              </label>
              <label>
                Hasło
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label>
              Twój kod dostępu
              <input
                name="code"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                required
                maxLength={100}
                placeholder="Np. K7M2PX"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button disabled={busy} style={{ width: "100%" }}>
            {busy
              ? "Logowanie…"
              : admin
                ? "Zaloguj się"
                : "Przejdź do swojej strefy"}
          </button>
        </form>
      </section>
      <Link href="/wydarzenie">Zobacz program wydarzenia</Link>
    </main>
  );
}
