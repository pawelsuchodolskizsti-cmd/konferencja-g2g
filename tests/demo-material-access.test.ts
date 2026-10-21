import { expect, test, vi } from "vitest";
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [{ action: "MATERIALS_LOCKED" }],
          }),
        }),
      }),
    }),
  }),
}));
import { materialsAvailableForParticipant } from "../src/server/material-access";
const demo = {
  id: "7c39d3af-e608-4425-96f0-1905d542a133",
  eventId: "69de8147-7c7a-4a92-948f-60164f0cbba0",
};
test("locked materials are available only to the designated demo account", async () => {
  expect(await materialsAvailableForParticipant(demo)).toBe(true);
  expect(
    await materialsAvailableForParticipant({ ...demo, id: "other-person" }),
  ).toBe(false);
  expect(
    await materialsAvailableForParticipant({ ...demo, eventId: "other-event" }),
  ).toBe(false);
});
