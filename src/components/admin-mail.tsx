"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Overview, type Person } from "./api";

type Status = {
  host: string;
  port: number;
  username: string;
  passwordSaved: boolean;
  productionReady: boolean;
  senderValid: boolean;
  total: number;
  uniqueEmails: number;
  duplicateEmailAddresses: number;
  duplicateRecipients: number;
  queued: number;
  sending: number;
  sent: number;
  diagnostics: {
    participantId: string;
    email: string;
    status: string;
    errorCode: string | null;
    messageId: string | null;
    sentAt: string | null;
    attemptedAt: string | null;
  }[];
  errors: number;
  notQueued: number;
  subject: string;
  body: string;
};
const deliveryLabels: Record<string, string> = {
  SENT: "Przyjęta przez home.pl",
  QUEUED: "W kolejce",
  SENDING: "W trakcie",
  ERROR: "Wymaga sprawdzenia",
};
type Batch = {
  sent: number;
  errors: number;
  retryAfterMs?: number;
  stopped?: boolean;
};

export function AdminMail({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testParticipant, setTestParticipant] = useState("");
  const [testPeople, setTestPeople] = useState<Person[]>([]);
  useEffect(() => {
    let current = true;
    api<Overview>(`/api/admin/events/${eventId}`)
      .then((data) => {
        if (current) setTestPeople(data.people);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [eventId]);
  const testRequestId = useRef<string | null>(null);
  const [testResult, setTestResult] = useState("");
  const [testPending, setTestPending] = useState(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const active = useRef(true);
  const base = `/api/admin/events/${eventId}`;
  const load = useCallback(async () => {
    const data = await api<Status>(`${base}/smtp`);
    if (active.current) setStatus(data);
    return data;
  }, [base]);
  useEffect(() => {
    active.current = true;
    api<Status>(`${base}/smtp`)
      .then((data) => {
        if (!active.current) return;
        setStatus(data);
        setSubject(data.subject);
        setBody(data.body);
      })
      .catch((e) => {
        if (active.current) setError(e.message);
      });
    return () => {
      active.current = false;
    };
  }, [base]);
  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`${base}/smtp`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      await load();
      setNotice(
        "Hasło zapisane w postaci zaszyfrowanej. Nie wysłano żadnych wiadomości.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie zapisano hasła.");
    } finally {
      setBusy(false);
    }
  }
  async function saveTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`${base}/smtp-template`, {
        method: "POST",
        body: JSON.stringify({ subject, body }),
      });
      await load();
      setNotice("Zapisano szablon. Nie wysłano żadnych wiadomości.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie zapisano szablonu.");
    } finally {
      setBusy(false);
    }
  }
  async function startSending() {
    if (
      !status ||
      !status.passwordSaved ||
      !status.productionReady ||
      !status.senderValid
    )
      return;
    const remaining = status.total - status.sent - status.errors;
    if (
      !window.confirm(
        `Rozpocząć rzeczywistą wysyłkę do uczestników?\nPozostało maksymalnie ${remaining} wiadomości.\n` +
          `${status.duplicateRecipients} odbiorców korzysta z adresu występującego więcej niż raz.\n` +
          "Każdy rekord uczestnika otrzyma osobną wiadomość i indywidualny kod.",
      )
    )
      return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ queued: number }>(`${base}/smtp-queue`, {
        method: "POST",
        body: "{}",
      });
      setNotice(
        `Przygotowano ${result.queued} nowych wiadomości. Rozpoczynam wysyłkę.`,
      );
      let lastStatus = await load();
      while (active.current && lastStatus.queued > 0) {
        const batch = await api<Batch>(`${base}/smtp-process`, {
          method: "POST",
          body: "{}",
        });
        lastStatus = await load();
        if (
          batch.stopped ||
          (batch.errors > 0 && batch.stopped === undefined)
        ) {
          setError(
            "Wystąpił błąd SMTP. Wysyłka została zatrzymana; sprawdź dane skrzynki i statusy.",
          );
          break;
        }
        if (active.current && lastStatus.queued > 0 && batch.retryAfterMs) {
          setNotice(
            `Wysyłka trwa. Przyjęte przez home.pl: ${lastStatus.sent}. W kolejce: ${lastStatus.queued}. Odstępy między wiadomościami ograniczają nagłe serie wysyłek.`,
          );
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(30000, Math.max(1000, batch.retryAfterMs!)),
            ),
          );
          continue;
        }
        if (batch.sent === 0 && batch.errors === 0) break;
      }
      if (
        active.current &&
        lastStatus.queued === 0 &&
        lastStatus.sending === 0 &&
        lastStatus.notQueued === 0 &&
        lastStatus.errors === 0
      ) {
        setNotice(
          "Wszystkie wiadomości zostały przyjęte przez home.pl. Doręczenie do skrzynek odbiorców nie jest potwierdzone.",
        );
      } else if (
        active.current &&
        lastStatus.queued === 0 &&
        lastStatus.sending === 0 &&
        lastStatus.errors > 0
      ) {
        setNotice(
          `Zakończono kolejkę. Przyjęte przez home.pl: ${lastStatus.sent}. Wymaga sprawdzenia: ${lastStatus.errors}. Rozwiń diagnostykę wiadomości poniżej.`,
        );
      } else if (
        active.current &&
        lastStatus.queued > 0 &&
        lastStatus.errors === 0
      ) {
        setNotice("Wysyłka wstrzymana. Możesz ją wznowić przyciskiem poniżej.");
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Błąd wysyłki.");
    } finally {
      if (active.current) setSending(false);
    }
  }
  if (!status)
    return (
      <section className="card">
        <p>{error || "Wczytywanie danych wysyłki…"}</p>
      </section>
    );
  const ready =
    status.passwordSaved && status.productionReady && status.senderValid;
  return (
    <>
      <section className="card">
        <div className="eyebrow">Skrzynka nadawcza</div>
        <h2>Konfiguracja wysyłki SMTP</h2>
        <p className="muted">
          Po zapisaniu hasła poczta nie zostanie wysłana automatycznie. Wysyłkę
          uruchamiasz osobnym przyciskiem.
        </p>
        <p className="muted">
          Zaproszenia wysyłamy z odstępem co najmniej 3 sekund, a na ten sam
          adres co najmniej 30 sekund. Zostaw tę kartę otwartą do zakończenia
          wysyłki. Przyjęcie przez home.pl nie potwierdza doręczenia ani
          umieszczenia w skrzynce odbiorczej.
        </p>
        <div className="formgrid">
          <div>
            <strong>Adres i login</strong>
            <p>{status.username}</p>
          </div>
          <div>
            <strong>Serwer</strong>
            <p>
              {status.host} · port {status.port} · SSL/TLS
            </p>
          </div>
        </div>
        <p
          role="status"
          className={status.passwordSaved ? "badge good" : "badge bad"}
        >
          {status.passwordSaved
            ? "Hasło zapisane (zaszyfrowane)"
            : "Oczekuje na hasło"}
        </p>
        <form onSubmit={savePassword}>
          <label>
            {status.passwordSaved
              ? "Zmień hasło do skrzynki"
              : "Hasło do skrzynki e-mail"}
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={512}
              required
              placeholder="Wpisz hasło dopiero, gdy będziesz gotowy"
            />
          </label>
          <div className="actions">
            <button disabled={busy || sending || !password}>
              {busy ? "Zapisywanie…" : "Zapisz hasło SMTP"}
            </button>
            {status.passwordSaved && (
              <button
                type="button"
                className="secondary"
                disabled={
                  busy || sending || verifying || !status.productionReady
                }
                onClick={async () => {
                  setVerifying(true);
                  setError("");
                  setNotice("");
                  try {
                    await api(`${base}/smtp-verify`, {
                      method: "POST",
                      body: "{}",
                    });
                    setNotice(
                      "Logowanie do SMTP działa. Nie wysłano żadnego maila.",
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Nie udało się połączyć z SMTP.",
                    );
                  } finally {
                    setVerifying(false);
                  }
                }}
              >
                {verifying
                  ? "Sprawdzanie…"
                  : "Sprawdź połączenie (bez wysyłania)"}
              </button>
            )}
            {status.passwordSaved && (
              <button
                type="button"
                className="secondary"
                disabled={busy || sending || verifying}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Usunąć zapisane hasło SMTP? Nie usunie to uczestników ani historii.",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(`${base}/smtp`, { method: "DELETE" });
                    await load();
                    setNotice("Usunięto hasło SMTP. Wysyłka jest zablokowana.");
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Błąd usuwania hasła.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Usuń hasło
              </button>
            )}
          </div>
        </form>
        {!status.productionReady && (
          <p className="notice">
            Wysyłka jest zablokowana poza produkcją lub bez publicznego adresu
            APP_URL z HTTPS.
          </p>
        )}
        {!status.senderValid && (
          <p className="notice error">
            Adres nadawcy konferencji musi być ustawiony na {status.username}.
          </p>
        )}
      </section>
      <section className="card">
        <h2>Treść wiadomości do uczestnika</h2>
        <p className="muted">
          Każdy uczestnik dostanie indywidualny kod dostępu do panelu
          konferencji, bez załączników. Dostępne pola: {"{{firstName}}"},{" "}
          {"{{lastName}}"}, {"{{eventName}}"},{" {{location}}"}, {" {{date}}"},{" "}
          {" {{accessCode}}"}.
        </p>
        <form onSubmit={saveTemplate}>
          <label>
            Temat wiadomości
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              minLength={1}
              maxLength={200}
              required
            />
          </label>
          <label>
            Treść wiadomości
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              minLength={10}
              maxLength={10000}
              required
            />
          </label>
          <button disabled={busy || sending}>Zapisz szablon</button>
        </form>
        <p className="muted">
          Wiadomość zawiera indywidualny kod i link do panelu uczestnika. Bez
          plików i kodów QR.
        </p>
      </section>
      <section className="card">
        <h2>Pojedyncza wiadomość testowa</h2>
        <p>
          Wysyła dokładnie jedną wiadomość. Po wybraniu uczestnika używa
          zapisanego szablonu, jego imienia i istniejącego kodu. Bez wyboru
          wysyła ogólny test bez kodu. Nie uruchamia kampanii i nie zmienia
          statusów zaproszeń.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (testRequestId.current || testPending) return;
            if (
              !window.confirm(
                "Wysłać jedną wiadomość testową na " +
                  testEmail +
                  (testParticipant
                    ? " z imieniem i kodem uczestnika: " +
                      testPeople.find((p) => p.id === testParticipant)
                        ?.firstName +
                      " " +
                      testPeople.find((p) => p.id === testParticipant)?.lastName
                    : " bez kodu uczestnika") +
                  "?",
              )
            )
              return;
            testRequestId.current = crypto.randomUUID();
            setTestPending(true);
            try {
              const result = await api<{
                status: string;
                messageId: string;
                diagnostic?: string;
              }>(`${base}/smtp-test`, {
                method: "POST",
                body: JSON.stringify({
                  email: testEmail,
                  requestId: testRequestId.current,
                  ...(testParticipant
                    ? { participantId: testParticipant }
                    : {}),
                }),
              });
              setTestResult(
                (result.status === "ACCEPTED"
                  ? "Przyjęta przez home.pl. Doręczenie do skrzynki odbiorcy niepotwierdzone."
                  : "Wynik wymaga sprawdzenia: " +
                    (result.diagnostic || "REVIEW_REQUIRED")) +
                  " Identyfikator: " +
                  result.messageId,
              );
            } catch {
              setTestResult(
                "Nie otrzymano potwierdzenia. Nie ponawiaj wysyłki. Sprawdź historię działań dla próby " +
                  testRequestId.current,
              );
            } finally {
              setTestPending(false);
            }
          }}
        >
          <label>
            Uczestnik do personalizacji
            <select
              value={testParticipant}
              onChange={(e) => setTestParticipant(e.target.value)}
              disabled={testPending || !!testResult}
            >
              <option value="">Ogólny test bez kodu</option>
              {testPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.email})
                </option>
              ))}
            </select>
          </label>
          <label>
            Adres odbiorcy testu
            <input
              type="email"
              value={testEmail}
              required
              maxLength={254}
              disabled={testPending || !!testResult}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </label>
          <button
            disabled={!ready || sending || busy || testPending || !!testResult}
          >
            Wyślij jeden mail testowy
          </button>
        </form>
        {testResult && (
          <p role="status" style={{ overflowWrap: "anywhere" }}>
            {testResult}
          </p>
        )}
      </section>
      <section className="card">
        <h2>Uczestnicy i postęp wysyłki</h2>
        <p className="notice">
          „Przyjęte przez SMTP” oznacza przyjęcie przez home.pl, nie doręczenie
          do odbiorcy. Odrzucenie przez Onet lub inny serwer może pojawić się
          później jako zwrotka na skrzynce nadawczej.
        </p>
        <div className="stats">
          <div className="stat">
            <small>Wszyscy uczestnicy</small>
            <strong>{status.total}</strong>
          </div>
          <div className="stat">
            <small>Unikalne adresy</small>
            <strong>{status.uniqueEmails}</strong>
          </div>
          <div className="stat">
            <small>Dodatkowi odbiorcy na powtórzonych adresach</small>
            <strong>{status.duplicateRecipients}</strong>
          </div>
          <div className="stat">
            <small>Przyjęte przez SMTP</small>
            <strong>{status.sent}</strong>
          </div>
        </div>
        <p className="muted">
          Każdy uczestnik jest wysyłany osobno, również wtedy, gdy kilka osób ma
          jeden adres. Każda osoba otrzyma swój kod. Liczba adresów
          występujących wielokrotnie: {status.duplicateEmailAddresses}.
        </p>
        <div className="stats">
          <div className="stat">
            <small>Oczekujące</small>
            <strong>{status.queued}</strong>
          </div>
          <div className="stat">
            <small>W trakcie</small>
            <strong>{status.sending}</strong>
          </div>
          <div className="stat">
            <small>Błędy / ręczna weryfikacja</small>
            <strong>{status.errors}</strong>
          </div>
          <div className="stat">
            <small>Jeszcze nieprzygotowane</small>
            <strong>{status.notQueued}</strong>
          </div>
        </div>
        <p className="muted">
          Wysyłka odbywa się partiami. Pozostaw otwartą kartę do zakończenia; po
          jej zamknięciu można wznowić pozostałą kolejkę. W przypadku niepewnego
          wyniku SMTP nie ponawiamy wiadomości automatycznie. Chwilowe błędy
          przed przyjęciem wiadomości ponawiamy najwyżej dwukrotnie.
        </p>
        <button
          disabled={
            !ready ||
            sending ||
            busy ||
            status.total === 0 ||
            status.total === status.sent + status.errors
          }
          onClick={() => void startSending()}
        >
          {sending
            ? "Trwa wysyłka…"
            : status.queued
              ? "Wznów wysyłkę"
              : "Rozpocznij wysyłkę do uczestników"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={sending || busy}
          style={{ marginLeft: "0.5rem" }}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Odśwież status
        </button>
        {status.errors > 0 && (
          <p className="notice error">
            Niektóre wiadomości wymagają sprawdzenia. Ze względów bezpieczeństwa
            nie są wysyłane ponownie automatycznie.
          </p>
        )}
        <details>
          <summary>Diagnostyka poszczególnych wiadomości</summary>
          <p>
            Identyfikator i czas pomagają odszukać wiadomość w logach home.pl.
            Starsze wiadomości mogą nie mieć zapisanego identyfikatora. Błędy
            niejednoznaczne wymagają ręcznej weryfikacji. W kolejce mogą być
            również bezpieczne ponowienia po chwilowym odrzuceniu przez SMTP.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Odbiorca</th>
                  <th>Status</th>
                  <th>Czas próby / przyjęcia</th>
                  <th>Identyfikator wiadomości</th>
                  <th>Diagnostyka</th>
                </tr>
              </thead>
              <tbody>
                {status.diagnostics?.map((item) => (
                  <tr key={item.participantId}>
                    <td>{item.email}</td>
                    <td>{deliveryLabels[item.status] || item.status}</td>
                    <td>
                      {item.sentAt || item.attemptedAt
                        ? new Date(
                            (item.sentAt || item.attemptedAt)!,
                          ).toLocaleString("pl-PL", {
                            timeZone: "Europe/Warsaw",
                          })
                        : "Brak"}
                    </td>
                    <td style={{ overflowWrap: "anywhere" }}>
                      {item.messageId || "Brak - starsza wiadomość"}
                    </td>
                    <td>
                      {item.errorCode ||
                        (item.status === "SENT"
                          ? "Doręczenie do odbiorcy niepotwierdzone"
                          : "-")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Etapy błędów: CONNECT - połączenie TLS, GREETING/EHLO - powitanie
            serwera, AUTH - logowanie, FROM - nadawca, RECIPIENT - odbiorca,
            DATA - rozpoczęcie wiadomości, ACCEPTANCE - oczekiwanie na
            przyjęcie. Kod 4xx oznacza błąd tymczasowy, 5xx odrzucenie operacji.
            CONNECTION oznacza brak jednoznacznej odpowiedzi; REVIEW_REQUIRED
            wymaga ręcznej weryfikacji.
          </p>
        </details>
        {notice && (
          <p role="status" className="notice success">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
