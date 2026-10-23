"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "./api";
type Records = {
  version: string;
  people: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    checkedInAt: string | null;
    firstAcknowledgedAt: string | null;
    lastAcknowledgedAt: string | null;
    count: number;
  }[];
};
export function AdminPrivacy({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Records | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api<Records>(
          `/api/admin/events/${eventId}/privacy`,
        );
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Nie udało się pobrać potwierdzeń.",
          );
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [eventId]);
  const people = data?.people ?? [];
  const filtered = people.filter(
    (p) =>
      `${p.firstName} ${p.lastName} ${p.email}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "confirmed" && p.count > 0) ||
        (filter === "missing" && p.count === 0) ||
        (filter === "present-missing" && p.checkedInAt && p.count === 0)),
  );
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1),
  );
  return (
    <section className="card">
      <h2>Potwierdzenia zapoznania się z klauzulą</h2>
      <p>
        Zapisy dotyczą potwierdzenia informacji RODO, a nie zgody na
        przetwarzanie ani odpowiedzi ankietowych.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Ładowanie potwierdzeń...</p>
      ) : (
        <>
          <p>
            Wersja klauzuli: <strong>{data.version}</strong>. Potwierdziło:{" "}
            <strong>{people.filter((p) => p.count > 0).length}</strong> z{" "}
            {people.length} uczestników. Obecni bez potwierdzenia:{" "}
            <strong>
              {people.filter((p) => p.checkedInAt && !p.count).length}
            </strong>
            .
          </p>
          <p className="muted">
            W tabeli pokazujemy pierwsze i ostatnie potwierdzenie aktualnej
            wersji. Eksport obejmuje uczestników z aktualnej listy i każde ich
            zapisane potwierdzenie, również starszych wersji. Brak wpisu oznacza
            brak zarejestrowanego potwierdzenia, nie odmowę.
          </p>
          <div className="actions">
            <a
              href="/uczestnik/klauzula"
              target="_blank"
              rel="noopener noreferrer"
              className="button secondary"
            >
              Otwórz klauzulę
            </a>
            <a
              href={`/api/admin/events/${eventId}/privacy-export`}
              className="button secondary"
              download
            >
              Pobierz historię potwierdzeń CSV
            </a>
          </div>
          <div className="row" style={{ marginBlock: 20 }}>
            <input
              aria-label="Szukaj w potwierdzeniach"
              placeholder="Imię, nazwisko lub e-mail"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="Status potwierdzenia"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">Wszyscy</option>
              <option value="confirmed">Potwierdzili</option>
              <option value="missing">Bez potwierdzenia</option>
              <option value="present-missing">Obecni bez potwierdzenia</option>
            </select>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Uczestnik</th>
                  <th>Obecność</th>
                  <th>Pierwsze potwierdzenie</th>
                  <th>Ostatnie potwierdzenie</th>
                  <th>Liczba potwierdzeń</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(current * 25, current * 25 + 25).map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.firstName} {p.lastName}
                      <br />
                      <small>{p.email}</small>
                    </td>
                    <td>{p.checkedInAt ? "Obecny" : "Nieobecny"}</td>
                    <td>{dateTime(p.firstAcknowledgedAt)}</td>
                    <td>{dateTime(p.lastAcknowledgedAt)}</td>
                    <td>{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p>Brak uczestników spełniających wybrane warunki.</p>
          )}
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Poprzednia
            </button>
            <span>
              Strona {current + 1} z{" "}
              {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              disabled={(current + 1) * 25 >= filtered.length}
              onClick={() => setPage(current + 1)}
            >
              Następna
            </button>
          </div>
        </>
      )}
    </section>
  );
}
