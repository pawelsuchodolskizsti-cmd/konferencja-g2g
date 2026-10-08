import "server-only";

export function isDemoParticipant(person: { id: string; eventId: string }) {
  return (
    person.id === "7c39d3af-e608-4425-96f0-1905d542a133" &&
    person.eventId === "69de8147-7c7a-4a92-948f-60164f0cbba0"
  );
}
