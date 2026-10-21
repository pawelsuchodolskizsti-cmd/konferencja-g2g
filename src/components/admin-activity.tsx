"use client";
import { useState } from "react";
import { dateTime, type Person } from "./api";

export function ActivityPanel({ people }: { people: Person[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const activated = people.filter((p) => p.firstLoginAt).length;
  const sent = people.filter((p) => p.emailSentAt);
  const activatedSent = sent.filter((p) => p.firstLoginAt).length;
  const percent = (count: number, total: number) =>
    total ? Math.round((count * 100) / total) + "%" : "Brak danych";
  const visible = people.filter(
    (p) =>
      (status === "all" ||
        (status === "active" ? !!p.firstLoginAt : !p.firstLoginAt)) &&
      `${p.firstName} ${p.lastName} ${p.email}`
        .toLocaleLowerCase("pl")
        .includes(query.trim().toLocaleLowerCase("pl")),
  );
  if (status === "active") {
    visible.sort(
      (a, b) =>
        (Date.parse(b.firstLoginAt || "") || 0) -
        (Date.parse(a.firstLoginAt || "") || 0),
    );
  }
  return (
    <section className="card">
      <h2>Aktywność uczestników</h2>
      <p>
        Konto aktywowane oznacza co najmniej jedno poprawne logowanie do panelu
        uczestnika. Nie jest to potwierdzenie obecności na konferencji ani
        odczytania maila.
      </p>
      <div className="stats">
        <div className="stat">
          <strong>{people.length}</strong>
          <span>Wszyscy uczestnicy</span>
        </div>
        <div className="stat">
          <strong>
            {activated} ({percent(activated, people.length)})
          </strong>
          <span>Aktywowane konta</span>
        </div>
        <div className="stat">
          <strong>{people.length - activated}</strong>
          <span>Jeszcze niezalogowani</span>
        </div>
      </div>
      <p>
        Wśród uczestników z zapisaną wysyłką zaproszenia:{" "}
        <strong>
          {activatedSent} z {sent.length} ({percent(activatedSent, sent.length)}
          )
        </strong>{" "}
        weszło do panelu. Wysyłka oznacza przyjęcie przez serwer pocztowy, nie
        potwierdzenie doręczenia. Dane odświeżają się automatycznie co 15
        sekund.
      </p>
      <div className="form-grid">
        <label>
          Szukaj uczestnika
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Imię, nazwisko lub e-mail"
          />
        </label>
        <label>
          Status konta
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Wszyscy</option>
            <option value="active">Aktywowane</option>
            <option value="inactive">Jeszcze niezalogowani</option>
          </select>
        </label>
      </div>
      <p role="status">
        Wyświetlono: {visible.length} z {people.length}
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Uczestnik</th>
              <th scope="col">E-mail</th>
              <th scope="col">Status konta</th>
              <th scope="col">Pierwsze logowanie</th>
              <th scope="col">Ostatnie logowanie</th>
              <th scope="col">Wysyłka zaproszenia</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.firstName} {p.lastName}
                </td>
                <td>{p.email}</td>
                <td>
                  {p.firstLoginAt ? "Aktywowane" : "Jeszcze niezalogowany"}
                </td>
                <td>{dateTime(p.firstLoginAt || null)}</td>
                <td>{dateTime(p.lastLoginAt || null)}</td>
                <td>
                  {p.emailSentAt
                    ? dateTime(p.emailSentAt)
                    : "Brak zapisanej wysyłki"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <p>Brak uczestników spełniających wybrane kryteria.</p>
      )}
    </section>
  );
}
