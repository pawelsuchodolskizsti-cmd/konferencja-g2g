// Identity is scoped to one conference by callers. Preserve Polish letters.
export function participantIdentity(person: {
  firstName: string;
  lastName: string;
  email: string;
}) {
  const name = (value: string) =>
    value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");
  return JSON.stringify([
    name(person.firstName),
    name(person.lastName),
    person.email.trim().toLowerCase(),
  ]);
}
