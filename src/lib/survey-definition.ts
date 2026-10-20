export type QuestionKind = "text" | "single" | "multiple" | "matrix";
export type QuestionDefinition = {
  title: string;
  kind: QuestionKind;
  options?: string[];
  rows?: string[];
  optional?: boolean;
  hint?: string;
  exclusive?: string[];
  other?: string;
};
export const surveyIntro =
  "Dziękujemy za udział! Poświęć nam do 5 minut. Twoje odpowiedzi pomogą nam ulepszać kolejne wydarzenia, planować dalsze wsparcie i przedstawiać efekty konferencji. Liczy się szczera opinia.";
export const surveyThanks =
  "Dziękujemy! Twoja opinia pomoże nam zdecydować, co rozwijać dalej.";
const historicalSurveyDefinition: QuestionDefinition[] = [
  {
    title: "W jakiej roli przede wszystkim uczestniczysz w konferencji?",
    kind: "single",
    options: [
      "Wychowawca/wychowawczyni.",
      "Dyrektor/dyrektorka lub osoba kierująca zespołem.",
      "Psycholog/psycholożka, pedagog/pedagożka lub terapeuta/terapeutka.",
      "Rodzic zastępczy lub osoba prowadząca rodzinny dom dziecka.",
      "Koordynator/koordynatorka lub inny specjalista pieczy zastępczej.",
      "Przedstawiciel/przedstawicielka organizacji wspierającej.",
      "Inna rola.",
      "Wolę nie odpowiadać.",
    ],
  },
  {
    title:
      "Na ile treści konferencji były przydatne w Twojej pracy lub działaniach?",
    kind: "single",
    options: [
      "1 - zupełnie nieprzydatne",
      "2 - mało przydatne",
      "3 - umiarkowanie przydatne",
      "4 - przydatne",
      "5 - bardzo przydatne",
      "Nie dotyczy / trudno ocenić",
    ],
  },
  {
    title: "W jakim stopniu konferencja pomogła Ci w poniższych obszarach?",
    kind: "matrix",
    hint: "Oceń każdy obszar osobno.",
    rows: [
      "Lepsze rozumienie własnych granic w pomaganiu.",
      "Naładowałem/am swoje baterie na nowo.",
      "Zrozumiałam/em, że ja też jestem ważna/y.",
      "Poznanie sposobów dbania o własne zasoby i obniżania napięcia.",
      "Spojrzenie na wsparcie z perspektywy młodej osoby.",
      "Poznanie pomysłów na wspieranie usamodzielniania młodzieży.",
      "Otwarcie się na nowe rozwiązania - dużo nowych inspiracji.",
      "Większe zaufanie do Fundacji One Day.",
    ],
    options: [
      "1 - wcale",
      "2 - w niewielkim stopniu",
      "3 - w umiarkowanym stopniu",
      "4 - w dużym stopniu",
      "5 - w bardzo dużym stopniu",
      "Nie dotyczy / trudno ocenić",
    ],
  },
  {
    title: "Które części programu były dla Ciebie najbardziej przydatne?",
    kind: "multiple",
    options: [
      "„Jak dawać siłę, nie tracąc własnej” - Joanna Chmura.",
      "„Pomaganie ma granice” - Michał Sasin.",
      "„Ciało wie” - Adam Adamonis.",
      "Wystąpienie Doroty Wilczury o roli dyrektora.",
      "Film i panel „Dyrektor z powołania, Wychowawca z powołania” - Małgorzata Domagalik.",
      "Rozmowa z podopiecznymi Fundacji One Day - Magdalena Mielcarz.",
      "Wystąpienie Tatiany Mindewicz-Puacz o wspieraniu młodzieży.",
      "„Od zależności do samodzielności” - Renata Fijałkowska.",
      "Żadna.",
      "Trudno wskazać.",
    ],
    exclusive: ["Żadna.", "Trudno wskazać."],
  },
  {
    title:
      "Czy w najbliższych 30 dniach planujesz wykorzystać coś z konferencji?",
    kind: "text",
    hint: "Jeśli tak, to co?",
  },
  {
    title: "W jakich obszarach najbardziej potrzebujesz dalszego wsparcia?",
    kind: "multiple",
    options: [
      "Przeciążenie i regeneracja.",
      "Stawianie granic w pomaganiu.",
      "Praca indywidualna, superwizja.",
      "Budowanie relacji z młodymi osobami.",
      "Reagowanie na kryzysy psychiczne młodzieży.",
      "Wspieranie usamodzielniania.",
      "Współpraca w zespole i między instytucjami.",
      "Kierowanie placówką i wspieranie pracowników.",
      "Inny obszar.",
      "Obecnie nie potrzebuję dalszego wsparcia.",
    ],
    other: "Inny obszar.",
    exclusive: ["Obecnie nie potrzebuję dalszego wsparcia."],
  },
  {
    title:
      "Z jakiej formy dalszego wsparcia najchętniej skorzystasz, gdyby była taka możliwość?",
    kind: "single",
    options: [
      "Warsztaty z praktycznymi ćwiczeniami.",
      "Superwizja pracy z podopiecznymi.",
      "Grupa wymiany doświadczeń.",
      "Indywidualne konsultacje ze specjalistą.",
      "Krótkie spotkania online.",
      "Materiały i narzędzia do wykorzystania w pracy.",
      "Kolejna konferencja.",
      "Inna forma.",
      "Obecnie nie planuję korzystać.",
    ],
  },
  {
    title: "Jak oceniasz organizację konferencji jako całość?",
    kind: "single",
    options: [
      "1 - bardzo źle",
      "2 - źle",
      "3 - ani dobrze, ani źle",
      "4 - dobrze",
      "5 - bardzo dobrze",
      "Trudno ocenić",
    ],
  },
  {
    title: "Co przede wszystkim chcesz nam przekazać po konferencji?",
    kind: "text",
    optional: true,
    hint: "Pytanie opcjonalne. Wystarczy jedno zdanie: ważna myśl, brakujący temat lub sugestia zmiany.",
  },
  {
    title:
      "Gdybyś potrzebował(a) noclegu przy kolejnej konferencji, czy ponownie wybrał(a)byś hotel Presidential?",
    kind: "single",
    hint: "Tylko dla osób, które nocowały w proponowanym hotelu. Załóż taki sam zakres pobytu.",
    options: [
      "Tak, również przy tej samej cenie.",
      "Tak, ale pod warunkiem niższej ceny.",
      "Wolał(a)bym inny hotel.",
      "Trudno powiedzieć.",
    ],
  },
  {
    title: "Co zdecydowało o nieskorzystaniu z proponowanego hotelu?",
    kind: "multiple",
    hint: "Tylko dla osób, które nie nocowały w proponowanym hotelu.",
    options: [
      "Nie potrzebowałem/am noclegu.",
      "Miałem/am nocleg w innym miejscu.",
      "Cena 220 zł za osobę w pokoju dwuosobowym była za wysoka.",
      "Potrzebowałem/am jedynki, ale cena 399 zł była za wysoka.",
      "Obowiązki uniemożliwiały mi pozostanie na noc.",
      "Lokalizacja hotelu mi nie odpowiadała.",
      "Inny powód.",
    ],
  },
];
export const surveyDefinition: QuestionDefinition[] = historicalSurveyDefinition
  .slice(0, 9)
  .map((q, i) =>
    i === 2
      ? {
          ...q,
          rows: [
            "Lepiej rozumiem własne granice w pomaganiu.",
            "Naładowałem/am swoje baterie na nowo.",
            "Zrozumiałem/am, że ja też jestem ważny/a.",
            "Poznałem/am sposoby dbania o własne zasoby i obniżania napięcia.",
            "Spojrzałem/am na wsparcie z perspektywy młodej osoby.",
            "Poznałem/am nowe pomysły na wspieranie usamodzielniania młodzieży.",
            "Otworzyłem/am się na nowe rozwiązania i zyskałem/am wiele inspiracji.",
          ],
        }
      : q,
  );
export function currentSurveyQuestions(questions: string[]) {
  return questions.length === 11 ? questions.slice(0, 9) : questions;
}
export type SurveyAnswer = {
  text: string;
  selected: string[];
  ratings: string[];
};
export const emptyAnswer = (): SurveyAnswer => ({
  text: "",
  selected: [],
  ratings: [],
});
export function definitionFor(questions: string[]): QuestionDefinition[] {
  return questions.map((title, index) =>
    questions.length === 9
      ? { ...surveyDefinition[index], title }
      : questions.length === 11
        ? { ...historicalSurveyDefinition[index], title }
        : { title, kind: "text" },
  );
}
export function answerError(
  q: QuestionDefinition,
  a: SurveyAnswer,
): string | null {
  if (a.text.length > 5000) return "Odpowiedź może mieć najwyżej 5000 znaków.";
  if (q.kind === "text")
    return !q.optional && !a.text.trim()
      ? "Wpisz odpowiedź, aby przejść dalej."
      : null;
  if (q.kind === "matrix")
    return a.ratings.length !== q.rows!.length ||
      a.ratings.some((v) => !q.options!.includes(v))
      ? "Oceń każdy z podanych obszarów."
      : null;
  if (!a.selected.length) return "Wybierz odpowiedź, aby przejść dalej.";
  if (
    new Set(a.selected).size !== a.selected.length ||
    a.selected.some((v) => !q.options!.includes(v))
  )
    return "Wybierz odpowiedzi z listy.";
  if (a.selected.length > (q.kind === "single" ? 1 : 2))
    return q.kind === "single"
      ? "Wybierz jedną odpowiedź."
      : "Wybierz maksymalnie dwie odpowiedzi.";
  if (a.selected.length > 1 && a.selected.some((v) => q.exclusive?.includes(v)))
    return "Tej odpowiedzi nie można łączyć z pozostałymi.";
  if (q.other && a.selected.includes(q.other) && !a.text.trim())
    return "Opisz inny obszar wsparcia.";
  return null;
}
export function formatAnswer(q: QuestionDefinition, a: SurveyAnswer): string {
  if (q.kind === "text") return a.text.trim();
  if (q.kind === "matrix")
    return q.rows!.map((row, i) => `${row}: ${a.ratings[i]}`).join("\n");
  return a.selected
    .map((value) => (value === q.other ? `${value} ${a.text.trim()}` : value))
    .join("\n");
}
