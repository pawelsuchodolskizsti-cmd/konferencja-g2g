"use client";
import { SurveyForm } from "./survey-form";
import { DownloadButton } from "./admin-tools";
import { useEffect, useState } from "react";
import { api, dateTime } from "./api";
import { definitionFor } from "@/lib/survey-definition";
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
  const [preview, setPreview] = useState(false);
  const [summary, setSummary] = useState<{
    count: number;
    questions: { title: string; kind: string; values: [string, number][] }[];
  } | null>(null);
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
        {survey.questions.length} pytań. Link w profilu uczestnika pojawi się{" "}
        {dateTime(survey.unlockAt)} po udostępnieniu ankiety.
      </p>
      <p>
        Otrzymane ankiety: <strong>{survey.responseCount}</strong>
      </p>
      <p>
        Ankieta jest anonimowa. Eksport zawiera wyłącznie odpowiedzi. Każdy
        obecny uczestnik może wysłać ankietę jeden raz.
      </p>
      <a
        className="button secondary"
        href={`/api/admin/events/${eventId}/survey-export`}
        download
      >
        Pobierz odpowiedzi Excel
      </a>
      <p>
        <DownloadButton
          href={`/api/admin/events/${eventId}/survey-export?format=csv`}
        >
          Pobierz odpowiedzi CSV
        </DownloadButton>
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Zamknij podgląd" : "Podgląd ankiety"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              setSummary(
                await api(`/api/admin/events/${eventId}/survey-summary`),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "Błąd wyników.");
            }
          }}
        >
          Pokaż podsumowanie wyników
        </button>
      </div>
      {preview && (
        <section className="card">
          <p>Podgląd testowy — odpowiedzi nie są zapisywane.</p>
          <SurveyForm
            key={JSON.stringify(survey.questions)}
            questions={survey.questions}
            submitted={false}
            preview
          />
        </section>
      )}
      {summary && (
        <section className="card">
          <h3>Podsumowanie: {summary.count} ankiet</h3>
          {summary.questions.map((q, i) => (
            <details key={i}>
              <summary>
                {i + 1}. {q.title}
              </summary>
              {q.values.map(([value, count]) => (
                <p key={value}>
                  {value} — <strong>{count}</strong>
                </p>
              ))}
            </details>
          ))}
        </section>
      )}
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
          <legend>Dostępność ankiety</legend>
          <p>
            Status:{" "}
            <strong>
              {survey.published
                ? "Udostępniona od wskazanej godziny"
                : "Wstrzymana"}
            </strong>
          </p>
          <p>
            Treść ankiety jest zatwierdzona. Pytania i warianty odpowiedzi są
            tylko do odczytu.
          </p>
          <details>
            <summary>Podgląd pytań i odpowiedzi</summary>
            <ol>
              {definitionFor(survey.questions).map((question, index) => (
                <li key={index} style={{ marginBottom: 20 }}>
                  <strong>{survey.questions[index]}</strong>
                  {question.hint && <p>{question.hint}</p>}
                  {question.rows && (
                    <ul>
                      {question.rows.map((row) => (
                        <li key={row}>{row}</li>
                      ))}
                    </ul>
                  )}
                  {question.options && (
                    <ul>
                      {question.options.map((option) => (
                        <li key={option}>{option}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </details>
          <label>
            <input
              type="checkbox"
              checked={survey.published}
              onChange={(e) =>
                setSurvey({ ...survey, published: e.target.checked })
              }
            />{" "}
            Udostępnij ankietę uczestnikom od {dateTime(survey.unlockAt)}
          </label>
          <button type="submit">
            {busy ? "Zapisywanie..." : "Zapisz ankietę"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
