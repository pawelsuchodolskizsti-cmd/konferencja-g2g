"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, dateTime, type EventData } from "./api";
import {
  renderOrganizationalBody,
  renderOrganizationalSubject,
  type OrganizationalTemplateValues,
} from "@/lib/organizational-mail";

type Person = {
  id: string; firstName: string; lastName: string;
  email: string; secondaryEmail: string | null;
};
type Delivery = {
  id: string; participantId: string; firstName: string; lastName: string;
  recipients: { to: string; cc?: string };
  status: "QUEUED" | "SENDING" | "ACCEPTED" | "FAILED" | "REVIEW_REQUIRED";
  attempts: number; firstAttemptAt: string | null; lastAttemptAt: string | null;
  acceptedAt: string | null; errorCode: string | null;
  messageId: string; smtpQueueId: string | null; nextAttemptAt: string;
};
type CampaignSummary = {
  id: string; subject: string; createdAt: string;
  launchedAt: string | null; updatedAt: string;
  stats: Record<string, number>;
};
type Catalog = { people: Person[]; campaigns: CampaignSummary[] };
type Campaign = {
  id: string; subject: string; body: string;
  createdAt: string; launchedAt: string | null; deliveries: Delivery[];
};
type Batch = { sent: number; errors: number; retryAfterMs: number; stopped: boolean };

const label: Record<Delivery["status"], string> = {
  QUEUED: "Oczekuje",
  SENDING: "Wysyłanie…",
  ACCEPTED: "Przyjęte przez home.pl",
  FAILED: "Odrzucone — można ponowić",
  REVIEW_REQUIRED: "Wymaga weryfikacji w home.pl",
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AdminOrganizational({ eventId, event }: { eventId: string; event: EventData }) {
  const base = "/api/admin/events/" + eventId + "/organizational";
  const [catalog, setCatalog] = useState<Catalog>({ people: [], campaigns: [] });
  const [campaignId, setCampaignId] = useState("");
  const [detail, setDetail] = useState<Campaign | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const dirty = useRef(false);
  const active = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const refreshCatalog = useCallback(async () => {
    const result = await api<Catalog>(base);
    if (!active.current) return result;
    setCatalog(result);
    setCampaignId((id) =>
      id && result.campaigns.some((c) => c.id === id)
        ? id : result.campaigns[0]?.id || ""
    );
    return result;
  }, [base]);
  const refreshDetail = useCallback(async (id: string) => {
    const result = await api<Campaign>(base + "/" + id);
    if (!active.current) return result;
    setDetail((previous) => previous?.id === id || !previous ? result : previous);
    if (!dirty.current) {
      setSubject(result.subject);
      setBody(result.body);
    }
    return result;
  }, [base]);

  useEffect(() => {
    void refreshCatalog().catch((e) => setError(e instanceof Error ? e.message : "Nie można wczytać uczestników."));
  }, [refreshCatalog]);
  useEffect(() => {
    if (!campaignId) return;
    dirty.current = false;
    void refreshDetail(campaignId).catch((e) => setError(e instanceof Error ? e.message : "Nie można wczytać kampanii."));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshDetail(campaignId).catch(() => undefined);
      }
    }, 12000);
    return () => clearInterval(timer);
  }, [campaignId, refreshDetail]);

  const activeCampaign = detail?.id === campaignId ? detail : null;
  const launched = !!activeCampaign?.launchedAt;
  const filtered = catalog.people.filter((p) =>
    (p.firstName + " " + p.lastName + " " + p.email + " " + (p.secondaryEmail || ""))
      .toLocaleLowerCase("pl").includes(query.trim().toLocaleLowerCase("pl"))
  );
  const chosen = catalog.people.find((p) => p.id === selected[0]) || catalog.people[0];
  const previewValues: OrganizationalTemplateValues = {
    firstName: chosen?.firstName || "Anna",
    lastName: chosen?.lastName || "Przykładowa",
    eventName: event.name,
    date: new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "long", timeStyle: "short", timeZone: event.timezone,
    }).format(new Date(event.startsAt)),
    location: event.location,
    accessCode: "ABC123",
    panelUrl: (origin || "https://konferencja-g2g.pl") + "/uczestnik",
  };
  const summary = activeCampaign?.deliveries.reduce((stats, d) => {
    stats[d.status] = (stats[d.status] || 0) + 1;
    return stats;
  }, {} as Record<Delivery["status"], number>) || {} as Record<Delivery["status"], number>;

  async function create() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ id: string }>(base, { method: "POST", body: "{}" });
      dirty.current = false;
      setSelected([]);
      setDetail(null);
      await refreshCatalog();
      setCampaignId(result.id);
      setNotice("Utworzono szkic. Żadna wiadomość nie została wysłana.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się utworzyć szkicu.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!activeCampaign || launched) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(base + "/" + campaignId + "/draft", {
        method: "POST", body: JSON.stringify({ subject, body }),
      });
      dirty.current = false;
      await refreshDetail(campaignId);
      await refreshCatalog();
      setNotice("Szkic zapisany. Niczego nie wysłano.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zapisać szkicu.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runQueue(id: string) {
    if (running.current) return;
    running.current = true;
    setSending(true); setError("");
    try {
      for (let iteration = 0; active.current && iteration < 3000; iteration++) {
        const response = await api<Batch>(base + "/" + id + "/process", {
          method: "POST", body: "{}",
        });
        const current = await refreshDetail(id);
        await refreshCatalog();
        if (response.stopped) {
          setError("Wysyłka zatrzymana po błędzie wymagającym sprawdzenia. Zweryfikuj statusy przed wznowieniem.");
          break;
        }
        if (!current.deliveries.some((d) => d.status === "QUEUED")) {
          setNotice("Zakończono kolejkę. Status „przyjęte” nie oznacza doręczenia do skrzynki.");
          break;
        }
        await pause(Math.min(30000, Math.max(1000, response.retryAfterMs || 1500)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się dokończyć kolejki. Sprawdź historię przed wznowieniem.");
    } finally {
      running.current = false;
      if (active.current) setSending(false);
    }
  }

  async function launch() {
    if (!activeCampaign || launched || selected.length === 0) return;
    if (!window.confirm(
      "Uruchomić osobną kampanię organizacyjną dla " + selected.length +
      " uczestników? Każdy dostanie jeden e-mail, a drugi adres (jeśli podano) znajdzie się w DW. " +
      "Lista odbiorców i treść zostaną zablokowane. Nie można cofnąć wysłania."
    )) return;
    if (!(await save())) return;
    setBusy(true);
    try {
      const { queued } = await api<{ queued: number }>(base + "/" + campaignId + "/launch", {
        method: "POST", body: JSON.stringify({ ids: selected }),
      });
      setNotice("Przygotowano " + queued + " wiadomości. Wysyłka rozpoczyna się po zatwierdzeniu.");
      await refreshDetail(campaignId);
      await refreshCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się uruchomić kampanii.");
      return;
    } finally {
      setBusy(false);
    }
    await runQueue(campaignId);
  }

  async function retry(d: Delivery) {
    if (d.status !== "FAILED" || busy || sending) return;
    if (!window.confirm(
      "Ponowić jedną wiadomość dla " + d.firstName + " " + d.lastName +
      "? Operacja jest dozwolona, ponieważ serwer nie potwierdził przyjęcia wcześniejszej próby."
    )) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(base + "/" + campaignId + "/retry", {
        method: "POST", body: JSON.stringify({ deliveryId: d.id }),
      });
      await refreshDetail(campaignId);
      setNotice("Wiadomość ustawiona do bezpiecznego ponowienia.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się ponowić wiadomości.");
      return;
    } finally { setBusy(false); }
    await runQueue(campaignId);
  }

  return (
    <>
      <section className="card">
        <h2>Wiadomości organizacyjne</h2>
        <p className="muted">
          Osobne kampanie, niezależne od zaproszeń. Każdy uczestnik otrzyma własną wiadomość
          z istniejącym kodem dostępu. Drugi adres odbiorcy jest wysyłany jako DW (CC),
          nie jako osobna kopia kampanii.
        </p>
        <div className="actions">
          <label style={{ flex: 1 }}>
            Zapisane szkice i kampanie
            <select
              aria-label="Wybierz kampanię organizacyjną"
              value={campaignId}
              onChange={(e) => {
                dirty.current = false;
                setDetail(null);
                setCampaignId(e.target.value);
                setSelected([]);
                setError(""); setNotice("");
              }}
            >
              {!catalog.campaigns.length && <option value="">Brak kampanii</option>}
              {catalog.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.launchedAt ? "Wysłana: " : "Szkic: ") + c.subject + " — " + dateTime(c.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || sending} onClick={() => void create()}>
            Nowy szkic
          </button>
        </div>
        {notice && <p role="status" className="notice">{notice}</p>}
        {error && <p role="alert" className="notice error">{error}</p>}
        {!catalog.campaigns.length && <p>Utwórz pierwszy szkic wiadomości.</p>}
      </section>

      {activeCampaign && (
        <>
          <section className="card">
            <h2>Szkic wiadomości</h2>
            <p className="muted">
              Pola personalizacji: <code>{"{{firstName}}"}</code>, <code>{"{{lastName}}"}</code>,
              <code>{"{{eventName}}"}</code>, <code>{"{{date}}"}</code>,
              <code>{"{{location}}"}</code>, <code>{"{{panelUrl}}"}</code> i
              <code>{"{{accessCode}}"}</code>. W treści dozwolone są znaczniki
              <code>{" <b> "}</code> i <code>{" <i> "}</code>.
            </p>
            <label>
              Temat wiadomości
              <input
                aria-label="Temat wiadomości organizacyjnej"
                value={subject} maxLength={200} disabled={launched || busy || sending}
                onChange={(e) => { setSubject(e.target.value); dirty.current = true; }}
              />
            </label>
            <label>
              Treść wiadomości
              <textarea
                aria-label="Treść wiadomości organizacyjnej"
                rows={13} value={body} maxLength={10000}
                disabled={launched || busy || sending}
                onChange={(e) => { setBody(e.target.value); dirty.current = true; }}
              />
            </label>
            {!launched && (
              <button type="button" disabled={busy || sending} onClick={() => void save()}>
                Zapisz szkic
              </button>
            )}
            {launched && <p>Treść uruchomionej kampanii jest zablokowana. Nowa wiadomość wymaga osobnego szkicu.</p>}
          </section>
          <section className="card">
            <h2>Podgląd wiadomości</h2>
            <p className="muted">
              Podgląd pokazuje przykład personalizacji. Kod „ABC123” jest fikcyjny —
              faktyczny kod zostanie pobrany osobno dla każdego odbiorcy przy wysyłce.
            </p>
            <p><strong>Temat: {renderOrganizationalSubject(subject, previewValues)}</strong></p>
            <div style={{
              padding: 20, background: "white", color: "#122c3a", lineHeight: 1.6,
              border: "1px solid #bdd8e8", overflowWrap: "anywhere",
            }} dangerouslySetInnerHTML={{ __html: renderOrganizationalBody(body, previewValues) }} />
            <p className="muted">Do: {chosen?.email || "uczestnik@example.org"}.
              {chosen?.secondaryEmail ? " DW: " + chosen.secondaryEmail + "." : " Brak dodatkowego adresu DW."}
            </p>
          </section>
          {!launched && (
            <section className="card">
              <h2>Wybierz odbiorców</h2>
              <label>
                Wyszukaj uczestnika
                <input type="search" value={query}
                  aria-label="Wyszukaj osobę do wiadomości organizacyjnej"
                  placeholder="Imię, nazwisko lub e-mail"
                  onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className="actions">
                <button type="button" className="secondary" disabled={!filtered.length || sending || busy}
                  onClick={() => setSelected((previous) => [...new Set([...previous, ...filtered.map((p) => p.id)])])}>
                  Zaznacz widoczne ({filtered.length})
                </button>
                <button type="button" className="secondary" disabled={!selected.length || sending || busy}
                  onClick={() => setSelected([])}>Wyczyść wybór</button>
              </div>
              <p><strong>Wybrano {selected.length} z {catalog.people.length} uczestników.</strong></p>
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {filtered.map((p) => (
                  <label key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "9px 0",
                  }}>
                    <input type="checkbox" checked={selected.includes(p.id)} disabled={busy || sending}
                      style={{ width: 20, height: 20, minHeight: 20, flexShrink: 0, margin: 0 }}
                      onChange={(e) => setSelected((previous) => e.target.checked
                        ? [...new Set([...previous, p.id])]
                        : previous.filter((id) => id !== p.id))} />
                    <span>
                      <strong>{p.firstName} {p.lastName}</strong>
                      <br /><small>Do: {p.email}{p.secondaryEmail ? " · DW: " + p.secondaryEmail : ""}</small>
                    </span>
                  </label>
                ))}
                {!filtered.length && <p>Brak pasujących uczestników.</p>}
              </div>
              <button type="button" disabled={busy || sending || !selected.length}
                onClick={() => void launch()}>
                Zatwierdź i rozpocznij wysyłkę do {selected.length} osób
              </button>
            </section>
          )}
          {launched && (
            <section className="card">
              <h2>Potwierdzenia i statusy wysyłki</h2>
              <p className="muted">
                „Przyjęte przez home.pl” oznacza odpowiedź SMTP 250 po przesłaniu treści.
                Nie jest potwierdzeniem dostarczenia do skrzynki. Przy niepewnym wyniku
                należy sprawdzić skrzynkę i historię u operatora — nie ponawiamy automatycznie.
              </p>
              <p>Uruchomiono: <strong>{dateTime(activeCampaign.launchedAt)}</strong></p>
              <div className="stats">
                <div className="stat"><small>Oczekujące</small><strong>{summary.QUEUED || 0}</strong></div>
                <div className="stat"><small>Przyjęte przez SMTP</small><strong>{summary.ACCEPTED || 0}</strong></div>
                <div className="stat"><small>Nieprzyjęte</small><strong>{summary.FAILED || 0}</strong></div>
                <div className="stat"><small>Do sprawdzenia</small><strong>{summary.REVIEW_REQUIRED || 0}</strong></div>
              </div>
              <div className="actions">
                <button disabled={busy || sending || !(summary.QUEUED > 0)} type="button"
                  onClick={() => void runQueue(campaignId)}>
                  {sending ? "Trwa wysyłka…" : "Wznów oczekującą kolejkę"}
                </button>
                <button className="secondary" type="button" disabled={busy}
                  onClick={() => void refreshDetail(campaignId).catch((e) => setError(String(e)))}>
                  Odśwież status
                </button>
              </div>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>Uczestnik</th><th>Adresy</th><th>Status</th><th>Data próby</th>
                      <th>Data przyjęcia</th><th>Próby / diagnostyka</th><th>Działanie</th></tr>
                  </thead>
                  <tbody>
                    {activeCampaign.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td><strong>{d.firstName} {d.lastName}</strong></td>
                        <td>Do: {d.recipients.to}{d.recipients.cc && <><br />DW: {d.recipients.cc}</>}</td>
                        <td>
                          <span className={"badge " + (d.status === "ACCEPTED" ? "good" : d.status === "FAILED" ? "bad" : "")}>
                            {label[d.status]}
                          </span>
                        </td>
                        <td>{dateTime(d.lastAttemptAt || d.firstAttemptAt)}</td>
                        <td>{dateTime(d.acceptedAt)}</td>
                        <td>{d.attempts} {d.attempts === 1 ? "próba" : "prób"}<br />
                          <small>{d.errorCode || d.smtpQueueId || "-"}</small>
                        </td>
                        <td>
                          {d.status === "FAILED" ? (
                            <button type="button" className="secondary" disabled={busy || sending}
                              onClick={() => void retry(d)}>
                              Ponów wysyłkę
                            </button>
                          ) : d.status === "REVIEW_REQUIRED" ? (
                            <span>Sprawdź w home.pl — brak bezpiecznego ponowienia</span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <p role="alert" className="notice error">{error}</p>}
            </section>
          )}
        </>
      )}
    </>
  );
}
