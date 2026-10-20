import { expect, test } from "vitest";
import {
  escapeHtml,
  invitation,
  renderTemplate,
  retryDecision,
} from "../src/server/mail";
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

test("invitation contains only the saved draft with personalized name and code", async () => {
  const { encrypt } = await import("../src/server/crypto");
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.APP_URL = "https://konferencja-g2g.pl";
  const body =
    "Dzień dobry, {{firstName}}!\nTwój kod: {{accessCode}}\nhttps://konferencja-g2g.pl/uczestnik\nZespół Fundacji One Day";
  const payload = await invitation(
    {
      firstName: "Paweł",
      lastName: "Testowy",
      email: "test@example.test",
      credentials: encrypt(
        JSON.stringify({ accessCode: "ABC123", qrToken: "unused" }),
      ),
    } as Parameters<typeof invitation>[0],
    {
      name: "Głowa do Góry",
      location: "Warszawa",
      startsAt: new Date("2026-10-27T09:00:00Z"),
      timezone: "Europe/Warsaw",
      mailFrom: "konferencja@oneday.com.pl",
      mailSubject: "{{firstName}}, ważne informacje",
      mailBody: body,
    } as Parameters<typeof invitation>[1],
  );
  expect(payload.subject).toBe("Paweł, ważne informacje");
  expect(payload.html).toContain("Dzień dobry, Paweł!<br>Twój kod: ABC123");
  expect(payload.html).toContain(
    '<a href="https://konferencja-g2g.pl/uczestnik">',
  );
  expect(payload.html).not.toMatch(
    /Zaproszenie dla:|Zachowaj wiadomość|Organizator konferencji|W razie pytań|Kontakt:|<h1>/,
  );
  expect(payload.html.match(/ABC123/g)).toHaveLength(1);
});
