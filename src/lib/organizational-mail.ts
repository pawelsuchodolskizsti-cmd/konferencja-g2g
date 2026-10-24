import { formatMailBody } from "./mail-format";

export const organizationalDefaultSubject = "Ważne informacje przed konferencją Głowa do Góry";

export const organizationalDefaultBody = `Dzień dobry {{firstName}},

Przypominamy najważniejsze informacje dotyczące konferencji {{eventName}}.

Termin: {{date}}
Miejsce: {{location}}

Strefa uczestnika: {{panelUrl}}
Twój indywidualny kod dostępu: {{accessCode}}

Przy wejściu pokaż kod QR ze swojej strefy uczestnika.

Pozdrawiamy,
Fundacja One Day`;

export type OrganizationalTemplateValues = Record<
  "firstName" | "lastName" | "eventName" | "date" | "location" | "accessCode" | "panelUrl",
  string
>;

export function renderOrganizationalSubject(
  subject: string,
  values: OrganizationalTemplateValues,
) {
  return subject.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key as keyof OrganizationalTemplateValues] ?? "");
}

export function renderOrganizationalBody(
  body: string,
  values: OrganizationalTemplateValues,
) {
  return formatMailBody(body, values, values.panelUrl);
}
