"use client";
import { DataPanel } from "./data-panel";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, dateTime, type Overview } from "./api";
import { DownloadButton, ExportCenter, HistoryPanel } from "./admin-tools";
import { certificateName } from "@/lib/certificate-name";
import { filterParticipants } from "@/lib/participant-filter";
import "./admin-theme.css";

type Privacy = {
  version: string;
  people: {
    id: string;
    firstName: string;
    lastName: string;
    acknowledgedAt: string | null;
  }[];
  requests: {
    id: string;
    participantId: string | null;
    kind: string;
    status: string;
    note: string;
    createdAt: string;
  }[];
};
export function DataController({
  eventId,
  email,
}: {
  eventId: string;
  email: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [data, setData] = useState<Overview | null>(null),
    [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [section, setSection] = useState("people"),
    [q, setQ] = useState(""),
    [error, setError] = useState("");
  const base = `/api/admin/events/${eventId}`;
  useEffect(() => {
    let active = true;
    Promise.all([api<Overview>(base), api<Privacy>(`${base}/privacy`)])
      .then(([d, p]) => {
        if (active) {
          setData(d);
          setPrivacy(p);
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
    <div className="shell admin-theme">
      <aside className="sidebar">
        <div className="admin-brand-row">
          <div className="brand">GŁOWA DO GÓRY</div>
          <button
            className="admin-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="controller-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            Menu
          </button>
        </div>
        <nav
          id="controller-navigation"
          className={menuOpen ? "is-open" : ""}
          aria-label="Panel kontrolera danych"
        >
          {[
            ["people", "Weryfikacja uczestników"],
            ["reports", "Raporty i eksporty"],
            ["data", "Dane — archiwa"],
            ["privacy", "RODO — podgląd"],
            ["resources", "Konferencja i materiały"],
            ["history", "Historia działań"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className={section === id ? "active" : ""}
              onClick={() => {
                setSection(id);
                setMenuOpen(false);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>Kontroler danych · tylko odczyt</div>
          <div>{email}</div>
          <button
            onClick={async () => {
              try {
                await api("/api/auth/logout-admin", { method: "POST" });
                router.push("/admin/login");
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Błąd wylogowania.");
              }
            }}
          >
            Wyloguj
          </button>
        </header>
        <div className="content">
          <h1>Weryfikacja danych</h1>
          <p>
            Możesz przeglądać dane i pobierać raporty. Edycja, potwierdzanie
            obecności i generowanie certyfikatów są niedostępne dla tej roli.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <p>Ładowanie danych…</p>}
          {data && (
            <>
              {section === "data" && <DataPanel eventId={eventId} readOnly />}
              {section === "people" && (
                <section className="card">
                  <h2>Uczestnicy</h2>
                  <label>
                    Szukaj po nazwisku, e-mailu lub kodzie
                    <input value={q} onChange={(e) => setQ(e.target.value)} />
                  </label>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Uczestnik</th>
                          <th>E-mail / kod</th>
                          <th>Obecność</th>
                          <th>Certyfikat — weryfikacja</th>
                          <th>Dane osoby</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterParticipants(data.people, { q }).map((p) => (
                          <tr key={p.id}>
                            <td>
                              {p.firstName} {p.lastName}
                            </td>
                            <td>
                              {p.email}
                              <br />
                              {p.accessCode}
                            </td>
                            <td>
                              {p.checkedInAt
                                ? dateTime(p.checkedInAt)
                                : "Nieobecny"}
                              <br />
                              {p.method}
                            </td>
                            <td>
                              dla {certificateName(p).value}
                              <br />
                              {certificateName(p).needsReview
                                ? "Odmiana do sprawdzenia"
                                : "Odmiana ustalona"}
                              <br />
                              {p.certificateGeneratedAt
                                ? `Wygenerowany: ${dateTime(p.certificateGeneratedAt)}`
                                : "Nie wygenerowano"}
                            </td>
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
                </section>
              )}
              {section === "reports" && (
                <ExportCenter eventId={eventId} people={data.people} />
              )}
              {section === "history" && <HistoryPanel eventId={eventId} />}
              {section === "privacy" && privacy && (
                <section className="card">
                  <h2>RODO — tylko podgląd</h2>
                  <p>
                    Wersja klauzuli: {privacy.version}. Termin przechowywania:{" "}
                    {dateTime(data.event.retentionUntil)}.
                  </p>
                  <DownloadButton href={`${base}/reports?kind=privacy`}>
                    Potwierdzenia klauzuli CSV
                  </DownloadButton>
                  <table>
                    <thead>
                      <tr>
                        <th>Osoba</th>
                        <th>Zapoznanie z klauzulą</th>
                      </tr>
                    </thead>
                    <tbody>
                      {privacy.people.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.firstName} {p.lastName}
                          </td>
                          <td>{dateTime(p.acknowledgedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3>Zgłoszenia dotyczące danych</h3>
                  {privacy.requests.length ? (
                    privacy.requests.map((r) => (
                      <div className="card" key={r.id}>
                        <strong>
                          {{
                            ACCESS: "Dostęp",
                            CORRECTION: "Sprostowanie",
                            DELETION: "Usunięcie",
                            OTHER: "Inne",
                          }[r.kind] || r.kind}{" "}
                          · {r.status === "DONE" ? "Zamknięte" : "Otwarte"}
                        </strong>
                        <p>
                          {data.people.find((p) => p.id === r.participantId)
                            ?.email || "Bez powiązanej osoby"}{" "}
                          · {dateTime(r.createdAt)}
                        </p>
                        <p>{r.note}</p>
                      </div>
                    ))
                  ) : (
                    <p>Brak zgłoszeń.</p>
                  )}
                </section>
              )}
              {section === "resources" && (
                <section className="card">
                  <h2>{data.event.name}</h2>
                  <p>{data.event.location}</p>
                  <p>
                    {dateTime(data.event.startsAt)} –{" "}
                    {dateTime(data.event.endsAt)}
                  </p>
                  <p>
                    Certyfikaty od: {dateTime(data.event.certificateUnlockAt)}
                  </p>
                  <h3>Materiały</h3>
                  {data.materials.map((m) => (
                    <p key={m.id}>
                      {m.title} · {m.published ? "Opublikowany" : "Ukryty"}{" "}
                      <DownloadButton href={`${base}/materials/${m.id}`}>
                        Pobierz PDF
                      </DownloadButton>
                    </p>
                  ))}
                  <h3>Szkolenia</h3>
                  {data.courses.map((c) => (
                    <p key={c.id}>
                      {c.name} · {c.platform} · Przydzielone: {c.assigned} /{" "}
                      {c.total}
                    </p>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
