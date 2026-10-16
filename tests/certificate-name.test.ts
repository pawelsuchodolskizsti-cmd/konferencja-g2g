import { expect, test } from "vitest";
import { certificateName } from "../src/lib/certificate-name";

test.each([
  ["Żaneta", "Łącka-Świętochowska", "Żanety Łąckiej-Świętochowskiej"],
  ["Anna", "Nowak", "Anny Nowak"],
  ["Jan", "Kowalski", "Jana Kowalskiego"],
  ["Paweł", "Suchodolski", "Pawła Suchodolskiego"],
  ["Marek", "Nowak", "Marka Nowaka"],
  ["Piotr", "Wiśniewski", "Piotra Wiśniewskiego"],
  ["Julia", "Wójcik", "Julii Wójcik"],
  ["Zofia", "Duda", "Zofii Dudy"],
  ["Maja", "Konopka", "Mai Konopki"],
  ["Kaja", "Cebula", "Kai Cebuli"],
  ["Maria", "Skłodowska-Curie", "Marii Skłodowskiej-Curie"],
  ["Anna Maria", "Nowak-Kowalska", "Anny Marii Nowak-Kowalskiej"],
  ["Jan Piotr", "Nowak-Kowalski", "Jana Piotra Nowaka-Kowalskiego"],
  ["Jan", "Dudek", "Jana Dudka"],
  ["Anna", "Dudek", "Anny Dudek"],
  ["Anna", "Cichy", "Anny Cichy"],
  ["Jan", "Cichy", "Jana Cichego"],
  ["Beata", "Biała", "Beaty Białej"],
  ["Jerzy", "Długi", "Jerzego Długiego"],
  ["Katarzyna", "Wrona", "Katarzyny Wrony"],
  ["Jan", "Karaś", "Jana Karasia"],
  ["Kuba", "Kowalski", "Kuby Kowalskiego"],
  ["ANNA", "KOWALSKA", "ANNY KOWALSKIEJ"],
  ["Żaneta", "Łącka‑Świętochowska", "Żanety Łąckiej‑Świętochowskiej"],
])("%s %s → %s", (firstName, lastName, expected) => {
  expect(certificateName({ firstName, lastName })).toMatchObject({
    value: expected,
    automatic: expected,
    manual: false,
    needsReview: false,
  });
});

test.each([
  ["Andrea", "Rossi"],
  ["Alex", "Nowak"],
  ["Jean", "Dupont"],
  ["constructor", "toString"],
  ["Jan", "Gołąb"],
  ["Jan", "Kozioł"],
  ["Jan", "Müller"],
])(
  "flags uncertain names without inventing a form: %s %s",
  (firstName, lastName) => {
    const result = certificateName({ firstName, lastName });
    expect(result.needsReview).toBe(true);
    expect(result.value).toContain(lastName);
  },
);

test("manual correction wins; clearing it restores automatic inflection", () => {
  const person = { firstName: "Jan", lastName: "Kozioł" };
  expect(
    certificateName({ ...person, certificateNameOverride: " Jana Kozioła " }),
  ).toMatchObject({
    value: "Jana Kozioła",
    manual: true,
    needsReview: false,
  });
  expect(
    certificateName({ ...person, certificateNameOverride: "   " }),
  ).toMatchObject({
    value: "Jana Kozioł",
    manual: false,
    needsReview: true,
  });
  expect(person).toEqual({ firstName: "Jan", lastName: "Kozioł" });
});

test("normalizes Unicode and whitespace without losing Polish letters", () => {
  expect(
    certificateName({
      firstName: "  Żaneta  ".normalize("NFD"),
      lastName: " Łącka ",
    }).value,
  ).toBe("Żanety Łąckiej");
});
