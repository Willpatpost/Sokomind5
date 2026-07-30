import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("keeps Help and movement controls reachable on mobile", async ({
  page,
}) => {
  await page.goto("./#/play/ultra-tiny");
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();

  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
  await page.getByRole("button", { name: "Close instructions" }).click();

  const controls = page.getByRole("region", { name: "Game controls" });
  const score = page.getByText("Current route").locator("..").locator("..");
  await expect(controls).toBeVisible();
  expect((await controls.boundingBox())?.y).toBeLessThan(
    (await score.boundingBox())?.y ?? Infinity,
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("homepage loads and navigates to puzzles", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  await expect(page).toHaveTitle("Sokomind");

  await page.getByRole("button", { name: "Browse puzzles" }).click();
  await expect(page.getByRole("heading", { name: "Choose a difficulty" })).toBeVisible();
});
