"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "./api";
import styles from "@/app/ankieta/survey.module.css";
export function SurveyForm({
  questions,
  submitted,
}: {
  questions: string[];
  submitted: boolean;
}) {
  const [done, setDone] = useState(submitted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await api("/api/participant/survey", {
            method: "POST",
            body: JSON.stringify({
              questions,
              answers: questions.map((_, i) => form.get(`answer-${i}`)),
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
      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.legend}>Pytania konferencji</legend>
        {questions.map((question, index) => (
          <label className={styles.question} key={index}>
            <span>
              {index + 1}. {question}
            </span>
            <textarea
              name={`answer-${index}`}
              required
              maxLength={5000}
              rows={4}
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <button className={styles.action} type="submit">
          {busy ? "Wysyłanie..." : "Wyślij odpowiedzi"}
        </button>
      </fieldset>
    </form>
  );
}
