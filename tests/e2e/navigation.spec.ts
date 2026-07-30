import { expect, test } from "@playwright/test";

test("homepage shows branding and all CTAs work", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Sokomind" })).toBeVisible();
  await expect(page).toHaveTitle("Sokomind");
  await expect(page.getByText("Think before you push")).toBeVisible();
  await expect(page.getByRole("button", { name: /playing/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Browse puzzles" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a puzzle" })).toBeVisible();
});

test("drill-down from home to puzzles to play", async ({ page }) => {
  await page.goto("./");

  await page.getByRole("button", { name: "Browse puzzles" }).click();
  await expect(page.getByRole("heading", { name: "Choose a difficulty" })).toBeVisible();

  await page.getByText("Tutorial").click();
  await expect(page.getByRole("heading", { name: "First Steps" }).or(
    page.getByText("First Steps")
  ).first()).toBeVisible({ timeout: 5000 });
});

test("legacy puzzle URL redirects to play page", async ({ page }) => {
  await page.goto("./#puzzle=huge");
  await expect(page.getByRole("heading", { name: "Grand Hall" })).toBeVisible();
  await expect(page).toHaveTitle("Grand Hall · Sokomind");
});

test("legacy custom URL redirects to editor page", async ({ page }) => {
  await page.goto("./#custom=test");
  await expect(page.getByRole("heading", { name: "Puzzle Editor" })).toBeVisible();
});

test("editor page loads at direct URL", async ({ page }) => {
  await page.goto("./#/editor");
  await expect(page.getByRole("heading", { name: "Puzzle Editor" })).toBeVisible();
  await expect(page).toHaveTitle("Puzzle Editor · Sokomind");
});

test("back button from play page navigates to puzzles", async ({ page }) => {
  await page.goto("./#/play/ultra-tiny");
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();

  await page.getByRole("link", { name: "Back to puzzles" }).click();
  await expect(page.getByRole("heading", { name: "Choose a difficulty" })).toBeVisible();
});
