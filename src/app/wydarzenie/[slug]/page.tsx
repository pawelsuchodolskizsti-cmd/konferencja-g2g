import { ConferenceProgram } from "@/components/conference-program";
import { ConferenceShell } from "@/components/conference-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [event] = await db()
    .select({
      name: events.name,
      organizer: events.organizer,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      location: events.location,
      timezone: events.timezone,
      agenda: events.agenda,
      info: events.info,
    })
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.published, true)));
  if (!event) notFound();
  const date = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeZone: event.timezone,
  }).format(event.startsAt);
  const time = new Intl.DateTimeFormat("pl-PL", {
    timeStyle: "short",
    timeZone: event.timezone,
  });
  return (
    <ConferenceShell current="participant">
      <div className="public">
        <div className="row spread">
          <Link href="/wydarzenie" className="brand">
            <span>K</span>Konferencje
          </Link>
          <Link className="button" href="/uczestnik">
            Strefa uczestnika
          </Link>
        </div>
        <header className="publicheader">
          <div className="eyebrow">{event.organizer}</div>
          <h1>{event.name}</h1>
          <p>
            {date} · {time.format(event.startsAt)} do{" "}
            {time.format(event.endsAt)}
          </p>
          <p className="muted">{event.location}</p>
        </header>
        <section className="card">
          <div className="row spread">
            <h2>Program konferencji</h2>
            <span className="badge">{event.timezone}</span>
          </div>
          {event.agenda.length ? (
            <ConferenceProgram items={event.agenda} />
          ) : (
            <p className="muted">Szczegółowy program pojawi się wkrótce.</p>
          )}
        </section>
        {event.info && (
          <section className="card">
            <h2>Informacje organizacyjne</h2>
            <p style={{ whiteSpace: "pre-line" }}>{event.info}</p>
          </section>
        )}
        <section className="card">
          <h2>Twoje materiały po konferencji</h2>
          <p>
            Po potwierdzeniu obecności uzyskasz dostęp do szkoleń, a po
            zakończeniu wydarzenia także do certyfikatu.
          </p>
          <Link className="button secondary" href="/uczestnik">
            Wpisz swój kod
          </Link>
        </section>
      </div>
    </ConferenceShell>
  );
}
