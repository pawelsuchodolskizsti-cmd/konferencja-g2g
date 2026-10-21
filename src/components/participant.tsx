"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "./api";
export function CertificateRefresh({ unlockAt }: { unlockAt: string }) {
  const router = useRouter();
  useEffect(() => {
    const unlockTime = new Date(unlockAt).getTime();
    if (Date.now() >= unlockTime) {
      router.refresh();
      return;
    }
    const check = () => {
      if (Date.now() >= unlockTime) {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", check);
        router.refresh();
      }
    };
    const timer = window.setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, unlockAt]);
  return null;
}
export function CheckinRefresh() {
  const router = useRouter();
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(check, 12000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [router]);
  return null;
}
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
