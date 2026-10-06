"use client";
import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { api, dateTime } from "./api";
export function Scanner({
  eventId,
  onComplete,
  initialToken,
}: {
  eventId: string;
  onComplete?: () => void;
  initialToken?: string;
}) {
  const scanner = useRef<Html5Qrcode | null>(null);
  const locked = useRef(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    alreadyPresent: boolean;
    checkedInAt: string;
    firstName: string;
    lastName: string;
  } | null>(null);
  useEffect(
    () => () => {
      const current = scanner.current;
      if (current?.isScanning) void current.stop().catch(() => {});
    },
    [],
  );
  async function submit(raw: string) {
    if (locked.current) return;
    locked.current = true;
    setError("");
    setResult(null);
    try {
      let token = raw.trim();
      if (token.startsWith("http")) {
        const url = new URL(token);
        if (
          url.origin !== window.location.origin ||
          !/^\/checkin\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
        )
          throw new Error("Ten kod QR nie należy do tej aplikacji.");
        token = url.pathname.split("/").pop()!;
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new Error("Nieprawidłowy kod QR.");
      setResult(
        await api(`/api/admin/events/${eventId}/checkin`, {
          method: "POST",
          body: JSON.stringify({ token }),
        }),
      );
      onComplete?.();
      if (scanner.current?.isScanning) scanner.current.pause(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd skanowania.");
      locked.current = false;
    }
  }
  return (
    <section className="card">
      <h2>Rejestracja przy wejściu</h2>
      <p className="muted">
        Skieruj aparat na kod z zaproszenia. Rejestracja potwierdzi obecność i
        odblokuje szkolenia.
      </p>
      <div id="qr-reader" style={{ maxWidth: 520, margin: "auto" }} />
      {!active && (
        <button
          onClick={async () => {
            setError("");
            try {
              const { Html5Qrcode } = await import("html5-qrcode");
              const current = new Html5Qrcode("qr-reader");
              scanner.current = current;
              await current.start(
                { facingMode: "environment" },
                {
                  fps: 8,
                  qrbox: (width, height) => {
                    const size = Math.min(
                      230,
                      Math.floor(Math.min(width, height) * 0.75),
                    );
                    return { width: size, height: size };
                  },
                },
                (text) => {
                  void submit(text);
                },
                () => {},
              );
              setActive(true);
            } catch {
              setError(
                "Nie można uruchomić aparatu. Sprawdź uprawnienia przeglądarki lub użyj ręcznej rejestracji.",
              );
            }
          }}
        >
          Włącz aparat
        </button>
      )}
      {active && (
        <button
          className="secondary"
          onClick={async () => {
            if (scanner.current?.isScanning) await scanner.current.stop();
            setActive(false);
          }}
        >
          Wyłącz aparat
        </button>
      )}
      {result && (
        <div
          className={`scanresult ${result.alreadyPresent ? "scan-used" : "scan-first"}`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {result.alreadyPresent ? "Bilet użyty" : "✓ Pierwsze skanowanie"}
          </strong>
          <p className="scan-person">
            {result.firstName} {result.lastName}
          </p>
          <p className="scan-time">
            Pierwsze wejście: {dateTime(result.checkedInAt)}
          </p>
          <button
            onClick={() => {
              setResult(null);
              locked.current = false;
              if (active && scanner.current?.isScanning)
                scanner.current.resume();
            }}
          >
            Skanuj następny kod
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <details style={{ marginTop: "1rem" }} open={!!initialToken}>
        <summary>Wklej token lub adres z kodu QR</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(String(new FormData(e.currentTarget).get("token")));
          }}
        >
          <label>
            Kod QR
            <input name="token" defaultValue={initialToken} required />
          </label>
          <button disabled={!!result}>Zarejestruj wejście</button>
        </form>
      </details>
    </section>
  );
}
