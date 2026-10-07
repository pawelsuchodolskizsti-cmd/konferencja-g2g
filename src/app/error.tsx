"use client";
import { ConferenceShell } from "@/components/conference-shell";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ConferenceShell current="participant">
      <div className="public">
        <section className="card">
          <h1>Nie udało się wczytać strony</h1>
          <p>
            Spróbuj ponownie za chwilę. Jeśli problem się powtarza, skontaktuj
            się z organizatorem.
          </p>
          <button onClick={reset}>Spróbuj ponownie</button>
        </section>
      </div>
    </ConferenceShell>
  );
}
