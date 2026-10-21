# Zabezpieczenia aplikacji - 21.10.2026

## Połączenie z bazą

Aplikacja, migrator i skrypt tworzenia administratora przekazują do postgres.js
`ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" }`. Node.js sprawdza
łańcuch zaufania certyfikatu oraz nazwę hosta przekazaną przez sterownik jako SNI.
Jawny obiekt nadpisuje słabsze zachowanie `sslmode=require` w postgres.js.
Nie zmieniamy bazy, danych ani kluczy szyfrowania. Jedyny wyjątek bez TLS to
lokalna baza loopback przy `APP_ENV=development`, poza środowiskiem Vercel.

## CSP

Egzekwujemy `base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'`. Ograniczenia źródeł skryptów, obrazów, stylów i pozostałych
zasobów są w nagłówku **Content-Security-Policy-Report-Only**. Naruszenia można
odczytać w konsoli przeglądarki; nie dodano zewnętrznego zbierania raportów.
To etap wdrożenia CSP, a nie pełna ochrona przed XSS. Inline scripts/styles
pozostają dozwolone ze względu na obecny sposób renderowania Next.js.

Przed egzekwowaniem całej polityki trzeba sprawdzić formularze, panel admina,
skaner QR, podglądy PDF, pobieranie i wszystkie zewnętrzne integracje.

## Testy uprawnień

Nowe testy uruchamiają rzeczywiste handlery API z izolowaną bazą PGlite:
brak sesji, sesja uczestnika, wygasła sesja, wyłączony administrator, role
ADMIN/CHECKIN/CONTROLLER, odczyt kontrolera i odrzucanie jego zapisów,
izolacja wydarzeń i materiałów oraz odrzucanie zapisów z obcego Origin.
Przy odmowie zapisu test sprawdza także brak zmiany danych uczestników.
Nie łączą się z bazą produkcyjną i nie wysyłają wiadomości.

## Zależności

`pnpm security:audit` sprawdza produkcję i blokuje job CI dla high/critical.
`pnpm security:audit:all` sprawdza także narzędzia deweloperskie; wynik jest
widoczny jako ostrzeżenie w CI. CI nie stanowi automatycznej blokady niezależnego
wdrożenia Vercel. Wszystkie instalacje CI używają frozen lockfile.

Vite przypięto do poprawionej wersji 8.3.3. Wynik audytu z 21.10.2026:
0 znanych podatności produkcyjnych, 1 high w narzędziu deweloperskim `braces`
(GHSA-vfj7-8cjw-p6xm, ścieżka ESLint/fast-glob/micromatch).
W dniu audytu brak opublikowanej poprawki. Pakiet nie obsługuje danych
uczestników w aplikacji produkcyjnej. Należy ponowić audyt i zaktualizować go
po wydaniu poprawki. Audyt rejestru nie jest gwarancją braku innych podatności.

## Zakres zmian

Bez migracji schematu, zmian danych uczestników, zasad dostępu, szablonu lub
generatora certyfikatu. Bez nowych płatnych usług.
