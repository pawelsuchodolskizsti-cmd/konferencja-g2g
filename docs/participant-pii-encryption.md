# Szyfrowanie danych uczestników

Imię, nazwisko, e-mail i opcjonalna korekta imienia/nazwiska na certyfikacie
są zapisywane jako AES-256-GCM z losowym IV, znacznikiem wersji i AAD wiążącym
szyfrogram z nazwą pola. Klucz PII jest wyprowadzany przez HKDF-SHA256 z istniejącego
DATA_ENCRYPTION_KEY z osobnym kontekstem. Klucz nie jest zapisywany w bazie.
Nie wolno zmieniać ani usuwać klucza bez kontrolowanej migracji i zachowania
poprzedniego klucza; jest również potrzebny do istniejących archiwów i kodów.

Podglądy importu są szyfrowane w całości (JSON w kopercie jsonb), także przed
zatwierdzeniem importu. Kolejka mailowa i archiwa miały szyfrowanie wcześniej.
Konta administratorów nie są objęte tą zmianą. Eksporty pobrane przez uprawnioną
osobę, wiadomości i certyfikaty zawierają czytelne dane zgodnie z ich przeznaczeniem.
Nie jest to szyfrowanie end-to-end ani zabezpieczenie przed przejęciem aplikacji
wraz z jej kluczem. Starsze kopie i historia bazy mogą zawierać wcześniejszy zapis.

## Wdrożenie i odtwarzanie

1. Wdrożyć wersję zgodną z odczytem starych i nowych pól, zapisującą wyłącznie
   szyfrogramy. Sprawdzić wdrożenie i pełne CI przed migracją istniejących kont.
2. Dopiero potem uruchomić migrateParticipantPii w skrypcie migracji. Transakcja
   blokuje zapisy w dwóch tabelach na czas konwersji, odszyfrowuje i porównuje
   wszystkie wartości, w tym niezmienione identyfikatory, kody i znaczniki czasu.
   Błąd wycofuje całą transakcję. Logowany jest tylko wynik i liczby rekordów.
3. Ograniczenia CHECK blokują ponowny jawny zapis z nieaktualnego narzędzia.
   Ponowne uruchomienie migracji weryfikuje dane bez ponownego szyfrowania.

Po migracji NIE cofać aplikacji do wersji sprzed obsługi szyfrowania. Bezpiecznym
punktem cofnięcia jest wersja z etapu 1. Przy odtwarzaniu starszej kopii bazy
zachować klucz i uruchomić migrację przed ponownym dopuszczeniem zapisów.

Sortowanie nazwisk odbywa się po odszyfrowaniu w aplikacji. Import wykrywa
duplikaty na podstawie odszyfrowanej tożsamości uczestnika; wspólny e-mail
różnych osób pozostaje dozwolony. Odszyfrowanie przez mapowanie ORM nie zmienia
kontroli uprawnień, zasad wydawania certyfikatów ani zasad wysyłki.
