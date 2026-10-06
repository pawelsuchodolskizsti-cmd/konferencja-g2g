import Link from "next/link";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  return (
    <main className="auth">
      <section className="card">
        <div className="eyebrow">Rejestracja obecności</div>
        <h1>Kod wejścia na konferencję</h1>
        <p>
          Pokaż ten kod organizatorowi przy wejściu. Samo otwarcie strony nie
          potwierdza obecności.
        </p>
        {valid && (
          <Link
            className="button"
            href={`/skanowaniebiletow?token=${encodeURIComponent(token)}`}
          >
            Otwórz panel rejestracji
          </Link>
        )}
        <p className="muted" style={{ marginTop: "1rem" }}>
          Rejestracja wymaga zalogowanego administratora.
        </p>
      </section>
    </main>
  );
}
