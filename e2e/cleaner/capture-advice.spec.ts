import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/capture-advice-browser-entry.tsx")], bundle: true, write: false,
    format: "iife", platform: "browser", logLevel: "silent", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() } })).outputFiles[0].text;
});
test("real dark-image analysis warns, retains attachment and opens the orientation preview", async ({ page }) => {
  await page.route("**/__synthetic_capture_advice", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto("/__synthetic_capture_advice");
  const source = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 800;
    const context = canvas.getContext("2d")!; context.fillStyle = "#111111"; context.fillRect(0, 0, 600, 800); return canvas.toDataURL("image/png"); });
  const bytes = Buffer.from(source.split(",")[1], "base64");
  await page.route("**/api/uploads/direct", route => route.fulfill({ json: { key: "synthetic/dark.png", url: source } }));
  await page.evaluate(() => Object.defineProperty(navigator.storage, "estimate", { configurable: true, value: async () => ({ quota: 100_000_000, usage: 99_999_999 }) }));
  await page.addScriptTag({ content: bundle });
  await page.locator('input[type="file"]:not([capture])').setInputFiles({ name: "dark.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByTestId("attached")).toHaveText("1");
  await expect(page.getByRole("status", { name: "Capture advice" })).toContainText("appears dark");
  await expect(page.getByRole("status", { name: "Capture advice" })).toContainText("Estimated browser storage is low");
  await page.getByRole("button", { name: "View photo", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const image = page.getByRole("dialog").locator("img");
  await expect(image).toBeVisible();
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalHeight > element.naturalWidth)).toBe(true);
});
