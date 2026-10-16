import { certificateName } from "./certificate-name";
export type ParticipantFilter = { q?: string; filter?: string; ids?: string[] };
export function filterParticipants<
  T extends {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    accessCode?: string;
    checkedInAt?: unknown;
    certificateGeneratedAt?: unknown;
    certificateNameOverride?: string | null;
  },
>(people: T[], selection: ParticipantFilter) {
  const q = (selection.q || "").trim().toLocaleLowerCase("pl");
  return people.filter(
    (p) =>
      (!selection.ids || selection.ids.includes(p.id)) &&
      `${p.firstName} ${p.lastName} ${p.email} ${p.accessCode || ""}`
        .toLocaleLowerCase("pl")
        .includes(q) &&
      (!selection.filter ||
        selection.filter === "all" ||
        (selection.filter === "present" && !!p.checkedInAt) ||
        (selection.filter === "absent" && !p.checkedInAt) ||
        (selection.filter === "certificate" && !!p.certificateGeneratedAt) ||
        (selection.filter === "name-review" && certificateName(p).needsReview)),
  );
}
