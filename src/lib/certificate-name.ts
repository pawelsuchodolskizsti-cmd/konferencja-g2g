/** Polish singular genitive for the certificate's fixed “dla” label.
 * Conservative rules: unfamiliar/ambiguous forms stay unchanged and are marked
 * for admin review. The original participant identity is never overwritten.
 * Rules: https://poradniajezykowa.uw.edu.pl/porady/odmiana-nazwisk-2/
 * https://poradniajezykowa.uw.edu.pl/porady/odmiana-nazwisk-dwuczlonowych/
 */
type Gender = "female" | "male";
type Form = { text: string; review: boolean };

const femaleNames = new Set(
  `Ada Adela Adriana Adrianna Agata Agnieszka Aleksandra Alicja Alina Amelia Anastazja Andżelika
  Aneta Aniela Anita Anna Antonina Aurelia Balbina Barbara Beata Bianka Blanka Bogumiła Bogusława Bożena
  Bronisława Cecylia Celina Czesława Dagmara Danuta Daria Diana Dominika Dorota Edyta
  Eliza Elżbieta Emilia Ewa Ewelina Felicja Gabriela Gaja Grażyna Halina Hanna Helena
  Henryka Honorata Iga Ilona Irena Irmina Iwona Izabela Jadwiga Janina Joanna Jolanta
  Józefa Judyta Julia Justyna Kaja Kamila Karina Karolina Katarzyna Kazimiera Kinga
  Klara Klaudia Kornelia Krystyna Laura Lena Lidia Liliana Lucyna Ludmiła Luiza
  Łucja Magdalena Maja Małgorzata Marcelina Maria Marianna Marika Marlena Marta
  Martyna Marzena Matylda Melania Michalina Milena Mirosława Monika Nadia Natalia Nela Nina Oktawia Olga Oliwia Otylia
  Patrycja Paulina Pola Regina Renata Roksana Rozalia Róża Sabina Sandra Sara Sonia
  Stanisława Stefania Sylwia Tamara Teresa Urszula Waleria Wanda Weronika Wiesława
  Wiktoria Wioletta Zofia Zuzanna Zyta Żaneta`
    .toLocaleLowerCase("pl-PL")
    .split(/\s+/u),
);
const maleForms: Record<string, string> = Object.fromEntries(
  `Adam:Adama Adrian:Adriana Albert:Alberta Aleksander:Aleksandra Aleksy:Aleksego
  Andrzej:Andrzeja Antoni:Antoniego Arkadiusz:Arkadiusza Artur:Artura Bartłomiej:Bartłomieja
  Bartosz:Bartosza Błażej:Błażeja Bogdan:Bogdana Bogumił:Bogumiła Bogusław:Bogusława
  Bolesław:Bolesława Borys:Borysa Bronisław:Bronisława Cezary:Cezarego Czesław:Czesława
  Damian:Damiana Daniel:Daniela Dariusz:Dariusza Dawid:Dawida Dionizy:Dionizego
  Dominik:Dominika Edward:Edwarda Emil:Emila Ernest:Ernesta Eugeniusz:Eugeniusza
  Fabian:Fabiana Feliks:Feliksa Filip:Filipa Franciszek:Franciszka Gabriel:Gabriela
  Grzegorz:Grzegorza Gustaw:Gustawa Henryk:Henryka Hubert:Huberta Ignacy:Ignacego
  Igor:Igora Ireneusz:Ireneusza Jacek:Jacka Jakub:Jakuba Jan:Jana Janusz:Janusza
  Jarosław:Jarosława Jerzy:Jerzego Joachim:Joachima Józef:Józefa Julian:Juliana
  Juliusz:Juliusza Kacper:Kacpra Kajetan:Kajetana Kamil:Kamila Karol:Karola
  Kazimierz:Kazimierza Klaudiusz:Klaudiusza Konrad:Konrada Konstanty:Konstantego
  Krystian:Krystiana Krzysztof:Krzysztofa Ksawery:Ksawerego Kuba:Kuby Leon:Leona
  Leszek:Leszka Lucjan:Lucjana Ludwik:Ludwika Łukasz:Łukasza Maciej:Macieja
  Maksymilian:Maksymiliana Marcel:Marcela Marcin:Marcina Marek:Marka Marian:Mariana
  Mariusz:Mariusza Mateusz:Mateusza Michał:Michała Mieczysław:Mieczysława Mikołaj:Mikołaja
  Miłosz:Miłosza Mirosław:Mirosława Nikodem:Nikodema Norbert:Norberta Olaf:Olafa
  Oskar:Oskara Patryk:Patryka Paweł:Pawła Piotr:Piotra Przemysław:Przemysława
  Radosław:Radosława Rafał:Rafała Remigiusz:Remigiusza Robert:Roberta Roman:Romana
  Romuald:Romualda Ryszard:Ryszarda Sebastian:Sebastiana Sławomir:Sławomira
  Stanisław:Stanisława Stefan:Stefana Sylwester:Sylwestra Szymon:Szymona Tadeusz:Tadeusza
  Teodor:Teodora Tomasz:Tomasza Wacław:Wacława Waldemar:Waldemara Wiesław:Wiesława
  Wiktor:Wiktora Witold:Witolda Władysław:Władysława Włodzimierz:Włodzimierza
  Wojciech:Wojciecha Zbigniew:Zbigniewa Zdzisław:Zdzisława Zenon:Zenona Eryk:Eryka Emanuel:Emanuela Oliwier:Oliwiera Natan:Natana Tymon:Tymona Tymoteusz:Tymoteusza Seweryn:Seweryna Szczepan:Szczepana
  Zygmunt:Zygmunta`
    .split(/\s+/u)
    .map((pair) => pair.toLocaleLowerCase("pl-PL").split(":")),
);
const firstNameExceptions: Record<string, string> = {
  maja: "mai",
  kaja: "kai",
  gaja: "gai",
};
const surnameExceptions: Record<string, string> = {
  wróbel: "wróbla",
  dudek: "dudka",
  mazurek: "mazurka",
  marek: "marka",
  kurek: "kurka",
  szymczak: "szymczaka",
  stępień: "stępnia",
  kwiecień: "kwietnia",
  kozieł: "kozła",
  zając: "zająca",
  kot: "kota",
  pies: "psa",
  lew: "lwa",
  ziółek: "ziółka",
  kołodziej: "kołodzieja",
};
// Adjectival surnames without the unambiguous -ski/-cki/-dzki suffix.
const adjectives = new Set(
  `biały biała czarny czarna zielony zielona czerwony czerwona
  cichy cicha głuchy głucha mały mała nowy nowa młody młoda stary stara długi długa
  wysoki wysoka niski niska wielki wielka dobry dobra zły zła leśny leśna górny górna
  dolny dolna zimny zimna suchy sucha mokry mokra wesoły wesoła wolny wolna
  jasny jasna ciemny ciemna żelazny żelazna złoty złota`.split(/\s+/u),
);
const particles = new Set([
  "de",
  "del",
  "da",
  "di",
  "du",
  "van",
  "von",
  "der",
  "den",
  "la",
  "le",
]);
const polishLetters = /^[a-ząćęłńóśźż]+$/u;
const normalize = (value: string) =>
  value.normalize("NFC").replace(/\s+/gu, " ").trim();
function casing(original: string, inflected: string) {
  if (original === original.toLocaleUpperCase("pl-PL"))
    return inflected.toLocaleUpperCase("pl-PL");
  if (original[0] === original[0].toLocaleUpperCase("pl-PL"))
    return inflected[0].toLocaleUpperCase("pl-PL") + inflected.slice(1);
  return inflected;
}
function aEnding(word: string) {
  if (word.endsWith("ja")) return word.slice(0, -1) + "i";
  if (word.endsWith("ia")) return word.slice(0, -1) + "i";
  return word.slice(0, -1) + (/[kgl]a$/u.test(word) ? "i" : "y");
}
function lookup(
  values: Record<string, string>,
  key: string,
): string | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}
function givenName(word: string): Form {
  const lower = word.toLocaleLowerCase("pl-PL");
  const form =
    lookup(maleForms, lower) ||
    lookup(firstNameExceptions, lower) ||
    (femaleNames.has(lower) ? aEnding(lower) : undefined);
  return { text: form ? casing(word, form) : word, review: !form };
}
function surname(word: string, gender?: Gender): Form {
  const lower = word.toLocaleLowerCase("pl-PL");
  const unchanged = (review = false) => ({ text: word, review });
  const changed = (form: string) => ({
    text: casing(word, form),
    review: false,
  });
  if (particles.has(lower)) return unchanged();
  if (!gender || !polishLetters.test(lower)) return unchanged(true);
  if (gender === "female" && !lower.endsWith("a")) return unchanged();
  if (/(ski|cki|dzki)$/u.test(lower))
    return changed(lower.slice(0, -1) + "iego");
  if (/(ska|cka|dzka)$/u.test(lower))
    return changed(lower.slice(0, -1) + "iej");
  if (adjectives.has(lower)) {
    if (lower.endsWith("i")) return changed(lower.slice(0, -1) + "iego");
    if (lower.endsWith("y")) return changed(lower.slice(0, -1) + "ego");
    return changed(lower.slice(0, -1) + (/[kg]a$/u.test(lower) ? "iej" : "ej"));
  }
  if (lower.endsWith("a")) {
    // -ia/-ja and possessive adjectives can depend on the name's origin.
    if (/(ia|ja|owa)$/u.test(lower)) return unchanged(true);
    return changed(aEnding(lower));
  }
  const exception = lookup(surnameExceptions, lower);
  if (exception) return changed(exception);
  // Alternations in names such as Kozioł, Kozieł, Wróbel or foreign names
  // cannot be recovered safely from a suffix alone.
  if (/(ek|ec|eć|eł|el|eń|er|ieł|ioł|ąb|o|e|i|y|u)$/u.test(lower))
    return unchanged(true);
  const soft = lookup({ ć: "c", ń: "n", ś: "s", ź: "z" }, lower.slice(-1));
  if (soft) return changed(lower.slice(0, -1) + soft + "ia");
  if (/[bcdfghjklłmnprstwyzż]$/u.test(lower)) return changed(lower + "a");
  return unchanged(true);
}
function parts(value: string, decline: (word: string) => Form) {
  // Preserve spaces, hyphens and their common typographic variants.
  const forms = value
    .split(/([\s\-‐‑–]+)/u)
    .map((part) =>
      /^[\s\-‐‑–]*$/u.test(part)
        ? { text: part, review: false }
        : decline(part),
    );
  return {
    text: forms.map((part) => part.text).join(""),
    review: forms.some((part) => part.review),
  };
}
export function certificateName(person: {
  firstName: string;
  lastName: string;
  certificateNameOverride?: string | null;
}) {
  const firstName = normalize(person.firstName);
  const lastName = normalize(person.lastName);
  const first = firstName.split(/[\s\-‐‑–]+/u)[0].toLocaleLowerCase("pl-PL");
  const gender: Gender | undefined = lookup(maleForms, first)
    ? "male"
    : femaleNames.has(first)
      ? "female"
      : undefined;
  const given = parts(firstName, givenName);
  const family = parts(lastName, (word) => surname(word, gender));
  const automatic = `${given.text} ${family.text}`.trim();
  const override = normalize(person.certificateNameOverride || "");
  return {
    automatic,
    value: override || automatic,
    manual: !!override,
    needsReview: !override && (given.review || family.review),
  };
}
