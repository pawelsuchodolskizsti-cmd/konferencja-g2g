import { expect, test } from "vitest";
import { adminPermission } from "../src/lib/admin-permissions";
const path = (suffix: string) => [
  "events",
  "event-id",
  ...suffix.split("/").filter(Boolean),
];
test("controller read and export allowlist", () => {
  for (const route of [
    "",
    "survey",
    "survey-export",
    "survey-summary",
    "privacy",
    "history",
    "invitation",
    "program-qr",
    "materials/id",
    "participants/id/data",
  ])
    expect(adminPermission("GET", path(route))).toBe("READ");
  for (const route of ["export", "reports", "codes-export"])
    for (const method of ["GET", "POST"])
      expect(adminPermission(method, path(route))).toBe("READ");
});
test("all data changes and certificate issuance stay restricted", () => {
  for (const route of [
    "",
    "participants",
    "participants/id",
    "participants/id/reset",
    "participants/id/undo-checkin",
    "materials-unlock",
    "material-uploads",
    "material-uploads/id/finish",
    "materials",
    "materials/id",
    "survey",
    "privacy",
    "cleanup",
    "team",
    "team/id",
    "invitation",
    "purge",
    "organizational",
    "organizational/id/draft",
    "organizational/id/launch",
    "organizational/id/process",
    "organizational/id/retry",
    "courses",
    "courses/id",
    "courses/id/codes",
  ])
    for (const method of ["POST", "PATCH", "DELETE", "PUT"])
      expect(adminPermission(method, path(route))).toBe("ADMIN");
  expect(adminPermission("GET", path("participants/id/certificate"))).toBe(
    "ADMIN",
  );
  expect(adminPermission("GET", path("team"))).toBe("ADMIN");
  expect(adminPermission("POST", path("checkin"))).toBe("CHECKIN");
  expect(adminPermission("GET", path("checkin-people"))).toBe("CHECKIN");
  expect(adminPermission("GET", path("new-future-feature"))).toBe("ADMIN");
});
