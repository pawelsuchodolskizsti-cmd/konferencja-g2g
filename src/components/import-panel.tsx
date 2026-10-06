"use client";
import { useState } from "react";
import { api } from "./api";
type Preview = {
  id: string;
  total: number;
  valid: number;
  rows: {
    row: number;
    firstName: string;
    lastName: string;
    email: string;
    errors: string[];
  }[];
};
export function ImportPanel({
  eventId,
  onComplete,
}: {
  eventId: string;
  onComplete: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <section className="card">
        <div className="eyebrow">Krok 1 z 2</div>
        <h2>Wgraj listę uczestników</h2>
        <p className="muted">
          Plik XLSX, do 2 MB i 2000 uczestników. Pierwszy wiersz: Imię,
          Nazwisko, Email.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setMessage("");
            setBusy(true);
            const form = new FormData(e.currentTarget);
            try {
              setPreview(
                await api<Preview>(`/api/admin/events/${eventId}/import`, {
                  method: "POST",
                  body: form,
                }),
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Nie udało się wczytać pliku.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Lista uczestników
            <input name="file" type="file" accept=".xlsx" required />
          </label>
          <button disabled={busy}>
            {busy ? "Sprawdzanie…" : "Sprawdź plik"}
          </button>
        </form>
      </section>
      {preview && (
        <section className="card">
          <div className="eyebrow">Krok 2 z 2</div>
          <h2>Sprawdź podsumowanie</h2>
          <div className="stats">
            <div className="stat">
              <small>Wszystkie rekordy</small>
              <strong>{preview.total}</strong>
            </div>
            <div className="stat">
              <small>Poprawne</small>
              <strong>{preview.valid}</strong>
            </div>
            <div className="stat">
              <small>Wymagają poprawy</small>
              <strong>{preview.total - preview.valid}</strong>
            </div>
          </div>
          <p>
            Zapisane zostaną wyłącznie poprawne wiersze. Pozostałe popraw w
            Excelu i wgraj ponownie.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Wiersz</th>
                  <th>Uczestnik</th>
                  <th>E-mail</th>
                  <th>Wynik</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>
                      {row.firstName} {row.lastName}
                    </td>
                    <td>{row.email}</td>
                    <td>
                      {row.errors.length ? (
                        <span className="badge bad">
                          {row.errors.join(", ")}
                        </span>
                      ) : (
                        <span className="badge good">Poprawny</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            style={{ marginTop: "1rem" }}
            disabled={busy || !preview.valid}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api<{ imported: number; skipped: number }>(
                  `/api/admin/events/${eventId}/import-confirm`,
                  {
                    method: "POST",
                    body: JSON.stringify({ batchId: preview.id }),
                  },
                );
                setMessage(
                  `Dodano ${result.imported} uczestników. Pominięto ${result.skipped} rekordów dodanych w międzyczasie.`,
                );
                setPreview(null);
                onComplete();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Błąd importu.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Zatwierdź import {preview.valid} osób
          </button>
        </section>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
    </>
  );
}
