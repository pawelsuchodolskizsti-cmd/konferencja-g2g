"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "./api";
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
  const [done, setDone] = useState(submitted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const input = useRef<HTMLTextAreaElement>(null);
  const completed = answers.filter((answer) => answer.trim()).length;
  const move = (next: number) => {
    setStep(next);
    setError("");
    input.current?.focus();
  };
  if (done)
    return (
      <div role="status">
        <h2>Dziękujemy za Twoje odpowiedzi!</h2>
        <p>Ankieta została zapisana.</p>
        <Link className={styles.action} href="/uczestnik/panel">
          Wróć do swojej strefy
        </Link>
      </div>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!answers[step].trim()) {
          setError("Wpisz odpowiedź, aby przejść dalej.");
          input.current?.focus();
          return;
        }
        if (step < questions.length - 1) {
          move(step + 1);
          return;
        }
        const missing = answers.findIndex((answer) => !answer.trim());
        if (missing >= 0) {
          move(missing);
          return;
        }
        if (preview) {
          setError("To podgląd testowy. Odpowiedzi nie są zapisywane.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await api("/api/participant/survey", {
            method: "POST",
            body: JSON.stringify({
              questions,
              answers,
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
      <p>
        Twoje odpowiedzi pomogą nam przygotować kolejne spotkania. Ankieta jest
        imienna. Odpowiedz na wszystkie 10 pytań.
      </p>
      {preview && (
        <p role="status">
          Podgląd ankiety. Możesz sprawdzić formularz bez zapisywania
          odpowiedzi.
        </p>
      )}
      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.legend}>Pytania konferencji</legend>
        <div className={styles.progressHeading} aria-live="polite">
          <span>
            Pytanie {step + 1} z {questions.length}
          </span>
          <span>
            {completed} / {questions.length} odpowiedzi
          </span>
        </div>
        <progress
          className={styles.progress}
          value={completed}
          max={questions.length}
          aria-label="Postęp wypełniania ankiety"
        />
        <label className={styles.question}>
          <span>{questions[step]}</span>
          <textarea
            ref={input}
            name={`answer-${step}`}
            value={answers[step]}
            onChange={(event) => {
              const value = event.target.value;
              setAnswers((previous) =>
                previous.map((answer, index) =>
                  index === step ? value : answer,
                ),
              );
              setError("");
            }}
            required
            maxLength={5000}
            rows={5}
          />
        </label>
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
              : step < questions.length - 1
                ? "Dalej →"
                : "Wyślij odpowiedzi"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
