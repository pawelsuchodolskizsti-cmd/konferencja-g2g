"use client";
import { useState } from "react";
import { api, type EventData } from "./api";
function localDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function EventForm({
  event,
  onSaved,
}: {
  event?: EventData;
  onSaved: (id: string) => void;
}) {
  const [agenda, setAgenda] = useState(event?.agenda || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(e.currentTarget);
        const data = {
          ...Object.fromEntries(form),
          mailFrom: event?.mailFrom || "konferencja@oneday.com.pl",
          mailSubject: event?.mailSubject || "Zaproszenie",
          mailBody: event?.mailBody || "Zaproszenie na konferencję",
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          certificateUnlockAt: new Date(
            String(form.get("certificateUnlockAt")),
          ).toISOString(),
          retentionUntil: form.get("retentionUntil")
            ? new Date(String(form.get("retentionUntil"))).toISOString()
            : null,
          published: form.get("published") === "on",
          agenda,
        };
        try {
          const saved = await api<EventData>(
            event ? `/api/admin/events/${event.id}` : "/api/admin/events/setup",
            { method: event ? "PATCH" : "POST", body: JSON.stringify(data) },
          );
          onSaved(saved.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Błąd zapisu.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Ustawienia konferencji</h2>
      <div className="formgrid">
        <input type="hidden" name="name" value="Głowa do Góry" />
        <input
          type="hidden"
          name="slug"
          value={event?.slug || "glowa-do-gory"}
        />
        {!event && (
          <p className="muted wide">
            Uzupełnij dane konferencji Głowa do Góry. Panel obsługuje wyłącznie
            ten projekt.
          </p>
        )}
        <label>
          Organizator
          <input name="organizer" required defaultValue={event?.organizer} />
        </label>
        <label>
          Miejsce
          <input name="location" required defaultValue={event?.location} />
        </label>
        <label>
          Początek
          <input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={localDate(event?.startsAt)}
          />
        </label>
        <label>
          Koniec
          <input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={localDate(event?.endsAt)}
          />
        </label>
        <label>
          Odblokowanie certyfikatów
          <input
            name="certificateUnlockAt"
            type="datetime-local"
            required
            defaultValue={localDate(event?.certificateUnlockAt)}
          />
        </label>
        <label>
          Strefa czasowa wydarzenia
          <select
            name="timezone"
            defaultValue={event?.timezone || "Europe/Warsaw"}
          >
            <option>Europe/Warsaw</option>
            <option>Europe/London</option>
            <option>UTC</option>
          </select>
        </label>
        <p className="muted wide">
          Daty w formularzu podawaj w strefie czasowej swojego urządzenia.
          Program będzie wyświetlany w strefie wydarzenia.
        </p>
        <label>
          Przechowuj dane do
          <input
            name="retentionUntil"
            type="datetime-local"
            defaultValue={localDate(event?.retentionUntil || undefined)}
          />
        </label>
        <label className="wide">
          Informacje organizacyjne
          <textarea name="info" defaultValue={event?.info} />
        </label>
      </div>
      <h2>Program</h2>
      {agenda.map((item, index) => (
        <div className="card" key={index}>
          <div className="formgrid">
            {(["start", "end", "title", "speaker"] as const).map((key) => (
              <label key={key}>
                {
                  {
                    start: "Od",
                    end: "Do",
                    title: "Temat / panel",
                    speaker: "Prowadzący / prelegent",
                  }[key]
                }
                <input
                  type={key === "start" || key === "end" ? "time" : "text"}
                  required={key !== "speaker"}
                  value={item[key]}
                  onChange={(e) =>
                    setAgenda(
                      agenda.map((old, i) =>
                        i === index ? { ...old, [key]: e.target.value } : old,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => setAgenda(agenda.filter((_, i) => i !== index))}
          >
            Usuń punkt programu
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          setAgenda([
            ...agenda,
            { start: "09:00", end: "10:00", title: "", speaker: "" },
          ])
        }
      >
        Dodaj punkt programu
      </button>
      <label className="row">
        <input
          name="published"
          type="checkbox"
          style={{ width: 20, minHeight: 20, margin: 0 }}
          defaultChecked={event?.published}
        />{" "}
        Opublikuj program wydarzenia
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button disabled={busy}>
        {busy ? "Zapisywanie…" : "Zapisz ustawienia"}
      </button>
    </form>
  );
}
