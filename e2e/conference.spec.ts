import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("administrator signs in and sees imported participants", async ({
  page,
}) => {
  const access = JSON.parse(await readFile(".local/access.json", "utf8"));
  await page.goto("/admin/login");
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
});
test("participant sees entry QR while courses stay locked and can download a PDF", async ({
  page,
}) => {
  const access = JSON.parse(
    await readFile(".local/participant-access.json", "utf8"),
  );
  await page.goto("/uczestnik");
  await page.getByLabel("Twój kod dostępu").fill(access.code);
  await page.locator('input[name="privacyAcknowledged"]').check();
  await page.getByRole("button", { name: "Wejdź do strefy" }).click();
  await expect(page.getByRole("heading", { name: "Kod QR do wejścia" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Indywidualny kod QR do potwierdzenia obecności" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dostęp do szkoleń" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Przejdź do kursu" })).toHaveCount(0);
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


test("frozen sponsor layout uses seven correctly sized independent crops", async ({ page }) => {
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
      await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs(box!.width / box!.height - ratio)).toBeLessThan(0.01);
    }
  }
});
