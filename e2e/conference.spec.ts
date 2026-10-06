import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("administrator signs in and sees imported participants", async ({
  page,
}) => {
  const access = JSON.parse(await readFile(".local/access.json", "utf8"));
  await page.goto("/admin/login");
  await page.getByLabel("E-mail", { exact: true }).fill(access.email);
  await page.getByLabel("Hasło", { exact: true }).fill(access.password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Uczestnicy", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Wyszukaj uczestnika" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(250);
});
test("participant sees two courses and can download a PDF", async ({
  page,
}) => {
  const access = JSON.parse(
    await readFile(".local/participant-access.json", "utf8"),
  );
  await page.goto("/uczestnik");
  await page.getByLabel("Twój kod dostępu").fill(access.code);
  await page.getByRole("button", { name: "Przejdź do swojej strefy" }).click();
  await expect(
    page.getByRole("heading", { name: "Twoje szkolenia" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Przejdź do kursu" }),
  ).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Pobierz certyfikat PDF" }).click();
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
    page.getByRole("heading", { name: "Strefa uczestnika" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
