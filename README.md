# System konferencji fundacji

Aplikacja Next.js obsługująca wydarzenia, uczestników, zaproszenia z QR, obecność, kody szkoleniowe, chronione materiały i certyfikaty PDF.

## Uruchomienie lokalne

Wymagania: Node.js 24 i pnpm 11.25.0. W katalogu projektu:

```sh
corepack enable
pnpm install
pnpm db:local
```

W drugim terminalu:

```sh
pnpm setup:local
pnpm dev:local
```

Panel: http://localhost:3000/admin. Pierwsze uruchomienie tworzy lokalnego administratora. Jego losowe hasło znajduje się w `.local/access.json`. Plik jest ignorowany przez Git. Nie używaj tego konta poza komputerem lokalnym.

Lokalny PostgreSQL działa przez PGlite Socket na 127.0.0.1:54329 i zapisuje dane w `.local/postgres`. Jest przeznaczony do developmentu, nie do produkcji. Wysyłka rzeczywistych maili jest wyłączona. Uruchomione testy HTTP tworzą 250 syntetycznych uczestników i dwa przykładowe kursy.

Alternatywnie uruchom PostgreSQL przez `docker compose up -d`, skopiuj `.env.example` do `.env.local`, ustaw losowe klucze i wykonaj migracje. Skrypty `db:migrate` i `admin:create` czytają zmienne procesu; lokalnie użyj `node --env-file=.env.local --import tsx scripts/migrate.ts` oraz analogicznie `scripts/create-admin.ts`. Konto administratora tworzy się ze zmiennych `ADMIN_EMAIL` i `ADMIN_PASSWORD`, przy czym hasło musi mieć przynajmniej 14 znaków.

## Obsługa wydarzenia

1. Ustaw daty, organizatora i lokalizację konferencji Głowa do Góry.
2. Dodaj punkty programu i zaznacz publikację. Pobierz osobny QR programu z ustawień.
3. Wgraj XLSX z kolumnami Imię, Nazwisko, Email. Sprawdź błędy i zatwierdź poprawne rekordy.
4. Dodaj szkolenia. Dla kodów indywidualnych wgraj XLSX lub CSV z pierwszą kolumną Kod.
5. W razie potrzeby dodaj materiały PDF w sekcji szkoleń. Są dostępne wyłącznie po obecności.
6. W sekcji Kody i eksport pobierz Excel z kodami oraz indywidualne bilety PDF do swojej korespondencji seryjnej.
7. Przy wejściu uruchom skaner QR albo wyszukaj uczestnika i oznacz obecność ręcznie.
8. Uczestnik loguje się kodem z zaproszenia. Obecność odblokowuje kursy, a zakończenie wydarzenia i ustawiony termin również certyfikat.
9. Pobierz CSV obecności. Po terminie retencji można usunąć dane uczestników z ustawień.

Pliki uczestników: do 2 MB, maksymalnie 2000 wierszy w jednym imporcie. Materiały: PDF do 2 MB. Export CSV zabezpiecza wartości przed interpretacją jako formuły w Excelu.

## Architektura i baza

- `docs/ARCHITEKTURA.md`: model, zasady bezpieczeństwa i plan modułów.
- `src/db/schema.ts`: schemat Drizzle.
- `drizzle/`: wersjonowane migracje SQL i snapshoty.
- `src/server/`: autoryzacja, importy, obecność, mailing, kursy, materiały i certyfikaty.
- `src/app/`: strony i endpointy Next.js.
- `tests/`: testy jednostkowe i integracyjne PostgreSQL.
- `scripts/test-http.mjs`: pełny test przez HTTP, wyłącznie na środowisku lokalnym.
- `e2e/`: testy przeglądarkowe Playwright dla komputera i telefonu.

`attendance` jest źródłem prawdy dla obecności. Uprawnienia są wyliczane na serwerze, zamiast niezależnych flag, które mogłyby się rozjechać. Publiczny QR nie zawiera danych osobowych. Kody mają niezależne losowe wartości, skróty HMAC do wyszukiwania i szyfrowaną kopię do wysyłki. Sesje są odwoływalne i wygasają. Administrator ma dostęp tylko do przypisanych wydarzeń.

Kod indywidualny jest przydzielany w transakcji. Przy usunięciu uczestnika wykorzystany kod zostaje wycofany z puli. Samo otwarcie adresu QR nigdy nie rejestruje obecności.

## Kody i korespondencja seryjna

Panel nie wysyła wiadomości. Wgraj XLSX z nagłówkami Imię, Nazwisko, Email i zatwierdź podgląd. Każdy nowy uczestnik otrzymuje unikalny kod z sześciu wielkich liter i cyfr oraz niezależny token QR.

Sekcja Kody i eksport udostępnia Excel i CSV z danymi, istniejącymi kodami, linkiem do strefy oraz nazwą biletu. Ponowny eksport nie zmienia kodów. Excel przechowuje kod jako tekst, zachowując początkowe zera. CSV należy importować z kolumną Kod ustawioną jako tekst.

Bilety PDF pobiera się w paczkach ZIP po maksymalnie 50 osób. Każda paczka zawiera też dopasowany Excel. Plik z kolumny Plik biletu należy przypisać jako indywidualny załącznik w narzędziu do korespondencji seryjnej. Nie należy załączać całej listy uczestników do wiadomości.

Przykładowy import: `public/przyklady/uczestnicy-testowi.xlsx`, pięć fikcyjnych osób. Dane eksportowe wymagają sesji administratora i przypisania do konferencji, mają nagłówki no-store i zapis audytowy. Endpoint harmonogramu wykonuje tylko porządkowanie wygasłych danych; nie przetwarza kolejki mailowej.

## Wdrożenie na GitHub i Vercel

1. Utwórz prywatne repozytorium GitHub i wyślij źródła z tego katalogu. Sprawdź `git status` przed pierwszym commitem.
2. Podłącz repozytorium do nowego projektu Vercel. Framework: Next.js, Node.js: 24, build: `pnpm build`, katalog główny: katalog zawierający `package.json`.
3. Utwórz oddzielne bazy PostgreSQL dla preview i production. Użyj szyfrowanych połączeń i konfiguracji zgodnej z dostawcą bazy.
4. Dodaj zmienne z `.env.example` do właściwych środowisk Vercel. `APP_URL` musi odpowiadać dokładnej domenie danego wdrożenia. Nigdy nie kopiuj produkcyjnych kluczy do developmentu.
5. Wykonaj `pnpm db:migrate` na właściwej bazie ze skonfigurowanym `DATABASE_URL`. Migracje nie uruchamiają się automatycznie w każdym buildzie preview.
6. Utwórz administratora przez `pnpm admin:create` w zaufanym środowisku z tymczasowymi zmiennymi `ADMIN_EMAIL` i `ADMIN_PASSWORD`. Usuń te zmienne po utworzeniu konta.
7. Pozostaw `MAIL_ENABLED=false`. Wysyłkę prowadzi organizator poza panelem. Sprawdź import testowy, eksport kodów i pobieranie biletów.

Integracja GitHub z Vercel zapewnia preview pull requestów i wdrożenia z main. Workflow CI uruchamia lint, typy, testy, build, scenariusze HTTP oraz Playwright na oddzielnym PostgreSQL. Dla dynamicznych adresów preview ustaw `APP_URL` na konkretny adres wdrożenia lub przypisz stałą domenę preview; kontrola Origin celowo nie ufa dowolnemu nagłówkowi Host.

Sekrety: `DATABASE_URL`, `DATA_ENCRYPTION_KEY` (64 znaki hex), `TOKEN_PEPPER` (co najmniej 32 znaki), `CRON_SECRET` (co najmniej 32 znaki), `RESEND_API_KEY`. Generuj niezależne wartości, np. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Utrata klucza szyfrowania uniemożliwia odzyskanie zapisanych kodów. Kopie zapasowe bazy i kluczy przechowuj zgodnie z polityką fundacji.

## Sprawdzanie zmian

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Przy działającym serwerze i lokalnej bazie:

```sh
pnpm test:http
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Test HTTP tworzy lub wykorzystuje wydarzenie testowe i nigdy nie wysyła maili. Nie wskazuj mu produkcyjnej bazy. Testy awarii dostawcy zastępują wyłącznie zewnętrzny transport HTTP; cała kolejka i jej transakcje działają na izolowanym PostgreSQL.

## Stan weryfikacji

Sprawdzone lokalnie: lint, typecheck, testy jednostkowe i integracyjne, kompilacja, scenariusze HTTP dla 250 uczestników, logowanie administratora i uczestnika w przeglądarce, podgląd maila, widok mobilny 390 px i wygląd wygenerowanego PDF.

Do potwierdzenia po podłączeniu usług: rzeczywiste doręczenie Resend, zewnętrzny harmonogram, migracje na docelowym PostgreSQL, wdrożenia preview i produkcyjne oraz odczyt QR przez kamerę fizycznego iPhone'a i Androida. Pełny zestaw Playwright jest przygotowany do uruchomienia w CI; lokalna weryfikacja przeglądarkowa odbyła się przez przeglądarkę aplikacji z powodu ograniczeń uruchamiania Chrome w środowisku wykonawczym.

## Źródła techniczne

- [Next.js App Router](https://nextjs.org/docs/app)
- [Limity harmonogramu Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Idempotencja Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [PGlite Socket](https://pglite.dev/docs/pglite-socket)
- [Dystrybucja SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)
