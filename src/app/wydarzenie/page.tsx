import { ConferenceShell } from "@/components/conference-shell";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
export const dynamic = "force-dynamic";
export default async function Page() {
  const rows = process.env.DATABASE_URL
    ? await db()
        .select({
          slug: events.slug,
          name: events.name,
          location: events.location,
          startsAt: events.startsAt,
          timezone: events.timezone,
        })
        .from(events)
        .where(eq(events.published, true))
        .orderBy(desc(events.startsAt))
    : [];
  return (
    <ConferenceShell current="participant">
      <div className="public">
        <div className="row spread">
          <Link className="brand" href="/">
            <span>K</span>Konferencje
          </Link>
          <Link className="button secondary" href="/uczestnik">
            Strefa uczestnika
          </Link>
        </div>
        <header className="publicheader">
          <div className="eyebrow">Spotkajmy się</div>
          <h1>Wydarzenia fundacji</h1>
          <p className="muted">Wybierz konferencję i sprawdź program.</p>
        </header>
        {rows.length ? (
          rows.map((event) => (
            <Link
              key={event.slug}
              href={`/wydarzenie/${event.slug}`}
              className="card"
              style={{ display: "block", color: "inherit" }}
            >
              <h2>{event.name}</h2>
              <p className="muted">
                {new Intl.DateTimeFormat("pl-PL", {
                  dateStyle: "long",
                  timeZone: event.timezone,
                }).format(event.startsAt)}{" "}
                · {event.location}
              </p>
              <span style={{ color: "var(--brand)" }}>Zobacz program</span>
            </Link>
          ))
        ) : (
          <section className="card">
            <h2>Program pojawi się wkrótce</h2>
            <p className="muted">
              Organizator nie opublikował jeszcze żadnego wydarzenia.
            </p>
          </section>
        )}
      </div>
    </ConferenceShell>
  );
}
