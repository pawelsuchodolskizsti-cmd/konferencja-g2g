import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { adminEventList } from "@/server/events";
import { Admin } from "@/components/admin";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; token?: string }>;
}) {
  if (!process.env.DATABASE_URL)
    return (
      <main className="public">
        <section className="card">
          <div className="eyebrow">Pierwsze uruchomienie</div>
          <h1>Podłącz bazę konferencji</h1>
          <p>
            Panel wymaga konfiguracji serwera i konta administratora. Instrukcja
            uruchomienia znajduje się w README projektu.
          </p>
        </section>
      </main>
    );
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
  return (
    <Admin
      initialEvents={events}
      email={admin.email}
      initialSection={query.section}
      initialToken={query.token}
    />
  );
}
