"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  definitionFor,
  emptyAnswer,
  answerError,
  surveyIntro,
  surveyThanks,
  type SurveyAnswer,
} from "@/lib/survey-definition";
import styles from "@/app/ankieta/survey.module.css";
export function SurveyForm({
  questions,
  submitted,
  preview = false,
}: {
  questions: string[];
  submitted: boolean;
  preview?: boolean;
}) {
  const definitions = definitionFor(questions);
  const modern = questions.length === 11;
  const [done, setDone] = useState(submitted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [hotel, setHotel] = useState<"yes" | "no" | "">("");
  const [answers, setAnswers] = useState<SurveyAnswer[]>(() =>
    questions.map(emptyAnswer),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step > 0) heading.current?.focus();
  }, [step]);
  const hotelStep = modern && step === 9;
  const index = hotelStep ? (hotel === "no" ? 10 : 9) : step;
  const q = definitions[index];
  const a = answers[index];
  const total = modern ? 10 : questions.length;
  const update = (patch: Partial<SurveyAnswer>) => {
    setAnswers((old) =>
      old.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    );
    setError("");
  };
  const move = (next: number) => {
    setStep(next);
    setError("");
  };
  if (done)
    return (
      <div role="status">
        <h2>{surveyThanks}</h2>
        <p>
          {preview
            ? "Podgląd zakończony. Odpowiedzi nie zostały zapisane."
            : "Ankieta została zapisana."}
        </p>
        <Link
          className={styles.action}
          href={preview ? "/uczestnik/panel?podglad=1" : "/uczestnik/panel"}
        >
          Wróć do swojej strefy
        </Link>
      </div>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (hotelStep && !hotel) {
          setError("Wskaż, czy korzystałeś/aś z hotelu Presidential.");
          return;
        }
        const issue = answerError(q, a);
        if (issue) {
          setError(issue);
          return;
        }
        if (step < total - 1) {
          move(step + 1);
          return;
        }
        for (let i = 0; i < questions.length; i++) {
          if (
            modern &&
            ((i === 9 && hotel === "no") || (i === 10 && hotel === "yes"))
          )
            continue;
          const problem = answerError(definitions[i], answers[i]);
          if (problem) {
            setStep(Math.min(i, total - 1));
            setError(problem);
            return;
          }
        }
        if (preview) {
          setDone(true);
          return;
        }
        setBusy(true);
        setError("");
        try {
          await api("/api/participant/survey", {
            method: "POST",
            body: JSON.stringify({
              questions,
              answers: modern ? answers : answers.map((a) => a.text),
              ...(modern ? { hotel } : {}),
            }),
          });
          setDone(true);
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Nie udało się wysłać ankiety. Spróbuj ponownie.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>{surveyIntro}</p>
      <p>Ankieta jest imienna.</p>
      {preview && (
        <p role="status">Podgląd ankiety. Odpowiedzi nie są zapisywane.</p>
      )}
      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.legend}>Pytania konferencji</legend>
        <div className={styles.progressHeading} aria-live="polite">
          <span>
            Krok {step + 1} z {total}
          </span>
          <span>{Math.round((step / total) * 100)}%</span>
        </div>
        <progress
          className={styles.progress}
          value={step}
          max={total}
          aria-label="Postęp wypełniania ankiety"
        />
        {hotelStep && (
          <fieldset className={styles.choiceGroup}>
            <legend>
              Czy korzystałeś/aś z proponowanego hotelu Presidential?
            </legend>
            {(
              [
                ["yes", "Tak"],
                ["no", "Nie"],
              ] as const
            ).map(([value, label]) => (
              <label className={styles.option} key={value}>
                <input
                  type="radio"
                  name="hotel"
                  checked={hotel === value}
                  onChange={() => {
                    setHotel(value);
                    setAnswers((old) =>
                      old.map((a, i) => (i >= 9 ? emptyAnswer() : a)),
                    );
                    setError("");
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {(!hotelStep || hotel) && (
          <>
            <h2 className={styles.questionTitle} ref={heading} tabIndex={-1}>
              {modern ? index + 1 : step + 1}. {q.title}
            </h2>
            {q.hint && <p>{q.hint}</p>}
            {q.kind === "text" && (
              <label className={styles.question}>
                <span className={styles.legend}>Twoja odpowiedź</span>
                <textarea
                  value={a.text}
                  onChange={(e) => update({ text: e.target.value })}
                  maxLength={5000}
                  rows={5}
                  aria-label={q.title}
                />
              </label>
            )}
            {(q.kind === "single" || q.kind === "multiple") && (
              <fieldset className={styles.choiceGroup}>
                <legend>
                  {q.kind === "single"
                    ? "Wybierz jedną odpowiedź."
                    : "Wybierz maksymalnie dwie odpowiedzi."}
                </legend>
                {q.options!.map((option) => {
                  const checked = a.selected.includes(option);
                  return (
                    <label className={styles.option} key={option}>
                      <input
                        type={q.kind === "single" ? "radio" : "checkbox"}
                        name={`question-${index}`}
                        checked={checked}
                        onChange={() => {
                          let selected: string[];
                          if (q.kind === "single") selected = [option];
                          else if (checked)
                            selected = a.selected.filter((v) => v !== option);
                          else if (q.exclusive?.includes(option))
                            selected = [option];
                          else {
                            selected = [
                              ...a.selected.filter(
                                (v) => !q.exclusive?.includes(v),
                              ),
                              option,
                            ];
                            if (selected.length > 2) {
                              setError(
                                "Możesz wybrać maksymalnie dwie odpowiedzi. Odznacz jedną, aby zmienić wybór.",
                              );
                              return;
                            }
                          }
                          update({
                            selected,
                            ...(q.other && !selected.includes(q.other)
                              ? { text: "" }
                              : {}),
                          });
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {q.other && a.selected.includes(q.other) && (
              <label className={styles.question}>
                <span>Jaki inny obszar?</span>
                <textarea
                  value={a.text}
                  maxLength={5000}
                  rows={3}
                  onChange={(e) => update({ text: e.target.value })}
                />
              </label>
            )}
            {q.kind === "matrix" &&
              q.rows!.map((row, rowIndex) => (
                <fieldset className={styles.choiceGroup} key={row}>
                  <legend>{row}</legend>
                  {q.options!.map((option) => (
                    <label className={styles.option} key={option}>
                      <input
                        type="radio"
                        name={`rating-${rowIndex}`}
                        checked={a.ratings[rowIndex] === option}
                        onChange={() =>
                          update({
                            ratings: q.rows!.map((_, i) =>
                              i === rowIndex ? option : a.ratings[i] || "",
                            ),
                          })
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles.navigation}>
          {step > 0 && (
            <button
              className={`${styles.action} ${styles.back}`}
              type="button"
              onClick={() => move(step - 1)}
            >
              ← Wstecz
            </button>
          )}
          <button className={styles.action} type="submit">
            {busy
              ? "Wysyłanie..."
              : step < total - 1
                ? q.optional
                  ? "Dalej / pomiń →"
                  : "Dalej →"
                : "Wyślij odpowiedzi"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
