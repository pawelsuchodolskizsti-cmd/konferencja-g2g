export function participantMailRecipients(person: {
  email: string;
  secondaryEmail?: string | null;
}) {
  const to = person.email.trim().toLowerCase();
  const secondary = person.secondaryEmail?.trim().toLowerCase();
  return { to, ...(secondary && secondary !== to ? { cc: secondary } : {}) };
}

export function mailAddresses(payload: { to: string; cc?: string }) {
  return [
    ...new Set(
      [payload.to, payload.cc]
        .filter((v): v is string => !!v)
        .map((v) => v.trim().toLowerCase()),
    ),
  ];
}
