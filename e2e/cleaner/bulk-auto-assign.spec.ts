import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/bulk-auto-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "@/components/v2/cleaner/media-capture": path.resolve("e2e/cleaner/fixtures/bulk-auto-upload.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
const photoNames = ["one.jpg", "two.jpg", "three.jpg", "four.jpg", "five.jpg", "six.jpg"];
test("older saved photos are acknowledged before analysis and explicitly assigned", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const receipts: Record<string, any> = {}; const writes: any[] = [];
  await page.route("http://localhost:3999/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/draft")) return route.fulfill({ json: { draft: { evidenceReceipts: receipts } } });
    if (url.endsWith("/evidence")) {
      const body = route.request().postDataJSON(); writes.push(body);
      receipts[body.captureId] = { key: body.key, draftIdentity: "actor", formRevision: "revision", destination: body.destination, version: body.move ? body.move.version + 1 : 0 };
      return route.fulfill({ json: { ok: true, captureId: body.captureId, ...receipts[body.captureId] } });
    }
    if (url.endsWith("/auto-assign")) {
      const photos = route.request().postDataJSON().photos;
      expect(writes).toHaveLength(1); expect(writes[0].legacy).toBe(true);
      return route.fulfill({ json: { templateId: "template", formRevision: "revision", draftIdentity: "actor", minConfidence: .8, proposals: photos.map((photo: any) => ({ ...photo, fieldId: "kitchen", confidence: .96, reason: "Kitchen match" })) } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3999/bulk?legacy"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByText("Optional · Suggest photo sections", { exact: true }).click();
  await page.getByRole("button", { name: "Auto assign", exact: true }).click();
  await expect(page.getByText("Kitchen match")).toBeVisible(); await expect(page.getByText("Unassigned: 1")).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Accept 1 high-confidence suggestion" }).click();
  await expect(page.getByText("Unassigned: 0")).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1]).toMatchObject({ legacy: true, key: "forms/cleaner/old.jpg", move: { version: 0 } });
});
class BulkPhotos {
  constructor(readonly page: Page) {}
  async upload() { await this.page.getByLabel("Choose photos", { exact: true }).setInputFiles(photoNames.map(name => ({ name, mimeType: "image/jpeg", buffer: Buffer.from("mock upload") }))); await expect(this.page.getByText("Unassigned: 6")).toBeVisible(); }
  async analyse() { if (!await this.page.getByRole("button", { name: "Auto assign", exact: true }).isVisible()) await this.page.getByText("Optional · Suggest photo sections", { exact: true }).click(); await this.page.getByRole("button", { name: "Auto assign", exact: true }).click(); }
  async fits() { expect(await this.page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth, ...Array.from(document.querySelectorAll('[role="dialog"]')).map(el => el.scrollWidth)) - innerWidth)).toBeLessThanOrEqual(1); }
}
for (const width of [320, 390, 1440]) test(`uploaded batch is reviewed, strictly assigned and reversible at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 780 });
  const receipts: Record<string, any> = Object.fromEntries(photoNames.map(key => [key, { key, draftIdentity: "actor", formRevision: "revision", destination: { type: "bulkPool" }, version: 0 }]));
  const analysedBatches: string[][] = [];
  const moves: any[] = [];
  await page.route("http://localhost:3999/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/draft")) return route.fulfill({ json: { draft: { evidenceReceipts: receipts } } });
    if (url.endsWith("/auto-assign")) {
      const photos = route.request().postDataJSON().photos; analysedBatches.push(photos.map((photo: any) => photo.key));
      return route.fulfill({ json: { templateId: "template", formRevision: "revision", draftIdentity: "actor", minConfidence: .8, proposals: photos.map((photo: any) => ({ ...photo, fieldId: photo.key === "one.jpg" ? "kitchen" : null, confidence: photo.key === "one.jpg" ? .96 : .42, reason: photo.key === "one.jpg" ? "Bench and appliances match this section." : "Room uncertain; review this photo manually." })) } });
    }
    if (url.endsWith("/evidence")) { const body = route.request().postDataJSON(); moves.push(body); receipts[body.captureId].destination = body.destination; receipts[body.captureId].version++; return route.fulfill({ json: { ok: true, captureId: body.captureId, key: body.key, version: receipts[body.captureId].version, destination: body.destination } }); }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3999/bulk"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  const ui = new BulkPhotos(page); await ui.upload(); await ui.analyse();
  await expect(page.getByText("Analysed 6 of 6 photos.")).toBeVisible(); expect(analysedBatches.map(batch => batch.length)).toEqual([4, 2]);
  await expect(page.getByText("96% confidence")).toBeVisible(); await expect(page.getByText("42% confidence · Review needed").first()).toBeVisible(); expect(moves).toHaveLength(0); await ui.fits();
  const assignButton = page.getByRole("button", { name: /Assign to Kitchen bench and appliance photos/ });
  expect(await assignButton.evaluate(button => button.scrollHeight - button.clientHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`bulk-review-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Accept 1 high-confidence suggestion" }).click();
  await expect(page.getByText("Unassigned: 5")).toBeVisible(); expect(moves).toHaveLength(1); expect(moves[0].move.version).toBe(0);
  await page.getByRole("checkbox", { name: "Select one.jpg" }).click(); await page.getByRole("button", { name: "Unassign", exact: true }).click();
  await expect(page.getByText("Unassigned: 6")).toBeVisible(); expect(moves).toHaveLength(2); expect(moves[1].destination.type).toBe("bulkPool"); await ui.fits();
  await page.getByRole("button", { name: "Choose section", exact: true }).first().click(); await expect(page.getByText("Move 1 photo to…")).toBeVisible();
  await page.getByRole("button", { name: "Close picker" }).click(); await ui.fits();
});

for (const width of [320, 390, 1440]) test(`draft photo removal is accessible and recoverable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 780 });
  let removals = 0;
  await page.route("http://localhost:3999/**", async route => {
    if (route.request().url().endsWith("/evidence")) {
      expect(route.request().method()).toBe("DELETE");
      const { key } = route.request().postDataJSON(); removals++;
      return removals === 2 ? route.fulfill({ status: 503, json: { error: "Connection interrupted. Retry removal." } }) : route.fulfill({ json: { ok: true, key } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3999/bulk"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  const ui = new BulkPhotos(page); await ui.upload();
  await page.getByRole("checkbox", { name: "Select one.jpg" }).check();
  await page.getByRole("checkbox", { name: "Select two.jpg" }).check();
  expect((await page.getByRole("checkbox", { name: "Select one.jpg" }).locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("link", { name: "Preview one.jpg" })).toHaveAttribute("target", "_blank");
  const remove = page.getByRole("button", { name: "Remove selected", exact: true });
  await remove.scrollIntoViewIfNeeded(); const box = await remove.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  await ui.fits(); await page.screenshot({ path: info.outputPath(`bulk-remove-${width}.png`), fullPage: true });
  page.once("dialog", dialog => dialog.dismiss()); await remove.click(); expect(removals).toBe(0);
  page.once("dialog", dialog => dialog.accept()); await remove.click(); await expect(page.getByRole("alert")).toContainText("Connection interrupted");
  await expect(page.getByText("Unassigned: 5")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select two.jpg" })).toBeChecked();
  await remove.focus(); page.once("dialog", dialog => dialog.accept()); await page.keyboard.press("Enter");
  await expect(page.getByText("Unassigned: 4")).toBeVisible(); await expect(remove).toBeDisabled();
  expect(removals).toBe(3); await ui.fits();
});
