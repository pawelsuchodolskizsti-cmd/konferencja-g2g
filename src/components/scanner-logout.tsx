"use client";
import { useState } from "react";
import { api } from "./api";

export function ScannerLogout() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="scanner-account">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await api("/api/auth/logout-admin", { method: "POST" });
            window.location.replace("/admin/login");
          } catch {
            setError("Nie udało się wylogować. Spróbuj ponownie.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Wylogowywanie…" : "Wyloguj"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
