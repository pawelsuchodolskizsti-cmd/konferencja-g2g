"use client";
import { useEffect, useState } from "react";
import "./admin-theme.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, dateTime, type Overview, type Person } from "./api";
import { EventForm } from "./event-form";
import { ImportPanel } from "./import-panel";
import { Scanner } from "./scanner";
const sections = [
  ["dashboard", "Dashboard"],
  ["participants", "Uczestnicy"],
  ["import", "Import"],
  ["mail", "Mailing"],
  ["checkin", "Check-in"],
  ["courses", "Kody szkoleniowe"],
  ["certificates", "Certyfikaty"],
  ["settings", "Ustawienia konferencji"],
] as const;
type EventOption = { id: string; name: string; slug: string };
const mailLabels: Record<string, string> = {
  SENT: "Wysłany",
  QUEUED: "W kolejce",
  SENDING: "W kolejce",
  ERROR: "Błąd",
};
export function Admin({
  initialEvents,
  email,
  initialSection = "dashboard",
  initialToken,
}: {
  initialEvents: EventOption[];
  email: string;
  initialSection?: string;
  initialToken?: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [eventId, setEventId] = useState(initialEvents[0]?.id || "");
  const [section, setSection] = useState(initialSection);
  const configuring = !eventId;
  const [data, setData] = useState<Overview | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => setRevision((v) => v + 1);
  useEffect(() => {
    if (!eventId) return;
    let current = true;
    const load = async () => {
      try {
        const result = await api<Overview>(`/api/admin/events/${eventId}`);
        if (current) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (current)
          setError(e instanceof Error ? e.message : "Błąd pobierania danych.");
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      current = false;
      clearInterval(interval);
    };
  }, [eventId, revision]);
  const overview = data?.event.id === eventId ? data : null;
  const people = overview?.people || [];
  const present = people.filter((p) => p.checkedInAt).length;
  const sent = people.filter((p) => p.emailStatus === "SENT").length;
  const failed = people.filter((p) => p.emailStatus === "ERROR").length;
  const queued = people.filter(
    (p) => p.emailStatus === "QUEUED" || p.emailStatus === "SENDING",
  ).length;
  async function action(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Record<string, unknown>>(
        `/api/admin/events/${eventId}/${path}`,
        {
          method,
          body: body instanceof FormData ? body : JSON.stringify(body || {}),
        },
      );
      reload();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operacja nie powiodła się.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function saved(id: string) {
    setEventId(id);
    setSection("dashboard");
    reload();
    setNotice("Ustawienia zostały zapisane.");
  }
  return (
    <div className="shell admin-theme">
      <aside className="sidebar">
        <div className="admin-brand-row">
          <Link href="/admin" className="brand">
            GŁOWA<span className="brand-light">DO GÓRY</span>
          </Link>
          <button
            className="admin-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "Zamknij ✕" : "Menu ☰"}
          </button>
        </div>
        <nav
          id="admin-navigation"
          className={menuOpen ? "is-open" : ""}
          aria-label="Panel administratora"
        >
          {sections.map(([key, label]) => (
            <a
              key={key}
              href={
                key === "checkin" ? "/skanowaniebiletow" : `?section=${key}`
              }
              className={section === key && !configuring ? "active" : ""}
              aria-current={
                section === key && !configuring ? "page" : undefined
              }
              onClick={(e) => {
                if (key === "checkin") return;
                e.preventDefault();
                setSection(key);
                setMenuOpen(false);
                setNotice("");
              }}
            >
              <AdminIcon name={key} />
              {label}
            </a>
          ))}
        </nav>
        <div className="foot">
          Panel fundacji
          <br />
          Konferencja Głowa do Góry
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Konferencja</div>
            <strong>Głowa do Góry</strong>
          </div>
          <div className="admin-account">
            <div className="muted" style={{ fontSize: ".85rem" }}>
              {email}
            </div>
            <button
              className="secondary"
              style={{ padding: ".3rem .6rem", minHeight: 34 }}
              onClick={async () => {
                await api("/api/auth/logout-admin", { method: "POST" });
                router.replace("/admin/login");
                router.refresh();
              }}
            >
              Wyloguj
            </button>
          </div>
        </header>
        <div className="content">
          <div className="pagehead">
            <div>
              <div className="eyebrow">Panel organizatora</div>
              <h1>
                {configuring
                  ? "Ustawienia konferencji"
                  : sections.find(([key]) => key === section)?.[1] ||
                    "Dashboard"}
              </h1>
              <p className="muted">
                {overview
                  ? `${overview.event.location} · ${dateTime(overview.event.startsAt, overview.event.timezone)}`
                  : "Zacznij od konfiguracji konferencji."}
              </p>
            </div>
            <div className="actions">
              {overview && (
                <Link
                  className="button secondary"
                  href={`/wydarzenie/${overview.event.slug}`}
                >
                  Program wydarzenia
                </Link>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice success">
              {notice}
            </p>
          )}
          {configuring ? (
            <EventForm onSaved={saved} />
          ) : !overview ? (
            <section className="card empty">
              {eventId
                ? "Wczytywanie wydarzenia…"
                : "Uzupełnij ustawienia konferencji, aby dodać uczestników."}
            </section>
          ) : (
            <>
              {section === "dashboard" && (
                <>
                  <div className="stats">
                    <Stat
                      label="Uczestnicy"
                      value={people.length}
                      note="na liście wydarzenia"
                    />
                    <Stat
                      label="Obecni"
                      value={present}
                      note={
                        people.length
                          ? `${Math.round((present / people.length) * 100)}% uczestników`
                          : "Rejestracja jeszcze się nie rozpoczęła"
                      }
                      primary
                    />
                    <Stat
                      label="Nieobecni"
                      value={people.length - present}
                      note="oczekuje na rejestrację"
                    />
                    <Stat
                      label="Wysłane zaproszenia"
                      value={sent}
                      note={`${failed} błędów · ${queued} w kolejce`}
                    />
                  </div>
                  <div className="grid">
                    <section className="card">
                      <div className="row spread">
                        <h2>Obecność na konferencji</h2>
                        <span className="badge">
                          {present} / {people.length}
                        </span>
                      </div>
                      <div className="admin-attendance">
                        <div
                          className="admin-ring"
                          role="img"
                          aria-label={`${present} z ${people.length} uczestników obecnych`}
                        >
                          <svg viewBox="0 0 120 120" aria-hidden="true">
                            <circle
                              cx="60"
                              cy="60"
                              r="50"
                              className="ring-track"
                            />
                            <circle
                              cx="60"
                              cy="60"
                              r="50"
                              className="ring-value"
                              pathLength="100"
                              strokeDasharray={`${people.length ? (present / people.length) * 100 : 0} 100`}
                            />
                          </svg>
                          <div>
                            <strong>{present}</strong>
                            <span>obecnych</span>
                          </div>
                        </div>
                      </div>
                      <p className="muted">
                        Potwierdzenie wejścia odblokowuje dostęp do szkoleń.
                      </p>
                      <button onClick={() => router.push("/skanowaniebiletow")}>
                        Otwórz skaner QR
                      </button>
                    </section>
                    <section className="card">
                      <h2>Materiały i certyfikaty</h2>
                      <p>
                        <strong>{present}</strong> osób z dostępem do kursów
                      </p>
                      <p>
                        <strong>
                          {new Date() >=
                          new Date(overview.event.certificateUnlockAt)
                            ? present
                            : 0}
                        </strong>{" "}
                        osób uprawnionych do certyfikatu
                      </p>
                      <p className="muted">
                        Certyfikaty od{" "}
                        {dateTime(
                          overview.event.certificateUnlockAt,
                          overview.event.timezone,
                        )}
                      </p>
                    </section>
                  </div>
                  <section className="card">
                    <h2>Ostatnie rejestracje</h2>
                    {present ? (
                      <PeopleTable
                        people={[...people]
                          .filter((p) => p.checkedInAt)
                          .sort(
                            (a, b) =>
                              new Date(b.checkedInAt!).getTime() -
                              new Date(a.checkedInAt!).getTime(),
                          )
                          .slice(0, 6)}
                      />
                    ) : (
                      <div className="empty">
                        Pierwsze wejścia pojawią się tutaj po zeskanowaniu QR.
                      </div>
                    )}
                  </section>
                  <section className="card">
                    <h2>Dziennik działań</h2>
                    {overview.audit.length ? (
                      <div className="tablewrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Kiedy</th>
                              <th>Działanie</th>
                              <th>Administrator</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.audit.slice(0, 15).map((log) => (
                              <tr key={log.id}>
                                <td>{dateTime(log.createdAt)}</td>
                                <td>{log.action}</td>
                                <td>
                                  {log.adminId
                                    ? log.adminId.slice(0, 8)
                                    : "System"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="muted">Brak zapisanych działań.</p>
                    )}
                  </section>
                </>
              )}
              {section === "participants" && (
                <Participants
                  people={people}
                  eventId={eventId}
                  busy={busy}
                  action={action}
                />
              )}
              {section === "import" && (
                <ImportPanel
                  key={eventId}
                  eventId={eventId}
                  onComplete={reload}
                />
              )}
              {section === "checkin" && (
                <>
                  <Scanner
                    key={eventId}
                    eventId={eventId}
                    initialToken={initialToken}
                    onComplete={reload}
                  />
                  <section className="card">
                    <h2>Ręczne potwierdzenie obecności</h2>
                    <Participants
                      people={people}
                      eventId={eventId}
                      busy={busy}
                      action={action}
                      compact
                    />
                  </section>
                </>
              )}
              {section === "mail" && (
                <MailPanel
                  eventId={eventId}
                  count={people.length - sent - queued}
                  sent={sent}
                  failed={failed}
                  queued={queued}
                  enabled={overview.mailEnabled}
                  busy={busy}
                  send={async () => {
                    const result = await action("mail");
                    if (result)
                      setNotice(`Dodano do kolejki: ${result.queued}.`);
                  }}
                />
              )}
              {section === "courses" && (
                <Courses data={overview} busy={busy} action={action} />
              )}
              {section === "certificates" && (
                <>
                  <div className="stats">
                    <Stat
                      label="Potwierdzona obecność"
                      value={present}
                      note="warunek otrzymania certyfikatu"
                    />
                    <Stat
                      label="Wygenerowane PDF"
                      value={
                        people.filter((p) => p.certificateGeneratedAt).length
                      }
                      note="indywidualne certyfikaty"
                    />
                  </div>
                  <section className="card">
                    <h2>Certyfikaty uczestnictwa</h2>
                    <p>
                      Dostępne po{" "}
                      {dateTime(
                        overview.event.certificateUnlockAt,
                        overview.event.timezone,
                      )}
                      . Uczestnicy pobierają je w swojej strefie lub zlecają
                      wysyłkę na swój adres e-mail.
                    </p>
                    <p className="muted">
                      Nazwisko, nazwa wydarzenia i numer certyfikatu są
                      pobierane z bazy danych.
                    </p>
                    <PeopleTable people={people.filter((p) => p.checkedInAt)} />
                  </section>
                </>
              )}
              {section === "settings" && (
                <>
                  <section className="card">
                    <h2>QR z programem wydarzenia</h2>
                    <p>
                      Wydrukuj i umieść przy wejściu. Ten kod prowadzi do
                      publicznego programu konferencji.
                    </p>
                    <a
                      className="button secondary"
                      href={`/api/admin/events/${eventId}/program-qr`}
                      download
                    >
                      Pobierz QR programu
                    </a>
                  </section>
                  <EventForm
                    key={eventId}
                    event={overview.event}
                    onSaved={saved}
                  />
                  <section className="card">
                    <h2>Usunięcie danych po okresie przechowywania</h2>
                    <p>
                      Operacja usuwa dane uczestników, obecność, sesje,
                      wiadomości i certyfikaty tego wydarzenia. Dziennik działań
                      zachowuje identyfikatory operacji.
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const confirmation = new FormData(e.currentTarget).get(
                          "confirmation",
                        );
                        const result = await action("purge", { confirmation });
                        if (result)
                          setNotice(
                            `Usunięto dane ${result.deleted} uczestników.`,
                          );
                      }}
                    >
                      <label>
                        Wpisz USUŃ DANE
                        <input
                          name="confirmation"
                          required
                          placeholder="USUŃ DANE"
                        />
                      </label>
                      <button
                        className="danger"
                        disabled={
                          busy ||
                          !overview.event.retentionUntil ||
                          new Date(overview.event.retentionUntil) > new Date()
                        }
                      >
                        Usuń dane uczestników
                      </button>
                    </form>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  primary = false,
}: {
  label: string;
  value: number;
  note: string;
  primary?: boolean;
}) {
  return (
    <div className={`stat ${primary ? "primary" : ""}`}>
      <div>{label}</div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function PeopleTable({
  people,
  renderAction,
}: {
  people: Person[];
  renderAction?: (p: Person) => React.ReactNode;
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Uczestnik</th>
            <th>Status</th>
            <th>Wejście</th>
            <th>Mail</th>
            <th>Certyfikat</th>
            {renderAction && <th>Działania</th>}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>
                  {p.firstName} {p.lastName}
                </strong>
                <br />
                <span className="muted">{p.email}</span>
              </td>
              <td>
                <span className={`badge ${p.checkedInAt ? "good" : ""}`}>
                  {p.checkedInAt ? "Obecny" : "Nieobecny"}
                </span>
              </td>
              <td>
                {p.checkedInAt ? (
                  <>
                    {dateTime(p.checkedInAt)}
                    <br />
                    <small className="muted">
                      {p.method === "QR" ? "Kod QR" : "Ręcznie"}
                    </small>
                  </>
                ) : (
                  "Brak"
                )}
              </td>
              <td>
                <span
                  className={`badge ${p.emailStatus === "SENT" ? "good" : p.emailStatus === "ERROR" ? "bad" : ""}`}
                >
                  {mailLabels[p.emailStatus || ""] || "Niewysłany"}
                </span>
                {p.emailError === "REVIEW_REQUIRED" && (
                  <p className="muted">Sprawdź wysyłkę u dostawcy.</p>
                )}
              </td>
              <td>
                {p.certificateGeneratedAt
                  ? "Wygenerowany"
                  : p.checkedInAt
                    ? "Obecność potwierdzona"
                    : "Brak uprawnień"}
              </td>
              {renderAction && <td>{renderAction(p)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!people.length && (
        <div className="empty">
          Brak uczestników spełniających wybrane warunki.
        </div>
      )}
    </div>
  );
}
type Action = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<Record<string, unknown> | null>;
function Participants({
  people,
  eventId,
  busy,
  action,
  compact = false,
}: {
  people: Person[];
  eventId: string;
  busy: boolean;
  action: Action;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Person | null>(null);
  const filtered = people.filter(
    (p) =>
      `${p.firstName} ${p.lastName} ${p.email}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "present" && p.checkedInAt) ||
        (filter === "absent" && !p.checkedInAt) ||
        (filter === "sent" && p.emailStatus === "SENT") ||
        (filter === "error" && p.emailStatus === "ERROR") ||
        (filter === "certificate" && p.certificateGeneratedAt)),
  );
  return (
    <>
      <div className={compact ? "" : "card"}>
        <div className="row" style={{ marginBottom: "1rem" }}>
          <input
            aria-label="Wyszukaj uczestnika"
            style={{ flex: 2, minWidth: 200 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po imieniu, nazwisku lub e-mailu"
          />
          <select
            aria-label="Filtr uczestników"
            style={{ flex: 1, minWidth: 160 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Wszyscy</option>
            <option value="present">Obecni</option>
            <option value="absent">Nieobecni</option>
            <option value="sent">Mail wysłany</option>
            <option value="error">Błąd maila</option>
            <option value="certificate">Certyfikat wygenerowany</option>
          </select>
          {!compact && (
            <a
              className="button secondary"
              href={`/api/admin/events/${eventId}/export`}
            >
              Eksport CSV
            </a>
          )}
        </div>
        <PeopleTable
          people={filtered}
          renderAction={(p) => (
            <div className="actions">
              {!p.checkedInAt && (
                <button
                  disabled={busy}
                  onClick={() => {
                    void action("checkin", { participantId: p.id });
                  }}
                >
                  Oznacz jako obecny
                </button>
              )}
              {!compact && (
                <button className="secondary" onClick={() => setEditing(p)}>
                  Edytuj
                </button>
              )}
            </div>
          )}
        />
      </div>
      {editing && (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            const value = Object.fromEntries(new FormData(e.currentTarget));
            if (await action(`participants/${editing.id}`, value, "PATCH"))
              setEditing(null);
          }}
        >
          <h2>Edytuj uczestnika</h2>
          <div className="formgrid">
            <label>
              Imię
              <input
                name="firstName"
                defaultValue={editing.firstName}
                required
              />
            </label>
            <label>
              Nazwisko
              <input name="lastName" defaultValue={editing.lastName} required />
            </label>
            <label className="wide">
              E-mail
              <input
                name="email"
                type="email"
                defaultValue={editing.email}
                required
              />
            </label>
          </div>
          <div className="actions">
            <button disabled={busy}>Zapisz</button>
            <button
              className="secondary"
              type="button"
              onClick={() => setEditing(null)}
            >
              Anuluj
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (
                  window.confirm(
                    "Usunąć uczestnika wraz z obecnością, sesjami i certyfikatem?",
                  ) &&
                  (await action(
                    `participants/${editing.id}`,
                    undefined,
                    "DELETE",
                  ))
                )
                  setEditing(null);
              }}
            >
              Usuń uczestnika
            </button>
          </div>
        </form>
      )}
    </>
  );
}
function MailPanel({
  eventId,
  count,
  sent,
  failed,
  queued,
  enabled,
  busy,
  send,
}: {
  eventId: string;
  count: number;
  sent: number;
  failed: number;
  queued: number;
  enabled: boolean;
  busy: boolean;
  send: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<{
    subject: string;
    html: string;
  } | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      <div className="stats">
        <Stat label="Wysłane" value={sent} note="przyjęte przez dostawcę" />
        <Stat
          label="W kolejce"
          value={queued}
          note="oczekują na przetworzenie"
        />
        <Stat label="Błędy" value={failed} note="sprawdź listę uczestników" />
      </div>
      <section className="card">
        <h2>Zaproszenie na konferencję</h2>
        <p>
          Każdy uczestnik otrzyma własny QR i kod dostępu. Treść zaproszenia
          edytujesz w ustawieniach wydarzenia.
        </p>
        {!enabled && (
          <p className="notice">
            Wysyłka w tym środowisku jest wyłączona. Możesz przygotować szablon
            i zobaczyć podgląd.
          </p>
        )}
        <div className="actions">
          <button
            className="secondary"
            onClick={async () => {
              try {
                setPreview(
                  await api(`/api/admin/events/${eventId}/mail-preview`),
                );
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Błąd podglądu.");
              }
            }}
          >
            Podgląd wiadomości
          </button>
          <button
            disabled={!enabled || busy || !count || !preview}
            onClick={send}
          >
            Wyślij / ponów do {count} uczestników
          </button>
        </div>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Najpierw sprawdź podgląd. Osoby z wysłaną wiadomością nie otrzymają
          jej ponownie.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <h3>{preview.subject}</h3>
            <iframe
              title="Podgląd zaproszenia"
              sandbox=""
              srcDoc={preview.html}
              style={{
                width: "100%",
                height: 650,
                border: "1px solid #dbe3e9",
                borderRadius: 8,
                background: "white",
              }}
            />
          </>
        )}
      </section>
    </>
  );
}
function Courses({
  data,
  busy,
  action,
}: {
  data: Overview;
  busy: boolean;
  action: Action;
}) {
  return (
    <>
      <div className="grid">
        {data.courses.map((course) => (
          <section className="card" key={course.id}>
            <span className="badge">
              {course.mode === "SHARED"
                ? "Wspólny dostęp"
                : "Indywidualne kody"}
            </span>
            <h2 style={{ marginTop: "1rem" }}>{course.name}</h2>
            <p className="muted">{course.platform}</p>
            <a href={course.url} target="_blank" rel="noreferrer">
              Strona kursu
            </a>
            <details style={{ marginTop: "1rem" }}>
              <summary>Edytuj szkolenie</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await action(
                    `courses/${course.id}`,
                    Object.fromEntries(new FormData(e.currentTarget)),
                    "PATCH",
                  );
                }}
              >
                <input type="hidden" name="mode" value={course.mode} />
                <label>
                  Nazwa
                  <input name="name" defaultValue={course.name} required />
                </label>
                <label>
                  Platforma
                  <input
                    name="platform"
                    defaultValue={course.platform}
                    required
                  />
                </label>
                <label>
                  Adres kursu
                  <input
                    name="url"
                    type="url"
                    defaultValue={course.url}
                    required
                  />
                </label>
                {course.mode === "SHARED" && (
                  <label>
                    Nowy wspólny kod (pozostaw puste, aby zachować obecny)
                    <input name="sharedCode" />
                  </label>
                )}
                <button disabled={busy}>Zapisz szkolenie</button>
              </form>
            </details>
            {course.mode === "INDIVIDUAL" && (
              <>
                <p style={{ marginTop: "1rem" }}>
                  Dostępne kody:{" "}
                  <strong>{course.total - course.assigned}</strong> ·
                  Przydzielone: {course.assigned}
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    await action(`courses/${course.id}/codes`, form);
                  }}
                >
                  <label>
                    Pula kodów XLSX / CSV
                    <input
                      name="file"
                      type="file"
                      accept=".xlsx,.csv"
                      required
                    />
                  </label>
                  <p className="muted">
                    Pierwsza kolumna: Kod. Jeden kod w każdym wierszu.
                  </p>
                  <button disabled={busy}>Importuj kody</button>
                </form>
              </>
            )}
          </section>
        ))}
      </div>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const value = Object.fromEntries(new FormData(form));
          if (await action("courses", value)) form.reset();
        }}
      >
        <h2>Dodaj szkolenie</h2>
        <div className="formgrid">
          <label>
            Nazwa kursu
            <input name="name" required />
          </label>
          <label>
            Platforma
            <input name="platform" required />
          </label>
          <label>
            Link do kursu
            <input name="url" type="url" placeholder="https://" required />
          </label>
          <label>
            Model dostępu
            <select name="mode">
              <option value="SHARED">Wspólny link / kod</option>
              <option value="INDIVIDUAL">Indywidualny kod</option>
            </select>
          </label>
          <label className="wide">
            Wspólny kod (opcjonalnie)
            <input name="sharedCode" maxLength={300} />
          </label>
        </div>
        <button disabled={busy}>Dodaj szkolenie</button>
      </form>
      <section className="card">
        <h2>Materiały dla obecnych uczestników</h2>
        {data.materials.map((file) => (
          <p key={file.id}>{file.title}</p>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            if (await action("materials", new FormData(form))) form.reset();
          }}
        >
          <label>
            Dodaj materiał PDF (do 2 MB)
            <input name="file" type="file" accept=".pdf" required />
          </label>
          <button disabled={busy}>Dodaj materiał</button>
        </form>
      </section>
    </>
  );
}

function AdminIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    participants:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M16 3a4 4 0 0 1 0 8",
    import: "M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6",
    mail: "M3 5h18v14H3zM3 5l9 7 9-7",
    checkin:
      "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z",
    courses: "m2 8 10-5 10 5-10 5L2 8m4 3v6l6 3 6-3v-6M22 8v8",
    certificates: "M5 3h14v13H5zM8 16v5l4-2 4 2v-5M8 7h8M8 11h5",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  };
  return (
    <svg
      className="admin-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
}
