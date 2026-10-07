import { ConferenceShell } from "@/components/conference-shell";
import Link from "next/link";
export default function NotFound() {
  return (
    <ConferenceShell current="participant">
      <div className="public">
        <section className="card">
          <h1>Nie znaleziono strony</h1>
          <p>SprawdĹş adres lub wrĂłÄ‡ do listy wydarzeĹ„.</p>
          <Link className="button" href="/wydarzenie">
            Wydarzenia
          </Link>
        </section>
      </div>
    </ConferenceShell>
  );
}
