import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { adminEventList } from "@/server/events";
import { AppError } from "@/server/errors";
import { ConferenceShell } from "@/components/conference-shell";
import { Scanner } from "@/components/scanner";
import "./scanner-page.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skaner biletów | Głowa do Góry" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; token?: string }>;
}) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect("/admin/login");
    throw error;
  }
  const [events, query] = await Promise.all([
    adminEventList(admin.id),
    searchParams,
  ]);
  const event = query.event
    ? events.find((e) => e.id === query.event)
    : events[0];
  return (
    <ConferenceShell current="participant">
      <div className="scanner-page">
        <Link className="scanner-back" href="/admin">
          ← Panel administratora
        </Link>
        <p className="scanner-label">Konferencja Głowa do Góry</p>
        <h1>
          Skaner
          <br />
          biletów.
        </h1>
        {event ? (
          <>
            <p className="scanner-event">{event.name}</p>
            <Scanner
              key={event.id}
              eventId={event.id}
              initialToken={query.token}
            />
          </>
        ) : (
          <p>
            Uzupełnij ustawienia konferencji w panelu administratora, aby
            uruchomić skaner.
          </p>
        )}
      </div>
    </ConferenceShell>
  );
}
