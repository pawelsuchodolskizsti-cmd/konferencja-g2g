"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "./api";
type Survey = {
  questions: string[];
  published: boolean;
  responseCount: number;
  unlockAt: string;
};
export function AdminSurvey({ eventId }: { eventId: string }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const load = () =>
      api<Survey>(`/api/admin/events/${eventId}/survey`)
        .then((value) => {
          if (current)
            setSurvey((old) =>
              old ? { ...old, responseCount: value.responseCount } : value,
            );
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [eventId]);
  if (!survey) return <p role="status">{error || "Ładowanie ankiety..."}</p>;
  return (
    <section className="card">
      <h2>Ankieta konferencji</h2>
      <p>
        10 pytań otwartych. Link w profilu uczestnika pojawi się{" "}
        {dateTime(survey.unlockAt)} po udostępnieniu ankiety.
      </p>
      <p>
        Otrzymane ankiety: <strong>{survey.responseCount}</strong>
      </p>
      <p>
        Odpowiedzi są przypisane do uczestników. Każdy obecny uczestnik może
        wysłać ankietę jeden raz.
      </p>
      <a
        className="button secondary"
        href={`/api/admin/events/${eventId}/survey-export`}
        download
      >
        Pobierz odpowiedzi Excel
      </a>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            await api(`/api/admin/events/${eventId}/survey`, {
              method: "POST",
              body: JSON.stringify({
                questions: survey.questions,
                published: survey.published,
              }),
            });
            setNotice("Ustawienia ankiety zostały zapisane.");
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Nie udało się zapisać ankiety.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, marginTop: 24 }}
        >
          <legend>Pytania ankiety</legend>
          {survey.responseCount > 0 && (
            <p className="muted">
              Pytania są zablokowane, ponieważ uczestnicy przesłali już
              odpowiedzi.
            </p>
          )}
          {survey.questions.map((question, index) => (
            <label key={index}>
              Pytanie {index + 1}
              <textarea
                value={question}
                required
                maxLength={500}
                rows={2}
                disabled={survey.responseCount > 0}
                onChange={(e) =>
                  setSurvey({
                    ...survey,
                    questions: survey.questions.map((q, i) =>
                      i === index ? e.target.value : q,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={survey.published}
              onChange={(e) =>
                setSurvey({ ...survey, published: e.target.checked })
              }
            />{" "}
            Udostępnij ankietę uczestnikom od 17:00
          </label>
          <button type="submit">
            {busy ? "Zapisywanie..." : "Zapisz ankietę"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

