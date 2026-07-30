import { expect, test } from "@playwright/test";

test("keeps a large editor canvas scrollable and playtest controls reachable", async ({
  page,
}) => {
  const encoded = Buffer.from(
    JSON.stringify({
      t: "Mobile editor test",
      d: "beginner",
      r: ["OOOOO", "O R O", "O X O", "O S O", "OOOOO"],
    }),
    "utf8",
  ).toString("base64url");
  await page.goto(`./#/editor?custom=${encoded}`);

  const firstCell = page
    .getByTestId("editor-grid")
    .locator("button")
    .first();
  expect((await firstCell.boundingBox())?.width).toBeGreaterThanOrEqual(36);

  await page.getByRole("spinbutton", { name: "Board width" }).fill("20");
  await page.getByRole("spinbutton", { name: "Board height" }).fill("20");
  const overflow = await page
    .getByTestId("editor-grid-viewport")
    .evaluate((viewport) => ({
      horizontal: viewport.scrollWidth > viewport.clientWidth,
      vertical: viewport.scrollHeight > viewport.clientHeight,
    }));
  expect(overflow).toEqual({ horizontal: true, vertical: true });

  await page.reload();
  await page.getByRole("button", { name: "Test puzzle" }).click();
  await expect(
    page.getByRole("complementary", { name: "Playtest controls" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Move down" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to editor" })).toBeVisible();
});
