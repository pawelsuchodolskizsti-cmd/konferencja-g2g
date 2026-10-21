import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  id: "7c39d3af-e608-4425-96f0-1905d542a133",
  present: true,
}));
vi.mock("@/server/attendance", () => ({
  presentParticipant: async () => {
    if (!state.present)
      throw Object.assign(new Error("Obecność nie została potwierdzona."), {
        status: 403,
      });
    return {
      person: { id: state.id, eventId: "69de8147-7c7a-4a92-948f-60164f0cbba0" },
      event: { coursesUnlocked: false },
    };
  },
}));
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          {
            id: "actual-course",
            name: "Actual course",
            mode: "SHARED",
            sharedCode: null,
            url: "https://example.org",
          },
        ],
      }),
    }),
  }),
}));
import { participantCourses } from "../src/server/training";
test("demo receives configured courses while the event gate remains closed", async () => {
  expect(await participantCourses(state.id)).toMatchObject([
    { id: "actual-course", available: true },
  ]);
  state.id = "ordinary-participant";
  await expect(participantCourses(state.id)).rejects.toMatchObject({
    status: 403,
  });
  state.id = "7c39d3af-e608-4425-96f0-1905d542a133";
  state.present = false;
  await expect(participantCourses(state.id)).rejects.toMatchObject({
    status: 403,
  });
});
