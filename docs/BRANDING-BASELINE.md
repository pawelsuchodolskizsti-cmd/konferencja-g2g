# Zamrożony wygląd strony — sekcja organizatorów i partnerów

Punkt odniesienia: produkcyjne `main` przed optymalizacją, 20.10.2026.
Ta zmiana jest **wyłącznie optymalizacją transferu obrazów**, bez redesignu.
Dwie źródłowe grafiki pozostają w repozytorium bez zmian:
`public/branding/organizatorzy-zrodlo.jpg`,
`public/branding/partnerzy-biale-loga.png`.

## Co musi pozostać bez zmian

- Nagłówki: „Organizator i patronaci”, „Organizator”, „Patronat honorowy”,
  „Partner współzapraszający” i „Partnerzy projektu”.
- Kolejność i liczba: trzy karty organizatora/patronów i cztery logo partnerów.
- Tło, kolory, typografia, odstępy, obramowania, przycięcia i proporcje kart.
- Grid: organizatorzy 1 kolumna na telefonie i 3 od 800 px.
  Partnerzy 1 kolumna na telefonie, 2 od 600 px, 4 od 1000 px.
- Proporcje widocznego obrazu: `330:200` dla organizatora i `360:150` dla partnerów.
- Białe logo partnerów z istniejącym filtrem `partner-white-alpha`.
- Nic poza źródłem obrazów i wewnętrznym CSS ich wycinków nie powinno się zmienić.

## Oryginalne kadrowanie — wyliczone z CSS

Generator `scripts/generate-branding-crops.mjs` przechowuje dokładne
współrzędne dawnych pozycji `left`/`top`. Korzysta z istniejących
dwóch arkuszy źródłowych, renderuje je na płótnie odpowiadającym wcześniejszym
proporcjom i wycina te same pola w rozdzielczości 2x. Pliki wynikowe są
bezstratnymi WebP, aby nie zmienić żadnego piksela gotowego wycinka.

| Widoczna karta | Wycinek 2x | Źródło |
| --- | --- | --- |
| Organizator (One Day) | x=2080, y=1220, 660×400 | organizatorzy-zrodlo.jpg |
| Patronat honorowy | x=2080, y=1610, 660×400 | organizatorzy-zrodlo.jpg |
| Partner współzapraszający | x=2080, y=2040, 660×400 | organizatorzy-zrodlo.jpg |
| InCredibles | x=0, y=0, 720×300 | partnerzy-biale-loga.png |
| Presidential Hotel | x=720, y=0, 720×300 | partnerzy-biale-loga.png |
| Yummy | x=0, y=300, 720×300 | partnerzy-biale-loga.png |
| Garnizon Sztuki | x=720, y=300, 720×300 | partnerzy-biale-loga.png |

**Weryfikacja:** `tests/branding-crops.test.ts` porównuje po dekodowaniu
piksele siedmiu osobnych plików WebP z pikselami przyciętymi z oryginalnych
grafik według zapisanych współrzędnych. Dodatkowo pilnuje liczby obrazów,
proporcji kart i reguł responsywności. Standardowe testy przeglądarkowe
sprawdzają działanie strony. Gdy którykolwiek test nie przejdzie, nie
wdrażamy do produkcji.

Oryginalne źródła umożliwiają pełny powrót do wcześniejszego rozwiązania,
bez utraty jakości lub danych.
