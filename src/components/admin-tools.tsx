"use client";
import { materialNotice } from "@/lib/material-notice";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, dateTime, type Overview, type Person } from "./api";
import { filterParticipants } from "@/lib/participant-filter";
import { participantPrivacyParagraphs } from "@/lib/participant-privacy";

type Action = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<Record<string, unknown> | null>;
export function DownloadButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const downloadUrl = new URL(href, window.location.origin);
            const usePost =
              href.length > 1800 &&
              /\/(codes-export|reports|export)$/.test(downloadUrl.pathname);
            const res = await fetch(
              usePost ? downloadUrl.pathname : href,
              usePost
                ? {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                      Object.fromEntries(downloadUrl.searchParams),
                    ),
                  }
                : undefined,
            );
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data.error || "Nie udało się pobrać pliku.");
            }
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download =
              res.headers
                .get("Content-Disposition")
                ?.match(/filename="([^"]+)"/)?.[1] || "plik";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Błąd pobierania.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Przygotowywanie…" : children}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
export function ParticipantActions({
  person,
  eventId,
  action,
  busy,
}: {
  person: Person;
  eventId: string;
  action: Action;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const base = `/api/admin/events/${eventId}`;
  return (
    <section className="card">
      <h3>Karta uczestnika</h3>
      <p>
        Kod uczestnika: <strong>{person.accessCode}</strong>
      </p>
      <p>
        Obecność:{" "}
        {person.checkedInAt ? dateTime(person.checkedInAt) : "Niepotwierdzona"}.
        Certyfikat:{" "}
        {person.certificateGeneratedAt
          ? dateTime(person.certificateGeneratedAt)
          : "Nie wygenerowano"}
        .
      </p>
      <div className="actions">
        <DownloadButton
          href={`${base}/codes-export?format=pdf&ids=${person.id}`}
        >
          Pobierz zaproszenie PDF z QR
        </DownloadButton>
        <DownloadButton href={`${base}/participants/${person.id}/certificate`}>
          Pobierz certyfikat
        </DownloadButton>
        <DownloadButton href={`${base}/participants/${person.id}/data`}>
          Eksport danych osoby
        </DownloadButton>
        <a
          className="button secondary"
          href={`/admin?section=history&target=${person.id}`}
        >
          Historia uczestnika
        </a>
      </div>
      <p className="muted">
        Certyfikat wymaga potwierdzonej obecności i upływu ustalonego terminu
        udostępnienia.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          if (
            window.confirm(
              "Unieważnić dotychczasowy kod uczestnika i QR oraz wylogować tę osobę? Po zmianie pobierz i przekaż nowe zaproszenie.",
            )
          )
            await action(`participants/${person.id}/reset`, {
              confirmation: "ZMIEŃ KODY",
            });
        }}
      >
        Wymień kod uczestnika i QR
      </button>
      {person.checkedInAt && (
        <div style={{ marginTop: 20 }}>
          <label>
            Powód korekty obecności
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={300}
            />
          </label>
          <button
            type="button"
            className="danger"
            disabled={busy || reason.trim().length < 5}
            onClick={async () => {
              if (
                window.confirm(
                  "Cofnąć omyłkową obecność i zakończyć sesje uczestnika?",
                )
              ) {
                if (
                  await action(`participants/${person.id}/undo-checkin`, {
                    reason,
                  })
                )
                  setReason("");
              }
            }}
          >
            Cofnij omyłkową obecność
          </button>
          <p className="muted">
            Operacja jest blokowana po wydaniu certyfikatu lub indywidualnego
            kodu szkoleniowego. Nie cofa wykorzystanych świadczeń.
          </p>
        </div>
      )}
    </section>
  );
}
export function AddParticipant({
  action,
  busy,
}: {
  action: Action;
  busy: boolean;
}) {
  return (
    <details className="card">
      <summary>Dodaj uczestnika ręcznie</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          if (
            await action("participants", Object.fromEntries(new FormData(form)))
          )
            form.reset();
        }}
      >
        <div className="formgrid">
          <label>
            Imię
            <input name="firstName" required maxLength={100} />
          </label>
          <label>
            Nazwisko
            <input name="lastName" required maxLength={100} />
          </label>
          <label>
            E-mail
            <input type="email" name="email" required maxLength={254} />
          </label>
        </div>
        <button disabled={busy}>Dodaj uczestnika</button>
        <p>
          System nada unikalny kod i QR. Dodanie osoby nie potwierdza jej
          obecności.
        </p>
      </form>
    </details>
  );
}
export function ExportCenter({
  people,
  eventId,
  invitations = false,
}: {
  people: Person[];
  eventId: string;
  invitations?: boolean;
}) {
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState("all"),
    [ids, setIds] = useState<string[]>([]);
  const [config, setConfig] = useState({
    title: "ZAPROSZENIE",
    message: "Zapraszamy do udziału w konferencji.",
  });
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/api/admin/events/${eventId}`;
  useEffect(() => {
    if (!invitations) return;
    let active = true;
    api<typeof config>(`${base}/invitation`)
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, invitations]);
  const filtered = filterParticipants(people, { q, filter });
  const selected = ids.length
    ? filtered.filter((p) => ids.includes(p.id))
    : filtered;
  const params = new URLSearchParams({
    q,
    filter,
    ...(ids.length ? { ids: selected.map((p) => p.id).join(",") } : {}),
  }).toString();
  return (
    <>
      <section className="card">
        <h2>
          {invitations
            ? "Zaproszenia z QR i kodem uczestnika"
            : "Centrum eksportów"}
        </h2>
        <p>
          Wybierz filtr i opcjonalnie zaznacz osoby. Pobieranie nie wysyła
          wiadomości ani nie zmienia kodów.
        </p>
        {invitations && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setNotice("");
              try {
                await api(`${base}/invitation`, {
                  method: "POST",
                  body: JSON.stringify(config),
                });
                setNotice("Szablon zaproszenia zapisany.");
              } catch (e) {
                setNotice(e instanceof Error ? e.message : "Błąd zapisu.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nagłówek zaproszenia
              <input
                value={config.title}
                maxLength={50}
                required
                onChange={(e) =>
                  setConfig({ ...config, title: e.target.value })
                }
              />
            </label>
            <label>
              Treść zaproszenia
              <textarea
                value={config.message}
                maxLength={180}
                required
                onChange={(e) =>
                  setConfig({ ...config, message: e.target.value })
                }
              />
            </label>
            <button disabled={busy}>Zapisz szablon zaproszenia</button>
            <p role="status">{notice}</p>
            <p className="muted">
              PDF zawiera również dane konferencji, imię i nazwisko,
              indywidualny QR oraz kod do strefy.
            </p>
          </form>
        )}
        <div className="row">
          <label>
            Szukaj uczestnika lub kodu
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIds([]);
              }}
            />
          </label>
          <label>
            Zakres
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setIds([]);
              }}
            >
              <option value="all">Wszyscy</option>
              <option value="present">Obecni</option>
              <option value="absent">Nieobecni</option>
              <option value="certificate">Z certyfikatem</option>
              <option value="name-review">Odmiana do sprawdzenia</option>
            </select>
          </label>
          <button className="secondary" onClick={() => setIds([])}>
            Wyczyść zaznaczenie
          </button>
        </div>
        <p>
          Do eksportu: <strong>{selected.length}</strong> osób.{" "}
          {ids.length
            ? "Tylko zaznaczone osoby."
            : "Wszystkie osoby z bieżącego filtra."}
        </p>
        {selected.length > 0 && (
          <div className="actions">
            <DownloadButton href={`${base}/codes-export?format=xlsx&${params}`}>
              Excel z kodami
            </DownloadButton>
            <DownloadButton href={`${base}/codes-export?format=csv&${params}`}>
              CSV z kodami
            </DownloadButton>
            {!invitations && (
              <>
                <DownloadButton
                  href={`${base}/reports?kind=attendance&${params}`}
                >
                  Obecność CSV
                </DownloadButton>
                <DownloadButton
                  href={`${base}/reports?kind=certificates&${params}`}
                >
                  Certyfikaty CSV
                </DownloadButton>
                <DownloadButton href={`${base}/reports?kind=privacy&${params}`}>
                  Potwierdzenia klauzuli CSV
                </DownloadButton>
              </>
            )}
          </div>
        )}
        {!invitations && (
          <p>
            <DownloadButton href={`${base}/survey-export?format=csv`}>
              Anonimowe odpowiedzi ankiety CSV (całość)
            </DownloadButton>{" "}
            <DownloadButton href={`${base}/survey-export`}>
              Ankieta Excel (całość)
            </DownloadButton>
          </p>
        )}
        <p className="muted">
          Excel zachowuje zera na początku kodów. Plików z kodami nie
          udostępniaj publicznie.
        </p>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Wybór</th>
                <th>Uczestnik</th>
                <th>E-mail</th>
                <th>Kod</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Zaznacz ${p.firstName} ${p.lastName}`}
                      checked={ids.includes(p.id)}
                      onChange={(e) =>
                        setIds(
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    {p.firstName} {p.lastName}
                  </td>
                  <td>{p.email}</td>
                  <td>{p.accessCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function MaterialsManager({
  data,
  action,
  busy,
}: {
  data: Overview;
  action: Action;
  busy: boolean;
}) {
  const base = `/api/admin/events/${data.event.id}`;
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  async function upload(form: HTMLFormElement) {
    const file = new FormData(form).get("file");
    if (!(file instanceof File)) return;
    setUploading(true);
    try {
      if (!file.size || file.size > 20 * 1024 * 1024)
        throw new Error("Limit pliku: 20 MB.");
      setUploadStatus("Sprawdzanie sumy kontrolnej pliku…");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const sha256 = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const session = await api<{ id: string; chunkSize: number }>(
        `${base}/material-uploads`,
        {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            size: file.size,
            sha256,
          }),
        },
      );
      for (
        let offset = 0, index = 0;
        offset < file.size;
        offset += session.chunkSize, index++
      ) {
        setUploadStatus(
          `Przesyłanie: ${Math.round((offset / file.size) * 100)}%`,
        );
        const response = await fetch(
          `${base}/material-uploads/${session.id}/${index}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file.slice(offset, offset + session.chunkSize),
          },
        );
        if (!response.ok)
          throw new Error((await response.json()).error || "Błąd przesyłania.");
      }
      if (await action(`material-uploads/${session.id}/finish`)) {
        form.reset();
        setUploadStatus(
          "Plik zapisany. Zgodność z oryginałem potwierdzona sumą SHA-256.",
        );
      } else setUploadStatus("Nie udało się zatwierdzić pliku.");
    } catch (error) {
      setUploadStatus(
        error instanceof Error ? error.message : "Błąd przesyłania.",
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <section className="card">
      <h2>Materiały uczestników</h2>
      <p>
        <a
          className="button secondary"
          href={`/admin/materialy-podglad?event=${data.event.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Podgląd kart w panelu uczestnika
        </a>
      </p>
      <p>
        {data.event.materialsUnlocked
          ? "Materiały odblokowane"
          : "Materiały zablokowane dla uczestników"}
      </p>
      <button
        disabled={busy || uploading}
        onClick={() =>
          void action("materials-unlock", {
            unlocked: !data.event.materialsUnlocked,
          })
        }
      >
        {data.event.materialsUnlocked
          ? "Zablokuj materiały"
          : "Odblokuj materiały dla uczestników"}
      </button>
      <p>{materialNotice}</p>
      <p>
        Materiały są dostępne po ręcznym odblokowaniu przez organizatora i
        potwierdzeniu obecności uczestnika.
      </p>
      {data.materials.map((file) => (
        <div
          className="card"
          key={`${file.id}-${file.title}-${file.published}`}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action(
                `materials/${file.id}`,
                {
                  title: f.get("title"),
                  published: f.get("published") === "on",
                },
                "PATCH",
              );
            }}
          >
            <label>
              Tytuł materiału
              <input
                name="title"
                defaultValue={file.title}
                required
                maxLength={160}
              />
            </label>
            <label>
              <input
                type="checkbox"
                name="published"
                defaultChecked={file.published}
              />{" "}
              Widoczny dla uczestników
            </label>
            <div className="actions">
              <button disabled={busy}>Zapisz materiał</button>
              <a
                className="button secondary"
                href={`${base}/materials/${file.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Podgląd PDF
              </a>
              <button
                className="danger"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Usunąć materiał „${file.title}”?`))
                    void action(`materials/${file.id}`, undefined, "DELETE");
                }}
              >
                Usuń materiał
              </button>
            </div>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              if (await action(`materials/${file.id}`, new FormData(form)))
                form.reset();
            }}
          >
            <label>
              Zastąp plik PDF (do 2 MB)
              <input type="file" name="file" accept=".pdf" required />
            </label>
            <button disabled={busy}>Zastąp PDF</button>
          </form>
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          await upload(form);
        }}
      >
        <label>
          Nowy materiał PDF (do 20 MB)
          <input type="file" name="file" accept=".pdf" required />
        </label>
        <button disabled={busy || uploading}>
          {uploading ? "Przesyłanie…" : "Dodaj materiał"}
        </button>
        <p role="status">{uploadStatus}</p>
      </form>
    </section>
  );
}
type PrivacyInfo = {
  version: string;
  retentionUntil: string | null;
  lastCleanup: string | null;
  people: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    acknowledgedAt: string | null;
    version: string | null;
  }[];
  requests: {
    id: string;
    participantId: string | null;
    kind: string;
    status: string;
    note: string;
    createdAt: string;
    resolvedAt: string | null;
  }[];
};
export function PrivacyPanel({ eventId }: { eventId: string }) {
  const [ackFilter, setAckFilter] = useState("all");
  const [data, setData] = useState<PrivacyInfo | null>(null),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/api/admin/events/${eventId}`;
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await api<PrivacyInfo>(`${base}/privacy`);
        if (active) setData(result);
      } catch (error) {
        if (active)
          setNotice(
            error instanceof Error
              ? error.message
              : "Nie udało się odświeżyć potwierdzeń.",
          );
      } finally {
        pending = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    const onVisible = () => void refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [base, revision]);
  async function save(path: string, value: unknown) {
    setBusy(true);
    try {
      const result = await api<Record<string, unknown>>(`${base}/${path}`, {
        method: "POST",
        body: JSON.stringify(value),
      });
      setNotice(
        path === "cleanup"
          ? `Usunięto wygasłe dane: importy ${result.imports}, sesje ${result.sessions}, liczniki ${result.limits}.`
          : "Zapisano zgłoszenie.",
      );
      setRevision((v) => v + 1);
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Błąd.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const acknowledgedCount =
    data?.people.filter((p) => p.acknowledgedAt).length ?? 0;
  const visiblePeople = (data?.people ?? []).filter(
    (p) =>
      ackFilter === "all" ||
      (ackFilter === "accepted" ? !!p.acknowledgedAt : !p.acknowledgedAt),
  );
  return (
    <section className="card">
      <h2>RODO i zarządzanie danymi</h2>
      <button
        type="button"
        className="secondary"
        onClick={() => setRevision((v) => v + 1)}
      >
        Odśwież potwierdzenia RODO
      </button>
      <p className="muted">
        Status odświeża się co 30 sekund i po powrocie do karty. Potwierdzenie
        zapisuje się po poprawnym zalogowaniu uczestnika z zaznaczoną klauzulą.
      </p>
      <p role="status">{notice}</p>
      {data && (
        <>
          <p>
            Wersja klauzuli: <strong>{data.version}</strong>. Termin
            przechowywania: {dateTime(data.retentionUntil)}.
          </p>
          <p>
            Rejestr dotyczy zapoznania się z klauzulą, nie zgody marketingowej.
          </p>
          <details>
            <summary>Treść aktualnej klauzuli</summary>
            {participantPrivacyParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </details>
          <DownloadButton href={`${base}/reports?kind=privacy`}>
            Pobierz potwierdzenia CSV
          </DownloadButton>
          <div className="stats">
            <div className="stat">
              <strong>{data.people.length}</strong>
              <span>Wszyscy uczestnicy</span>
            </div>
            <div className="stat">
              <strong>{acknowledgedCount}</strong>
              <span>Zaakceptowali klauzulę RODO</span>
            </div>
            <div className="stat">
              <strong>{data.people.length - acknowledgedCount}</strong>
              <span>Nie zaakceptowali</span>
            </div>
          </div>
          <label>
            Status potwierdzenia RODO
            <select
              value={ackFilter}
              onChange={(e) => setAckFilter(e.target.value)}
            >
              <option value="all">Wszyscy</option>
              <option value="accepted">Zaakceptowali</option>
              <option value="not-accepted">Nie zaakceptowali</option>
            </select>
          </label>
          <p role="status">
            Wyświetlono: {visiblePeople.length} z {data.people.length}
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Uczestnik</th>
                  <th>Zapoznanie z aktualną klauzulą</th>
                  <th>Dane</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.firstName} {p.lastName}
                    </td>
                    <td>{dateTime(p.acknowledgedAt)}</td>
                    <td>
                      <DownloadButton
                        href={`${base}/participants/${p.id}/data`}
                      >
                        Eksport danych
                      </DownloadButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Rejestr zgłoszeń dotyczących danych</h3>
          <p>
            Zamknięcie zgłoszenia jest zapisem jego obsługi. Nie usuwa
            automatycznie uczestnika.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = Object.fromEntries(new FormData(form));
              if (
                await save("privacy", {
                  ...f,
                  participantId: f.participantId || null,
                  status: "OPEN",
                })
              )
                form.reset();
            }}
          >
            <label>
              Osoba
              <select name="participantId">
                <option value="">Bez powiązania z osobą</option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rodzaj
              <select name="kind">
                <option value="ACCESS">Dostęp do danych</option>
                <option value="CORRECTION">Sprostowanie</option>
                <option value="DELETION">Usunięcie</option>
                <option value="OTHER">Inne</option>
              </select>
            </label>
            <label>
              Notatka o obsłudze (bez zbędnych danych osobowych)
              <textarea name="note" maxLength={1000} />
            </label>
            <button disabled={busy}>Dodaj zgłoszenie</button>
          </form>
          {data.requests.map((r) => (
            <div className="card" key={r.id}>
              <p>
                {dateTime(r.createdAt)} · {r.kind} ·{" "}
                {r.status === "DONE" ? "Zamknięte" : "Otwarte"} ·{" "}
                {data.people.find((p) => p.id === r.participantId)?.email ||
                  "Bez powiązania"}
              </p>
              <p>{r.note}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void save("privacy", {
                    ...r,
                    status: r.status === "DONE" ? "OPEN" : "DONE",
                  })
                }
              >
                {r.status === "DONE"
                  ? "Otwórz ponownie"
                  : "Oznacz jako obsłużone"}
              </button>
            </div>
          ))}
          <h3>Porządkowanie danych tymczasowych</h3>
          <p>
            Ostatnie sprzątanie: {dateTime(data.lastCleanup)}. Usuwane są
            wygasłe podglądy importu, sesje i liczniki prób. Uczestnicy
            pozostają bez zmian.
          </p>
          <button disabled={busy} onClick={() => void save("cleanup", {})}>
            Usuń wygasłe dane tymczasowe
          </button>
          <h3>Usuwanie danych konferencji</h3>
          <p>
            Operacja w Ustawieniach konferencji jest dostępna po terminie
            przechowywania. Usuwa uczestników, sesje, obecności, wiadomości,
            certyfikaty i powiązania kodów. Anonimowe odpowiedzi ankiety i
            dziennik działań pozostają. Notatki zgłoszeń wymagają sprawdzenia
            pod kątem danych osobowych.
          </p>
          <a href="/admin?section=settings">
            Przejdź do ustawień i usuwania danych
          </a>
        </>
      )}
    </section>
  );
}
export function HistoryPanel({ eventId }: { eventId: string }) {
  const search = useSearchParams();
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [target, setTarget] = useState(search.get("target") || ""),
    [rows, setRows] = useState<
      {
        id: string;
        action: string;
        createdAt: string;
        adminEmail: string | null;
        targetId: string | null;
      }[]
    >([]),
    [error, setError] = useState("");

  const params = new URLSearchParams({
    q,
    offset: String(offset),
    ...(target ? { target } : {}),
  }).toString();
  const base = `/api/admin/events/${eventId}/history?${params}`;
  useEffect(() => {
    let active = true;
    api<typeof rows>(base)
      .then((r) => {
        if (active) {
          setRows(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  return (
    <section className="card">
      <h2>Historia działań</h2>
      <label>
        Filtr operacji
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {target && (
        <button
          onClick={() => {
            setTarget("");
            setOffset(0);
          }}
        >
          Pokaż historię wszystkich uczestników
        </button>
      )}
      <p role="alert">{error}</p>
      <DownloadButton href={`${base}&format=csv`}>
        CSV bieżącej strony historii
      </DownloadButton>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Działanie</th>
              <th>Administrator</th>
              <th>Rekord</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.createdAt)}</td>
                <td>{r.action}</td>
                <td>{r.adminEmail || "System / uczestnik"}</td>
                <td>{r.targetId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Poprzednie
        </button>
        <span>Strona {offset / 100 + 1}</span>
        <button
          disabled={rows.length < 100}
          onClick={() => setOffset(offset + 100)}
        >
          Następne
        </button>
      </div>
    </section>
  );
}
export function TeamPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<
      { id: string; email: string; role: string }[]
    >([]),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/api/admin/events/${eventId}/team`;
  useEffect(() => {
    let active = true;
    api<typeof rows>(base)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, revision]);
  return (
    <section className="card">
      <h2>Zespół i uprawnienia</h2>
      <p>
        Administrator zarządza konferencją. Obsługa wejścia ma dostęp wyłącznie
        do skanowania i potwierdzania obecności. Kontroler danych może
        weryfikować dane i pobierać raporty, ale nie może ich zmieniać.
      </p>
      {rows.map((r) => (
        <p key={r.id}>
          {r.email} —{" "}
          {r.role === "ADMIN"
            ? "Administrator"
            : r.role === "CONTROLLER"
              ? "Kontroler danych"
              : "Obsługa wejścia"}{" "}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Odebrać dostęp do konferencji kontu ${r.email}?`,
                )
              )
                return;
              setBusy(true);
              try {
                await api(`${base}/${r.id}`, { method: "DELETE" });
                setRevision((v) => v + 1);
                setNotice("Dostęp odebrany.");
              } catch (e) {
                setNotice(e instanceof Error ? e.message : "Błąd.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Odbierz dostęp
          </button>
        </p>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = Object.fromEntries(new FormData(form));
          setBusy(true);
          try {
            await api(base, {
              method: "POST",
              body: JSON.stringify({ ...f, password: f.password || undefined }),
            });
            form.reset();
            setNotice(
              "Zapisano uprawnienia. Dotychczasowe sesje tego konta zostały zakończone.",
            );
            setRevision((v) => v + 1);
          } catch (e) {
            setNotice(e instanceof Error ? e.message : "Błąd.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          E-mail konta
          <input name="email" type="email" required />
        </label>
        <label>
          Rola
          <select name="role">
            <option value="CHECKIN">Obsługa wejścia</option>
            <option value="ADMIN">Administrator</option>
            <option value="CONTROLLER">
              Kontroler danych — podgląd i raporty
            </option>
          </select>
        </label>
        <label>
          Hasło tylko dla nowego konta
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={14}
            maxLength={200}
          />
        </label>
        <button disabled={busy}>Zapisz konto i rolę</button>
      </form>
      <p role="status">{notice}</p>
    </section>
  );
}
