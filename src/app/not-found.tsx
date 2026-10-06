import Link from "next/link";
export default function NotFound() {
  return (
    <main className="public">
      <section className="card">
        <h1>Nie znaleziono strony</h1>
        <p>Sprawdź adres lub wróć do listy wydarzeń.</p>
        <Link className="button" href="/wydarzenie">
          Wydarzenia
        </Link>
      </section>
    </main>
  );
}
