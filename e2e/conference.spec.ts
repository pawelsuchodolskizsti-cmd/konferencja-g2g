import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("administrator signs in and sees imported participants", async ({
  page,
}) => {
  const access = JSON.parse(await readFile(".local/access.json", "utf8"));
  const response = await page.goto("/admin/login");
  expect(response?.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src-attr 'none'",
  );
  expect(
    response?.headers()["content-security-policy-report-only"],
  ).toBeUndefined();
  await page.getByLabel("Adres e-mail", { exact: true }).fill(access.email);
  await page.getByLabel("Hasło", { exact: true }).fill(access.password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu ☰", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: "Uczestnicy", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Wyszukaj uczestnika" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(251);
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: "Eksporty", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Excel z kodami", exact: true })
    .click();
  expect((await exported).suggestedFilename()).toBe("uczestnicy-z-kodami.xlsx");
  await page.goto("/admin?section=settings");
  await page.getByLabel("Od", { exact: true }).first().fill("15:00");
  await page.getByLabel("Do", { exact: true }).first().fill("14:00");
  await expect(page.locator("#agenda-error-0")).toBeVisible();
  await page
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(
    page.getByText(
      "Punkt programu 1: zakończenie musi być późniejsze niż rozpoczęcie.",
      { exact: true },
    ),
  ).toBeVisible();
  // Invalid input is never persisted; reloading restores the original program.
  await page.reload();
  await expect(page.getByLabel("Od", { exact: true }).first()).toHaveValue(
    "09:00",
  );
  await expect(page.getByLabel("Do", { exact: true }).first()).toHaveValue(
    "10:00",
  );
  await test.step("CSP permits adding and replacing PDFs above the former 2 MB limit", async () => {
    await page.goto("/admin?section=materials");
    const filename = "synthetic-e2e-" + Date.now() + ".pdf";
    const original = Buffer.alloc(3 * 1024 * 1024 + 11, 42);
    original.write("%PDF-");
    await page.getByLabel("Nowy materiał PDF", { exact: true }).setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: original,
    });
    await page
      .getByRole("button", { name: "Dodaj materiał", exact: true })
      .click();
    const row = page.locator("div.card").filter({
      has: page.locator(
        'input[name="title"][value="' + filename.slice(0, -4) + '"]',
      ),
    });
    await expect(row).toHaveCount(1);
    const link = row.getByRole("link", { name: "Podgląd PDF", exact: true });
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const before = await page.request.get(href!);
    expect(before.status()).toBe(200);
    expect((await before.body()).equals(original)).toBe(true);
    const replacement = Buffer.alloc(3 * 1024 * 1024 + 29, 53);
    replacement.write("%PDF-");
    await row.getByLabel("Zastąp plik PDF", { exact: true }).setInputFiles({
      name: "replacement.pdf",
      mimeType: "application/pdf",
      buffer: replacement,
    });
    await row.getByRole("button", { name: "Zastąp PDF", exact: true }).click();
    await expect(
      page.getByText(
        "Plik zapisany. Zgodność z oryginałem potwierdzona sumą SHA-256.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect
      .poll(async () => (await (await page.request.get(href!)).body()).length)
      .toBe(replacement.length);
    expect(
      (await (await page.request.get(href!)).body()).equals(replacement),
    ).toBe(true);
    await expect(
      page.locator(
        'input[name="title"][value="' + filename.slice(0, -4) + '"]',
      ),
    ).toHaveCount(1);
  });
});
test("checked-in participant keeps ticket navigation without QR while courses stay locked and PDF works", async ({
  page,
}) => {
  const access = JSON.parse(
    await readFile(".local/participant-access.json", "utf8"),
  );
  await page.goto("/uczestnik");
  await expect(page.getByLabel("Twój kod dostępu")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Wchodzę ponownie", exact: true })
    .click();
  await expect(page.getByLabel("Twój kod dostępu")).toBeVisible();
  await expect(page.locator('input[name="privacyAcknowledged"]')).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Loguję się pierwszy raz", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Wejdź do strefy" }),
  ).toBeDisabled();
  await page.getByLabel("Twój kod dostępu").fill(access.code);
  await page.locator('input[name="privacyAcknowledged"]').check();
  await page.getByRole("button", { name: "Wejdź do strefy" }).click();
  // test:http has already checked this synthetic participant in.
  await expect(
    page.getByLabel("Bilet wykorzystany", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Bilet wykorzystany", { exact: true }),
  ).toContainText("01");
  await expect(
    page.getByRole("heading", { name: "Kod QR do wejścia" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", {
      name: "Indywidualny kod QR do potwierdzenia obecności",
    }),
  ).toHaveCount(0);
  // Keep the whole "Certyfikat" label inside its single navigation cell on narrow phones.
  const initialViewport = page.viewportSize()!;
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 780 });
    const fits = await page
      .locator(
        'nav[aria-label="Sekcje strefy uczestnika"] a[href="#certyfikat"]',
      )
      .evaluate((element) => {
        const label = [...element.childNodes].find(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        if (!label) return false;
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const cell = element.getBoundingClientRect();
        return (
          getComputedStyle(element).whiteSpace === "nowrap" &&
          text.width > 0 &&
          text.left >= cell.left - 1 &&
          text.right <= cell.right + 1
        );
      });
    expect(fits, `Certyfikat must fit at ${width}px without wrapping`).toBe(
      true,
    );
  }
  await page.setViewportSize(initialViewport);
  await expect(
    page.getByRole("heading", { name: "Dostęp do szkoleń" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Przejdź do kursu" }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Kliknij i odbierz certyfikat" })
    .click();
  expect((await download).suggestedFilename()).toBe("certyfikat.pdf");
});
test("public agenda and login do not overflow the viewport", async ({
  page,
}) => {
  await page.goto("/wydarzenie");
  await expect(
    page.getByRole("heading", { name: "Wydarzenia fundacji" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Strefa uczestnika", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Twoja\s+strefa/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("frozen sponsor layout uses seven correctly sized independent crops", async ({
  page,
}) => {
  await page.goto("/");
  const organizers = page.locator("#organizatorzy article img");
  const partners = page.locator("#partnerzy img");
  await expect(organizers).toHaveCount(3);
  await expect(partners).toHaveCount(4);

  const organizerSources = [
    "/branding/crops/one-day.webp",
    "/branding/crops/rzecznik-praw-dziecka.webp",
    "/branding/crops/dla-naszych-dzieci.webp",
  ];
  const partnerSources = [
    "/branding/crops/incredibles.webp",
    "/branding/crops/presidential-hotel.webp",
    "/branding/crops/yummy.webp",
    "/branding/crops/garnizon-sztuki.webp",
  ];
  for (const [group, files, ratio] of [
    [organizers, organizerSources, 330 / 200],
    [partners, partnerSources, 360 / 150],
  ] as const) {
    for (let i = 0; i < files.length; i++) {
      const image = group.nth(i);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveAttribute("src", files[i]);
      await expect
        .poll(() =>
          image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs(box!.width / box!.height - ratio)).toBeLessThan(0.01);
    }
  }
});

test("organizational draft saves and previews without starting delivery", async ({
  page,
}) => {
  const access = JSON.parse(await readFile(".local/access.json", "utf8"));
  const deliveryRequests: string[] = [];
  // Even a regression cannot dispatch mail in this browser test.
  await page.route(
    /\/organizational\/[^/]+\/(launch|process|retry)$/,
    async (route) => {
      deliveryRequests.push(route.request().url());
      await route.abort();
    },
  );
  await page.goto("/admin/login");
  await page.getByLabel("Adres e-mail", { exact: true }).fill(access.email);
  await page.getByLabel("Hasło", { exact: true }).fill(access.password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.goto("/admin?section=organizational");
  await expect(
    page.getByRole("heading", {
      name: "Wiadomości organizacyjne",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nowy szkic", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Szkic wiadomości", exact: true }),
  ).toBeVisible();
  const subject = "Test E2E {{firstName}} " + Date.now();
  await page
    .getByLabel("Temat wiadomości organizacyjnej", { exact: true })
    .fill(subject);
  await page
    .getByLabel("Treść wiadomości organizacyjnej", { exact: true })
    .fill(
      "Witaj {{firstName}}, Twój kod: {{accessCode}}. <b>Informacja testowa</b>",
    );
  await page.getByRole("button", { name: "Zapisz szkic", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Szkic zapisany");
  await expect(
    page.getByRole("button", {
      name: "Zatwierdź i rozpocznij wysyłkę do 0 osób",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page
      .locator("strong")
      .filter({ hasText: /^Informacja testowa$/ })
      .or(page.locator("b").filter({ hasText: /^Informacja testowa$/ })),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Temat wiadomości organizacyjnej", { exact: true }),
  ).toHaveValue(subject);
  await expect(
    page.getByLabel("Treść wiadomości organizacyjnej", { exact: true }),
  ).toHaveValue(/Twój kod/);
  expect(deliveryRequests).toEqual([]);
});
