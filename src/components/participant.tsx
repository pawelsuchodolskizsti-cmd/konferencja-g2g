"use client";
import { useRouter } from "next/navigation";
import { api } from "./api";
export function ParticipantActions({
  certificateReady,
}: {
  certificateReady: boolean;
}) {
  return certificateReady ? (
    <div className="actions">
      <a className="button" href="/api/participant/certificate" download>
        Pobierz certyfikat PDF
      </a>
    </div>
  ) : null;
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
