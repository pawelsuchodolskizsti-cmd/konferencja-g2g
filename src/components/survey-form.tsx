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
  const modern = questions.length === 9;
  const [done, setDone] = useState(submitted);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswer[]>(() =>
    questions.map(emptyAnswer),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (started) {
      heading.current?.focus({ preventScroll: true });
      form.current?.scrollIntoView({ block: "start" });
    }
  }, [step, started]);
  const index = step;
  const q = definitions[index];
  const a = answers[index];
  const total = questions.length;
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
        <h1>Głowa do Góry - ankieta</h1>
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
  if (!started)
    return (
      <div>
        <h1>Głowa do Góry - ankieta</h1>
        <div className={styles.introCard}>
          <p>{surveyIntro}</p>
          {preview && (
            <p role="status">Podgląd ankiety. Odpowiedzi nie są zapisywane.</p>
          )}
          <button
            type="button"
            className={`${styles.action} ${styles.introAction}`}
            onClick={() => setStarted(true)}
          >
            Start →
          </button>
        </div>
      </div>
    );
  return (
    <form
      ref={form}
      onSubmit={async (e) => {
        e.preventDefault();
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
      <h1 className={styles.legend}>Głowa do Góry - ankieta</h1>
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
        {
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
            {q.kind === "matrix" && (
              <div className={styles.ratings}>
                <p>Przesuń suwak lub kliknij ocenę od 1 do 5.</p>
                {q.rows!.map((row, rowIndex) => {
                  const rating = a.ratings[rowIndex] || "";
                  const options = q.options!.slice(0, 5);
                  const notApplicable = q.options![5];
                  const selected = options.indexOf(rating);
                  const value = selected >= 0 ? selected + 1 : 3;
                  const setRating = (option: string) =>
                    update({
                      ratings: q.rows!.map((_, i) =>
                        i === rowIndex ? option : a.ratings[i] || "",
                      ),
                    });
                  const labelId = `rating-label-${rowIndex}`;
                  const statusId = `rating-status-${rowIndex}`;
                  return (
                    <div className={styles.ratingCard} key={row}>
                      <label
                        id={labelId}
                        htmlFor={`rating-${rowIndex}`}
                        className={styles.ratingLabel}
                      >
                        {row}
                      </label>
                      <div className={styles.ratingControls}>
                        <output
                          id={statusId}
                          className={styles.ratingValue}
                          htmlFor={`rating-${rowIndex}`}
                          aria-live="polite"
                        >
                          {rating || "Wybierz ocenę"}
                        </output>
                        <input
                          id={`rating-${rowIndex}`}
                          className={styles.ratingSlider}
                          type="range"
                          min={1}
                          max={5}
                          step={1}
                          value={value}
                          aria-labelledby={labelId}
                          aria-describedby={statusId}
                          aria-valuetext={rating || "Nie wybrano oceny"}
                          onChange={(e) =>
                            setRating(options[Number(e.target.value) - 1])
                          }
                          onPointerUp={(e) =>
                            setRating(
                              options[Number(e.currentTarget.value) - 1],
                            )
                          }
                        />
                        <div
                          className={styles.ratingScale}
                          role="group"
                          aria-label={`Ocena: ${row}`}
                        >
                          {options.map((option, i) => (
                            <button
                              key={option}
                              type="button"
                              aria-label={option}
                              aria-pressed={rating === option}
                              onClick={() => setRating(option)}
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                        <label className={styles.ratingSkip}>
                          <input
                            type="checkbox"
                            checked={rating === notApplicable}
                            onChange={(e) =>
                              setRating(e.target.checked ? notApplicable : "")
                            }
                          />
                          {notApplicable}
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        }
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
