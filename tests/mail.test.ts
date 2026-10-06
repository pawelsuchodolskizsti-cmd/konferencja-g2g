import { expect, test } from "vitest";
import { escapeHtml, renderTemplate, retryDecision } from "../src/server/mail";
test("template interpolation does not recursively interpret user data", () => {
  expect(
    renderTemplate("Cześć {{firstName}}, {{eventName}}", {
      firstName: "{{eventName}}",
      eventName: "Konferencja",
    }),
  ).toBe("Cześć {{eventName}}, Konferencja");
  expect(escapeHtml("<script>alert(1)</script>")).not.toContain("<script>");
});
test("transient mail failures back off while validation errors stop retrying", () => {
  expect(retryDecision(1, 429)).toEqual({ retry: true, delay: 60 });
  expect(retryDecision(5, 503).retry).toBe(false);
  expect(retryDecision(1, 422).retry).toBe(false);
  expect(retryDecision(1).retry).toBe(true);
});
