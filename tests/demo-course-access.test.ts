import { expect, test } from "vitest";
import { coursesAvailableForParticipant } from "../src/server/demo-participant";
const demo = {
  id: "7c39d3af-e608-4425-96f0-1905d542a133",
  eventId: "69de8147-7c7a-4a92-948f-60164f0cbba0",
};
test("only the designated demo account bypasses the manual course lock", () => {
  expect(coursesAvailableForParticipant(demo, { coursesUnlocked: false })).toBe(
    true,
  );
  expect(
    coursesAvailableForParticipant(
      { ...demo, id: "another-person" },
      { coursesUnlocked: false },
    ),
  ).toBe(false);
  expect(
    coursesAvailableForParticipant(
      { ...demo, eventId: "another-event" },
      { coursesUnlocked: false },
    ),
  ).toBe(false);
  expect(
    coursesAvailableForParticipant(
      { ...demo, id: "another-person" },
      { coursesUnlocked: true },
    ),
  ).toBe(true);
});
