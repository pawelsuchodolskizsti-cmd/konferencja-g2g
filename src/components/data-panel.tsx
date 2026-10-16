"use client";
import { useEffect, useState } from "react";
import { api, dateTime, type Person } from "./api";
import { DownloadButton } from "./admin-tools";
type Archive = {
  id: string;
  createdAt: string;
  participantCount: number;
  byteLength: number;
  reason: string;
  files: string[];
};
type Preview = {
  fingerprint: string;
  people: { id: string; firstName: string; lastName: string; email: string }[];
};
export function DataPanel({
  eventId,
  people = [],
  readOnly = false,
  onChanged,
}: {
  eventId: string;
  people?: Person[];
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const base = `/api/admin/events/${eventId}`;
  const [archives, setArchives] = useState<Archive[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [removeId, setRemoveId] = useState(""),
    [removeConfirmation, setRemoveConfirmation] = useState("");
  useEffect(() => {
    let active = true;
    api<Archive[]>(`${base}/archives`)
      .then((rows) => {
        if (active) setArchives(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd operacji.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setArchives(await api<Archive[]>(`${base}/archives`));
  }
  const visible = people.filter((p) =>
    `${p.firstName} ${p.lastName} ${p.email}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="card">
        <h2>Archiwa konferencji</h2>
        <p>
          „Utwórz archiwum” zapisuje na serwerze paczkę ZIP: listę uczestników i
          kodów CSV/Excel, zaproszenia PDF w paczkach ZIP, obecności, raport
          certyfikatów, RODO, ankietę CSV/Excel, historię oraz ustawienia
          konferencji. Wcześniej pobrane pliki nie są dodawane automatycznie.
        </p>
        <p>
          Archiwum można pobrać ponownie po wyczyszczeniu uczestników. Nie jest
          kopią bazy do automatycznego przywracania. Nie generuje nowych
          certyfikatów.
        </p>
        {!readOnly && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`${base}/archives`, { method: "POST", body: "{}" });
                await refresh();
                setNotice("Archiwum zapisane. Możesz pobrać ZIP.");
              })
            }
          >
            {busy ? "Trwa operacja…" : "Utwórz archiwum"}
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!archives.length && <p>Brak zapisanych archiwów.</p>}
        {archives.map((a) => (
          <div className="card" key={a.id}>
            <h3>
              {dateTime(a.createdAt)} — {a.reason}
            </h3>
            <p>
              {a.participantCount} uczestników ·{" "}
              {(a.byteLength / 1024 / 1024).toFixed(2)} MB
            </p>
            <details>
              <summary>Zawartość paczki</summary>
              <ul>
                {a.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </details>
            <DownloadButton href={`${base}/archives/${a.id}`}>
              Pobierz archiwum ZIP
            </DownloadButton>
            {!readOnly && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setRemoveId(a.id);
                  setRemoveConfirmation("");
                }}
              >
                Usuń archiwum
              </button>
            )}
          </div>
        ))}
        {removeId && (
          <div role="group" aria-label="Potwierdzenie usunięcia archiwum">
            <p>
              Usunięcie tej paczki jest trwałe. Nie usuwa uczestników ani plików
              pobranych na komputer.
            </p>
            <label>
              Wpisz USUŃ ARCHIWUM
              <input
                value={removeConfirmation}
                onChange={(e) => setRemoveConfirmation(e.target.value)}
              />
            </label>
            <button
              disabled={busy || removeConfirmation !== "USUŃ ARCHIWUM"}
              onClick={() =>
                void run(async () => {
                  await api(`${base}/archives/${removeId}`, {
                    method: "DELETE",
                    body: JSON.stringify({ confirmation: removeConfirmation }),
                  });
                  setRemoveId("");
                  await refresh();
                  setNotice("Archiwum usunięte.");
                })
              }
            >
              Trwale usuń archiwum
            </button>
            <button disabled={busy} onClick={() => setRemoveId("")}>
              Anuluj
            </button>
          </div>
        )}
      </section>
      {!readOnly && (
        <section className="card">
          <h2>Czyszczenie uczestników przed konferencją</h2>
          <p>
            Zaznacz osoby testowe lub inne wpisy przeznaczone do usunięcia. Samo
            wyszukanie słowa „test” niczego nie usuwa. Funkcja działa wyłącznie
            przed rozpoczęciem konferencji.
          </p>
          <p>
            Usunięte zostaną wybrane konta, sesje, obecności, wpisy certyfikatów
            i powiązane dane. Przydzielone kody szkoleniowe zostaną wycofane.
            Ustawienia, materiały, zespół oraz pozostali uczestnicy zostaną
            zachowani. Anonimowe odpowiedzi ankiety i wcześniejsze archiwa
            pozostają — nie można przypisać anonimowej odpowiedzi do wybranej
            osoby.
          </p>
          <label>
            Szukaj osoby lub adresu e-mail
            <input
              disabled={busy}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setSelected([
                  ...new Set([...selected, ...visible.map((p) => p.id)]),
                ]);
                setPreview(null);
              }}
            >
              Zaznacz widocznych ({visible.length})
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setSelected([]);
                setPreview(null);
              }}
            >
              Wyczyść zaznaczenie
            </button>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Wybór</th>
                  <th>Uczestnik</th>
                  <th>E-mail</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Wybierz ${p.firstName} ${p.lastName}`}
                        disabled={busy}
                        checked={selected.includes(p.id)}
                        onChange={(e) => {
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          );
                          setPreview(null);
                          setConfirmation("");
                        }}
                      />
                    </td>
                    <td>
                      {p.firstName} {p.lastName}
                    </td>
                    <td>{p.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || !selected.length}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await api<Preview>(`${base}/data-cleanup/preview`, {
                    method: "POST",
                    body: JSON.stringify({ ids: selected }),
                  }),
                );
                setConfirmation("");
              })
            }
          >
            Podgląd usunięcia ({selected.length})
          </button>
          {preview && (
            <div role="group" aria-label="Potwierdzenie czyszczenia">
              <h3>Do usunięcia: {preview.people.length}</h3>
              <ul>
                {preview.people.map((p) => (
                  <li key={p.id}>
                    {p.firstName} {p.lastName} — {p.email}
                  </li>
                ))}
              </ul>
              <p>
                Najpierw zostanie zapisane archiwum. Jeśli archiwizacja się nie
                powiedzie, żaden uczestnik nie zostanie usunięty. Usunięcie jest
                trwałe; archiwum służy do pobierania raportów, nie do
                przywracania kont.
              </p>
              <label>
                Wpisz USUŃ WYBRANYCH
                <input
                  disabled={busy}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                disabled={busy || confirmation !== "USUŃ WYBRANYCH"}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{ deleted: number }>(
                      `${base}/data-cleanup`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          ids: preview.people.map((p) => p.id),
                          fingerprint: preview.fingerprint,
                          confirmation,
                        }),
                      },
                    );
                    setSelected([]);
                    setPreview(null);
                    setConfirmation("");
                    await refresh();
                    onChanged?.();
                    setNotice(
                      `Usunięto ${result.deleted} uczestników. Archiwum zapisano powyżej.`,
                    );
                  })
                }
              >
                {busy
                  ? "Archiwizacja i czyszczenie…"
                  : "Zapisz archiwum i usuń wybranych"}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
