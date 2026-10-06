"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
export function ParticipantActions({
  certificateReady,
}: {
  certificateReady: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      {certificateReady && (
        <div className="actions">
          <a className="button" href="/api/participant/certificate" download>
            Pobierz certyfikat PDF
          </a>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api<{ status: string }>(
                  "/api/participant/certificate-email",
                  { method: "POST" },
                );
                setMessage(
                  result.status === "SENT"
                    ? "Certyfikat został już wysłany na Twój e-mail."
                    : result.status === "ERROR"
                      ? "Wysyłka nie powiodła się. Skontaktuj się z organizatorem."
                      : "Certyfikat czeka na wysłanie na Twój adres e-mail.",
                );
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "Błąd wysyłki.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Wyślij na mój e-mail
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </>
  );
}
export function ParticipantLogout() {
  const router = useRouter();
  return (
    <button
      className="secondary"
      onClick={async () => {
        await api("/api/auth/logout-participant", { method: "POST" });
        router.replace("/uczestnik");
        router.refresh();
      }}
    >
      Wyloguj
    </button>
  );
}
