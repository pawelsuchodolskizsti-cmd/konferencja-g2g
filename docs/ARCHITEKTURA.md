# Architektura systemu konferencji

## Cel i granice modułów

Aplikacja Next.js z App Router obsługuje panel organizatora, publiczny program oraz strefę uczestnika. PostgreSQL jest jedynym źródłem prawdy dla obecności, sesji, przydzielonych kodów i kolejki pocztowej. Drizzle opisuje schemat i generuje migracje SQL. Interfejs korzysta z TypeScript i Tailwind CSS.

Moduły: konfiguracja wydarzeń, administratorzy i sesje, import uczestników, obecność, komunikacja, szkolenia, certyfikaty, dziennik operacji. Logika biznesowa znajduje się w `src/server`, niezależnie od komponentów. Wszystkie mutacje wymagają autoryzacji i kontroli pochodzenia żądania. Publiczny program zawiera wyłącznie jawne pola wydarzenia.

## Model relacyjny

| Tabela                      | Przeznaczenie i ograniczenia                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| events                      | UUID, unikalny slug, organizator, lokalizacja, początek i koniec, odblokowanie certyfikatów, program, szablon maila  |
| admins                      | UUID, unikalny znormalizowany e-mail, hasło scrypt, aktywność                                                        |
| admin_events                | Dostęp administratora do konkretnego wydarzenia                                                                      |
| participants                | UUID, event_id, dane kontaktowe, unikalny e-mail w wydarzeniu, skróty kodów i zaszyfrowane dane potrzebne do wysyłki |
| attendance                  | Jeden wpis na uczestnika, czas, metoda QR/MANUAL, administrator                                                      |
| sessions                    | Skrót losowego tokenu sesji, administrator lub uczestnik, termin wygaśnięcia                                         |
| import_batches              | Tymczasowa, zatwierdzana partia importu, ważność, właściciel i wynik walidacji                                       |
| email_logs                  | Trwałe zadania INVITATION/CERTIFICATE, status, próby, blokada, identyfikator providera, niezmienny payload           |
| training_courses            | Wydarzenie, nazwa, platforma, adres HTTPS, model SHARED/INDIVIDUAL                                                   |
| training_codes              | Pula kodów, unikalny skrót kodu, szyfrowana treść                                                                    |
| participant_training_access | Unikalna para uczestnik/kurs i unikalny przydzielony kod                                                             |
| certificates                | Jeden certyfikat uczestnika, unikalny numer, czas generacji                                                          |
| audit_logs                  | Zdarzenie, identyfikator administratora, identyfikator obiektu, czas; bez treści maili i nazwisk                     |
| rate_limits                 | Atomowe liczniki prób logowania współdzielone przez instancje Vercel                                                 |

Obecność i uprawnienia są wyliczane z relacji, zamiast utrzymywania kilku niezależnych flag. Wysłany mail oznacza akceptację wiadomości przez dostawcę, nie potwierdzenie jej doręczenia do skrzynki.

## Zasady dostępu

Kod uczestnika ma 6 losowych znaków A-Z i 0-9. Unikalność w całej bazie wymusza indeks access_hash; import losuje ponownie przy kolizji. Wcześniej wydane długie kody pozostają obsługiwane przy logowaniu. QR ma niezależny token 256-bitowy. Baza przechowuje skróty HMAC do wyszukiwania i AES-256-GCM do odtworzenia danych w mailingu. Klucze są oddzielne dla każdego środowiska. Sesje mają losowe tokeny i ciasteczka HttpOnly, Secure na HTTPS, SameSite=Lax. Każdy endpoint administratora sprawdza przypisanie do wydarzenia.

GET na adresie QR nigdy nie zmienia obecności. Skaner wysyła POST jako zalogowany administrator. Ponowny check-in korzysta z ograniczenia UNIQUE i zachowuje pierwszy czas wejścia. Dostęp do materiałów i kursów wymaga wpisu obecności. Certyfikat dodatkowo wymaga zakończenia wydarzenia i osiągnięcia daty odblokowania. Dane osoby pochodzą wyłącznie z sesji i bazy.

Import jest dwufazowy: walidacja i podgląd, następnie zatwierdzenie poprawnych wierszy. Ograniczenia wielkości pliku, liczby wierszy i rozpakowanej zawartości chronią parser. Zapis uczestników i audytu odbywa się w transakcji. Unikalność w bazie chroni także przed jednoczesnymi importami.

## Kolejka wiadomości

POST administratora tworzy zadania w bazie i od razu kończy żądanie. Chroniony worker uruchamiany przez zewnętrzny harmonogram HTTP co minutę pobiera małe partie przez FOR UPDATE SKIP LOCKED. Każde zadanie posiada lease, ograniczoną liczbę prób i rosnące opóźnienie. Stały klucz idempotencji Resend zapobiega duplikatom w oknie dostawcy. Niejednoznaczny wynik starszy niż 23 godziny wymaga sprawdzenia w panelu dostawcy przed ponowieniem; system nie obiecuje nieograniczonego exactly-once.

Payload wiadomości jest utrwalany przy pierwszej próbie. Zmiana wydarzenia nie zmienia ponawianego żądania. Awaria pojedynczej wiadomości nie zatrzymuje pozostałych. Preview i development blokują rzeczywistą wysyłkę.

## Środowiska i wdrożenie

Development korzysta z lokalnego PostgreSQL. Testy integracyjne uruchamiają izolowany PostgreSQL przez PGlite. Preview i production wymagają oddzielnych baz, kluczy i konfiguracji. Repozytorium nie zawiera plików uczestników ani sekretów. GitHub Actions wykonuje lint, typecheck, testy i build. Integracja GitHub z Vercel tworzy preview pull requestów oraz produkcję z main. Migracje są kontrolowanym krokiem wdrożenia, nie skutkiem żądania HTTP.

Do produkcji potrzebne będą: repozytorium GitHub, projekt Vercel, PostgreSQL, zweryfikowana domena nadawcy Resend i sekrety środowiska. Dla wybranego Vercel Hobby stosujemy zewnętrzny harmonogram HTTP. Endpoint wymaga nagłówka Authorization z CRON_SECRET.

## Plan implementacji

1. Szkielet aplikacji, schemat, migracja i testy ograniczeń bazy.
2. Sesje administratorów, kontrola dostępu do wydarzeń i konfiguracja wydarzenia.
3. Import z podglądem, lista, filtry i eksport obecności.
4. Trwała kolejka, personalizacja, QR i ponawianie błędów.
5. Skaner oraz ręczna obecność i statystyki.
6. Program publiczny, logowanie kodem i serwerowa kontrola uprawnień.
7. Kursy wspólne i indywidualne, import puli i atomowy przydział.
8. PDF z polskimi znakami, pobieranie i wysyłka certyfikatu.
9. Retencja, audyt, testy integracyjne i przeglądarkowe.
10. Podłączenie usług, próbna wysyłka, kontrola urządzeń i wdrożenie.

Po każdym module: lint, typecheck i testy. Przed produkcją: pełny przepływ dla 250 syntetycznych uczestników, równoległy check-in i przydział kodów, błędy dostawcy, bezpośrednie próby pobrania benefitów bez obecności, podgląd PDF i skanowanie fizycznym telefonem.

## Dokumentacja dostawców

- [Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)
- [Idempotencja Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)
