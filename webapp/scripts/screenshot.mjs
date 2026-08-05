/**
 * Screenshot pass for the design gate (SKILL_UI section 10).
 *
 * Renders every screen and its key states at 2x against a running
 * `next start` on port 3210, writing PNGs to ../.scratch/shots/.
 *
 * Usage: node scripts/screenshot.mjs
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE_URL = "http://localhost:3210";
const OUTPUT_DIR = new URL("../../.scratch/shots/", import.meta.url).pathname;

async function shoot(page, name) {
  await page.waitForTimeout(900);
  await page.screenshot({
    path: `${OUTPUT_DIR}${name}.png`,
    fullPage: true,
  });
  console.log(`[shoot] ${name}`);
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });

  // Landing, sealed rest state plus mid-loop.
  await page.goto(`${BASE_URL}/`);
  await shoot(page, "00-landing-hero");
  await page.mouse.wheel(0, 1600);
  await shoot(page, "01-landing-sections");
  await page.mouse.wheel(0, 3000);
  await shoot(page, "02-landing-footer");

  // Dashboard: disconnected, then connected table, then a cancel.
  await page.goto(`${BASE_URL}/app`);
  await shoot(page, "10-dashboard-disconnected");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await shoot(page, "11-dashboard-table");
  await page.locator("main").getByText("#6").hover();
  await shoot(page, "12-dashboard-row-hover");

  // Create flow: form, validation error, review, sealing, done.
  await page.goto(`${BASE_URL}/app/new`);
  await shoot(page, "20-create-form");
  await page.getByLabel("Slice size").fill("0.5");
  await page.getByLabel("Slice size").blur();
  await shoot(page, "21-create-validation");
  await page.getByLabel("Slice size").fill("100.00");
  await page.getByRole("button", { name: "Advanced" }).click();
  await shoot(page, "22-create-advanced");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Review and seal" }).click();
  await shoot(page, "23-create-review");
  await page.getByRole("button", { name: "Seal and sign" }).click();
  await page.waitForTimeout(700);
  await shoot(page, "24-create-sealing");
  await page.waitForTimeout(2600);
  await shoot(page, "25-create-done");

  // Mandate detail: executing, awaiting deposit, cancelled.
  await page.goto(`${BASE_URL}/app/m/6`);
  await shoot(page, "30-detail-executing");
  await page.goto(`${BASE_URL}/app/m/7`);
  await shoot(page, "31-detail-awaiting");
  await page.goto(`${BASE_URL}/app/m/6`);
  await page.getByRole("button", { name: "Cancel mandate" }).click();
  await shoot(page, "32-detail-cancelled");

  // Small viewport sweep.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/`);
  await shoot(page, "40-mobile-landing");
  await page.goto(`${BASE_URL}/app`);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await shoot(page, "41-mobile-dashboard");
  await page.goto(`${BASE_URL}/app/new`);
  await shoot(page, "42-mobile-create");
  await page.goto(`${BASE_URL}/app/m/6`);
  await shoot(page, "43-mobile-detail");

  await browser.close();
  console.log("[main] done");
}

main().catch((shootError) => {
  console.error(`[main] ${shootError}`);
  process.exit(1);
});
