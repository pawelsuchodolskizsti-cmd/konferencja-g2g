"use client";
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
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      api<Survey>(`/api/admin/events/${eventId}/survey`)
        .then((value) => {
          if (current) {
            setSurvey(value);
            setError("");
          }
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
        11 pytań w bazie, 10 kroków dla uczestnika. Pytania hotelowe wyświetlają
        się zależnie od korzystania z noclegu.
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
                published: published ?? survey.published,
              }),
            });
            setSurvey({ ...survey, published: published ?? survey.published });
            setPublished(null);
            setNotice("Dostępność ankiety została zapisana.");
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
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0",
            }}
          >
            <input
              type="checkbox"
              style={{
                width: 20,
                height: 20,
                minHeight: 20,
                flexShrink: 0,
                margin: 0,
              }}
              checked={published ?? survey.published}
              onChange={(e) => setPublished(e.target.checked)}
            />{" "}
            Udostępnij ankietę od {dateTime(survey.unlockAt)}
          </label>
          <button type="submit">
            {busy ? "Zapisywanie..." : "Zapisz dostępność"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
