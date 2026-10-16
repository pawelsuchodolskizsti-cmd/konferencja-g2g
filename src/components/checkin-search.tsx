"use client";
import { useState } from "react";
import { api, dateTime } from "./api";
export function CheckinSearch({ eventId }: { eventId: string }) {
  const [q, setQ] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [people, setPeople] = useState<
    {
      id: string;
      firstName: string;
      lastName: string;
      checkedInAt: string | null;
    }[]
  >([]);
  async function load() {
    setPeople(
      await api(
        `/api/admin/events/${eventId}/checkin-people?q=${encodeURIComponent(q)}`,
      ),
    );
  }
  return (
    <section className="card">
      <h2>Ręczna rejestracja</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice("");
          try {
            await load();
          } catch (e) {
            setNotice(e instanceof Error ? e.message : "Błąd.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Imię, nazwisko lub kod uczestnika
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <button disabled={busy}>Szukaj uczestnika</button>
      </form>
      <p role="status">{notice}</p>
      {people.map((p) => (
        <div className="card" key={p.id}>
          <strong>
            {p.firstName} {p.lastName}
          </strong>
          {p.checkedInAt ? (
            <p>Obecność potwierdzona: {dateTime(p.checkedInAt)}</p>
          ) : (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/api/admin/events/${eventId}/checkin`, {
                    method: "POST",
                    body: JSON.stringify({ participantId: p.id }),
                  });
                  await load();
                  setNotice("Obecność potwierdzona.");
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : "Błąd.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Potwierdź obecność
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
