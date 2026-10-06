export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Nie udało się wykonać operacji.");
  return data as T;
}
export function dateTime(value: string | Date | null, zone = "Europe/Warsaw") {
  return value
    ? new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: zone,
      }).format(new Date(value))
    : "Brak";
}
export type EventData = {
  id: string;
  slug: string;
  name: string;
  organizer: string;
  location: string;
  startsAt: string;
  endsAt: string;
  certificateUnlockAt: string;
  timezone: string;
  published: boolean;
  info: string;
  mailSubject: string;
  mailBody: string;
  mailFrom: string;
  retentionUntil: string | null;
  agenda: { title: string; speaker: string; start: string; end: string }[];
};
export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedInAt: string | null;
  method: string | null;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: string | null;
  certificateGeneratedAt: string | null;
};
export type Course = {
  id: string;
  name: string;
  platform: string;
  url: string;
  mode: string;
  total: number;
  assigned: number;
};
export type Overview = {
  event: EventData;
  people: Person[];
  courses: Course[];
  audit: {
    id: string;
    action: string;
    adminId: string | null;
    createdAt: string;
  }[];
  mailEnabled: boolean;
  materials: { id: string; title: string }[];
};
