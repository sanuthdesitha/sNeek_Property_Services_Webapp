import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";

/** Sending safeguards screen at 390px and 1280px, light and dark (Obsidian): overflow, keyboard, dialog. */
let bundle: string;
let css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/sending-safeguards-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});

for (const width of [390, 1280]) {
  for (const mode of ["light", "dark"]) {
    test(`sending safeguards at ${width}px, ${mode}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("http://localhost:3998/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/api/me/admin-pin")) return route.fulfill({ json: { hasPin: true, lockedUntil: null, userId: "admin", attemptsLeft: 5 } });
        if (url.includes("/api/")) return route.fulfill({ status: 423, json: { error: "That PIN is not right. 4 tries left." } });
        return route.fulfill({ contentType: "text/html", body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>:root{--font-sans:Arial;--font-estate-serif:Georgia;--font-mono:monospace}${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
      });
      await page.goto(`http://localhost:3998/?mode=${mode}`);
      await expect(page.getByRole("heading", { level: 1, name: "Sending safeguards" })).toBeVisible();
      expect(await page.locator("h1").count()).toBe(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath(`safeguards-${width}-${mode}.png`), fullPage: true });
      // Keyboard: the stop button is reachable and opens the PIN confirmation.
      const stop = page.getByRole("button", { name: "Stop all sending" });
      await stop.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Your PIN").fill("1111");
      await dialog.getByRole("button", { name: "Stop sending" }).click();
      await expect(dialog.getByText("That PIN is not right. 4 tries left.")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`safeguards-${width}-${mode}-dialog.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      // A failed limit draft is kept: change, see the bound problem, and the value stays.
      const perHour = page.getByLabel("Per person per hour").first();
      await perHour.fill("2");
      await expect(page.getByText(/must be a whole number from 5 to 60/)).toBeVisible();
      await expect(perHour).toHaveValue("2");
    });
  }
}
