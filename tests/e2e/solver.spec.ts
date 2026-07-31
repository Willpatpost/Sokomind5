import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./#/play/ultra-tiny");
  await expect(page.getByRole("heading", { name: "First Steps" })).toBeVisible();
});

async function openSolver(page: Page) {
  await page.getByRole("button", { name: "Open solver laboratory" }).click();
  const dialog = page.getByRole("dialog", { name: "Find a route" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Algorithm")).toHaveValue("sokomind-solver");
  return dialog;
}

test("discovers five move-search algorithms and exposes an accessible configuration", async ({
  page,
}) => {
  const dialog = await openSolver(page);
  const algorithm = dialog.getByLabel("Algorithm");

  await expect(algorithm.locator("option")).toHaveCount(5);
  await expect(dialog.getByLabel("Objective")).toHaveCount(0);
  await expect(dialog.getByLabel("Time limit")).toHaveValue("60000");
  await expect(dialog.getByRole("button", { name: "Start search" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.getByRole("heading", { name: "Status log" })).toBeVisible();

  await algorithm.selectOption("classic-astar");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("solves a typed room with Sokomind Solver and plays its verified route", async ({
  page,
}) => {
  const dialog = await openSolver(page);

  await dialog.getByRole("button", { name: "Start search" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Route found" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Found 1 moves and 1 pushes.");
  await expect(dialog).toContainText("Found by Sokomind Solver.");
  await expect(dialog).toContainText("Best found");

  await dialog.getByRole("button", { name: "Play solution" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "First Steps" })).toBeVisible();
});

test("solves First Steps with A* and plays the verified route", async ({
  page,
}) => {
  const dialog = await openSolver(page);
  await dialog.getByLabel("Algorithm").selectOption("classic-astar");

  await dialog.getByRole("button", { name: "Start search" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Route found" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Found 1 moves and 1 pushes.");
  await expect(dialog).toContainText("Found by A* Search.");
  await expect(dialog).toContainText("Optimal");
  await dialog.getByText("Search diagnostics").click();
  await expect(dialog).toContainText("Unique states");
  await expect(dialog).toContainText("Estimated memory");

  await dialog.getByRole("button", { name: "Play solution" }).click();
  await expect(dialog).toBeHidden();

  const completion = page.getByRole("dialog", { name: "First Steps" });
  await expect(completion).toBeVisible();
  await expect(completion).toContainText("1 Move");
  await expect(completion).toContainText("1 Push");
  await expect(page.getByTestId("moves-count")).toHaveText("1");
  await expect(page.getByTestId("pushes-count")).toHaveText("1");
});

test("Sokomind Solver finds a replay-verified Grand Hall route", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto("./#/play/huge");
  await expect(page.getByRole("heading", { name: "Grand Hall" })).toBeVisible();

  const dialog = await openSolver(page);
  await dialog.getByLabel("Time limit").selectOption("120000");
  await dialog.getByRole("button", { name: "Start search" }).click();

  await expect(
    dialog.getByRole("heading", { name: "Route found" }),
  ).toBeVisible({ timeout: 120_000 });
  const resultPanel = dialog.locator('[data-status="solved"]');
  const summary = resultPanel.getByText(
    /^Found [\d,]+ moves and [\d,]+ pushes\.$/,
  );
  await expect(summary).toBeVisible();
  const summaryText = (await summary.textContent()) ?? "";
  const moveMatch = summaryText.match(/^Found ([\d,]+) moves/u);
  expect(moveMatch).not.toBeNull();
  const moves = Number((moveMatch?.[1] ?? "").replaceAll(",", ""));
  expect(moves).toBeLessThanOrEqual(1100);
  await expect(dialog).toContainText("Found by Sokomind Solver.");
  await expect(dialog.getByRole("button", { name: "Play solution" })).toBeEnabled();
});

test("cancels a running Grand Hall A* search", async ({ page }) => {
  await page.goto("./#/play/huge");
  await expect(page.getByRole("heading", { name: "Grand Hall" })).toBeVisible();

  const dialog = await openSolver(page);
  await dialog.getByLabel("Algorithm").selectOption("classic-astar");
  await dialog.getByLabel("Time limit").selectOption("120000");

  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await dialog.getByRole("button", { name: "Start search" }).click();
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(
    dialog.getByRole("heading", { name: "Search stopped" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Search cancelled.");
  await expect(dialog.getByRole("button", { name: "Start search" })).toBeEnabled();
});