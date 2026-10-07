import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
const key = "forms/old-job/capture/cleaner/photo.jpg";
const row = { key, name: "Old photo", previewUrl: "/fixture.svg", version: "a".repeat(64), removed: false, issues: ["Stored under another job", "Captured under an older or different form version"], source: { jobId: "old-job", captureId: "capture", userId: "cleaner", legacy: false }, locations: [{ type: "bulkPool" }], receipts: [{ id: "capture", formRevision: "old-form-version", draftIdentity: "old-context" }] };
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/draft-evidence-review-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "@/components/v2/cleaner/media-capture": path.resolve("e2e/cleaner/fixtures/bulk-auto-upload.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [320, 390, 1440]) test(`office reviews, cancels, retries and audits only a draft reference at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 }); let removed = false, attempts = 0;
  await page.route("http://localhost:3999/**", async route => {
    if (route.request().url().endsWith("/evidence-review")) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); expect(body).toEqual({ action: "DISCARD_DRAFT_REFERENCE", key, version: row.version, reason: "Photo belongs to the older job." }); attempts++;
        if (attempts === 1) return route.fulfill({ status: 500, json: { error: "Audit unavailable. Retry." } });
        removed = true; return route.fulfill({ json: { ok: true, key, discardedReference: true } });
      }
      return route.fulfill({ json: { jobId: "job", locked: false, rows: [{ ...row, removed }], history: removed ? [{ id: "audit", action: "OFFICE_DISCARD_DRAFT_REFERENCE", user: { name: "Office Reviewer" }, createdAt: "2026-10-07T00:00:00Z", after: { reason: "Photo belongs to the older job." } }] : [] } });
    }
    if (route.request().url().endsWith("/fixture.svg")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#809c92"/></svg>' });
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  const open = async () => { await page.goto("http://localhost:3999/office"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle }); };
  await open(); await expect(page.getByText("Stored under another job")).toBeVisible();
  const button = page.getByRole("button", { name: "Discard draft reference" }); await expect(button).toBeDisabled();
  await page.getByText("Original provenance", { exact: true }).click(); await expect(page.getByText(/Capture time is not available/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator("article details p").evaluateAll(elements => Math.max(...elements.map(el => el.scrollWidth - el.clientWidth)))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`office-review-${width}.png`), fullPage: true });
  await page.getByRole("textbox", { name: "Reason for discarding Old photo" }).fill("Photo belongs to the older job.");
  page.once("dialog", dialog => dialog.dismiss()); await button.click(); expect(attempts).toBe(0);
  page.once("dialog", dialog => dialog.accept()); await button.click(); await expect(page.getByRole("alert")).toHaveText("Audit unavailable. Retry.");
  await button.focus(); page.once("dialog", dialog => dialog.accept()); await page.keyboard.press("Enter");
  await expect(page.getByText("Removed from draft", { exact: true })).toBeVisible(); expect(attempts).toBe(2);
  await page.getByText("Resolution history (latest 50)").click(); await expect(page.getByText("Office draft-reference override")).toBeVisible();
  await open(); await expect(page.getByText("Removed from draft", { exact: true })).toBeVisible(); await expect(page.getByRole("textbox")).toHaveCount(0);
});
test("cleaner separately confirms a wrong reference while the original capture remains intact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 }); const writes: any[] = [];
  await page.route("http://localhost:3999/**", async route => {
    if (route.request().url().endsWith("/evidence")) {
      const body = route.request().postDataJSON(); writes.push(body);
      return body.discardReference ? route.fulfill({ json: { ok: true, key, discardedReference: true } }) : route.fulfill({ status: 409, json: { code: "EVIDENCE_CONTEXT_MISMATCH", canDiscardReference: true, error: "Different capture context" } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3999/cleaner"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Remove Old photo from draft" }).click();
  const discard = page.getByRole("button", { name: "Discard wrong draft reference" }); await expect(discard).toBeVisible();
  const box = await discard.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  page.once("dialog", dialog => dialog.dismiss()); await discard.click(); expect(writes).toHaveLength(1);
  page.once("dialog", dialog => dialog.accept()); await discard.click(); await expect(page.getByText("Unassigned: 0")).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1]).toMatchObject({ discardReference: true, key, reason: expect.stringContaining("does not belong") });
});
