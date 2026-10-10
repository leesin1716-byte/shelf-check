// 데모 페르소나 세 명의 흐름(스캔→선반→에이전트→계획→미리보기→체크인)을 브라우저로 끝까지 확인하고 스크린샷을 남긴다
import { expect, test } from "@playwright/test";

const shots = process.env.SHOTS === "1";

// Section screenshots scroll the section under the sticky header; unstick it while capturing.
test.beforeEach(async ({ page }) => {
  if (!shots) return;
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".topbar{position:static!important}";
      document.head.appendChild(style);
    });
  });
});

test("Maya: breakout plan pauses the peel pads and buys two basics", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Check your shelf before you buy." })).toBeVisible();
  if (shots) await page.screenshot({ path: "docs/screenshots/01-home.png" });
  await page.getByRole("button", { name: /Check Maya's shelf/ }).click();
  await expect(page.getByText("Combination & Redness")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("listitem").filter({ hasText: "Acne" }).first()).toContainText("38.2");
  if (shots) await page.locator("#scan").screenshot({ path: "docs/screenshots/02-scan.png" });
  await page.getByRole("button", { name: "Check this shelf" }).click();
  await expect(page.getByText(/Your shelf, product by product/)).toBeVisible({ timeout: 30_000 });
  const pads = page.locator(".verdict", { hasText: "10% Glycolic Peel Pads" });
  await expect(pads.locator(".pill")).toHaveText("pause");
  await expect(page.getByText("Buy only this")).toBeVisible();
  if (shots) {
    await page.locator("#agent").screenshot({ path: "docs/screenshots/03-plan.png" });
    await expect(page.getByText(/Demo personas show the settings/)).toBeVisible({ timeout: 15_000 });
    await page.locator("#preview").screenshot({ path: "docs/screenshots/04-preview.png" });
  }
});

test("Jun: the serum in the cart gets a 'wait'", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Check Jun's shelf/ }).click();
  await expect(page.getByText("In cart")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Check this shelf" }).click();
  const cart = page.locator(".verdict", { hasText: "Multi-Peptide Firming Serum" });
  await expect(cart.locator(".pill")).toHaveText("wait", { timeout: 30_000 });
  if (shots) await page.locator("#agent").screenshot({ path: "docs/screenshots/05-cart.png" });
});

test("Lena: the rescan shows what is working", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Check Lena's shelf/ }).click();
  await expect(page.locator("#checkin")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#checkin .verdict", { hasText: "Tranexamic" }).locator(".pill")).toHaveText("working");
  await expect(page.locator("#checkin .verdict", { hasText: "Retinal" }).locator(".pill")).toHaveText("irritating");
  if (shots) await page.locator("#checkin").screenshot({ path: "docs/screenshots/06-checkin.png" });
});

test("mobile layout has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Check Maya's shelf/ }).click();
  await page.getByRole("button", { name: "Check this shelf" }).click();
  await expect(page.getByText(/Your shelf, product by product/)).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (shots) await page.screenshot({ path: "docs/screenshots/07-mobile.png", fullPage: false });
});
