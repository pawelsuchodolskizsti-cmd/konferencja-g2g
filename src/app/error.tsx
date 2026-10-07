"use client";
import { ConferenceShell } from "@/components/conference-shell";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ConferenceShell current="participant">
      <div className="public">
        <section className="card">
          <h1>Nie udaĹ‚o siÄ™ wczytaÄ‡ strony</h1>
          <p>
            SprĂłbuj ponownie za chwilÄ™. JeĹ›li problem siÄ™ powtarza,
            skontaktuj siÄ™ z organizatorem.
          </p>
          <button onClick={reset}>SprĂłbuj ponownie</button>
        </section>
      </div>
    </ConferenceShell>
  );
}
