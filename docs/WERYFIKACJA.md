# Weryfikacja lokalna

Data: 6 października 2026 r. Testy wykorzystują wyłącznie dane syntetyczne.

## Wyniki

- Kompilacja produkcyjna Next.js: zakończona powodzeniem.
- ESLint i TypeScript: bez błędów.
- Vitest: 15 testów w 6 plikach zakończonych powodzeniem.
- Testy HTTP działającej aplikacji: 11 scenariuszy zakończonych powodzeniem, w tym import 250 uczestników, odrzucanie błędnych wierszy, powtórny import, kontrola uprawnień, wielokrotne potwierdzenie obecności, przydział kodów, blokada świadczeń dla nieobecnych, certyfikaty, materiały, kolejka i eksport.
- Testy kolejki sprawdzają awarię dostawcy, kontynuowanie innych wysyłek, stały klucz idempotencji, niezmienność treści ponowienia i zatrzymanie niejednoznacznych wysyłek po 23 godzinach. Transport mailowy jest w tych testach symulowany.
- Przeglądarka: sprawdzono logowanie, panel administratora, podgląd wiadomości, publiczny program, panel uczestnika przy szerokości 390 px oraz pobranie PDF.
- Certyfikat PDF wyrenderowano i oceniono wizualnie, w tym polskie znaki.
- Lokalna baza wykorzystuje silnik PostgreSQL przez PGlite. Nie jest to test obciążeniowy wieloprocesowego serwera PostgreSQL.

## Do sprawdzenia po podłączeniu usług

- Wdrożenie na koncie Vercel i migracje na docelowej bazie PostgreSQL.
- Rzeczywista wysyłka Resend z potwierdzonej domeny i odbiór wiadomości.
- Zewnętrzny harmonogram HTTP co minutę, uwierzytelniony nagłówkiem Authorization. Projekt nie wymaga Vercel Cron.
- Fizyczna kamera na telefonach z Androidem i iOS.
- Pełny zestaw Playwright na Chromium i WebKit. Konfiguracja i workflow GitHub Actions są przygotowane, ale lokalne uruchomienie przeglądarek Playwright blokowało środowisko Windows. Interfejs sprawdzono osobno w przeglądarce Codex.
- Kopie zapasowe i odtworzenie docelowej bazy, monitoring błędów i termin usuwania danych uzgodniony z organizatorem.

Nie wysłano rzeczywistych wiadomości. Lokalna konfiguracja ma wyłączony mailing. Repozytorium i paczka nie zawierają haseł, kluczy, lokalnej bazy ani arkuszy uczestników.
