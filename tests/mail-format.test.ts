import { expect, test } from "vitest";
import { formatMailBody } from "../src/lib/mail-format";
test("formats bold and italic, including nested tags and personalized values", () => {
  expect(
    formatMailBody(
      "<b>Witaj <i>{{firstName}}</i></b>!\nKod: <b>{{accessCode}}</b>",
      { firstName: "Anna", accessCode: "ABC123" },
    ),
  ).toBe("<b>Witaj <i>Anna</i></b>!<br>Kod: <b>ABC123</b>");
});
test("does not interpret markup or placeholders from participant data", () => {
  expect(
    formatMailBody("<b>{{firstName}}</b>", {
      firstName: "<i>{{accessCode}}</i>",
      accessCode: "SECRET",
    }),
  ).toBe("<b>&lt;i&gt;{{accessCode}}&lt;/i&gt;</b>");
});
test("escapes scripts, attributes, unsupported tags and encoded tags", () => {
  const html = formatMailBody(
    '<script>alert(1)</script><b onclick="alert(1)">X</b><img src=x onerror=alert(1)>&lt;i&gt;',
  );
  expect(html).not.toMatch(/<script|onclick="|<img|<b onclick/);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&amp;lt;i&amp;gt;");
});
test("balances open allowed tags without accepting mismatched closing tags", () => {
  expect(formatMailBody("<B>A<i>B")).toBe("<b>A<i>B</i></b>");
  expect(formatMailBody("</i>text")).toBe("&lt;/i&gt;text");
});
test("retains clickable panel link and plain line breaks", () => {
  expect(
    formatMailBody(
      "Link: https://konferencja-g2g.pl/uczestnik\nKoniec",
      {},
      "https://konferencja-g2g.pl/uczestnik",
    ),
  ).toBe(
    'Link: <a href="https://konferencja-g2g.pl/uczestnik">https://konferencja-g2g.pl/uczestnik</a><br>Koniec',
  );
});
