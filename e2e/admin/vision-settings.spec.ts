import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => { bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/vision-settings-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() }, logLevel: "silent" })).outputFiles[0].text; });
class SettingsPage {
  constructor(readonly page: Page) {}
  async open(canEdit = true) {
    await this.page.route("**/__vision_settings", route => route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div></body></html>' }));
    await this.page.goto("/__vision_settings"); await this.page.addScriptTag({ content: bundle });
    await this.page.evaluate(edit => (window as any).__mountVision(edit), canEdit);
  }
  save() { return this.page.getByRole("button", { name: "Save vision settings" }); }
  check() { return this.page.getByRole("button", { name: "Check provider and saved model" }); }
}
test("vision settings preserve failed edits and check only the saved model explicitly", async ({ page }) => {
  let writes = 0; let checks = 0; let saved: any;
  await page.route("**/api/admin/ai/vision", route => {
    writes++; saved = route.request().postDataJSON();
    return writes === 1 ? route.fulfill({ status: 500, json: { error: "Settings could not be saved" } }) : route.fulfill({ json: { settings: route.request().postDataJSON() } });
  });
  await page.route("**/api/admin/ai/vision/check", route => { checks++; return route.fulfill({ json: { model: "synthetic-model", message: "Credential and model access verified. Image analysis was not run." } }); });
  const fixture = new SettingsPage(page); await fixture.open();
  await expect(page.getByRole("checkbox", { name: "Compare submitted photos with references" })).not.toBeChecked();
  await expect(page.getByLabel("Use prior photos from the same property to recognize rooms")).toBeDisabled();
  await page.getByLabel("Suggest bulk photo assignments").check();
  await page.getByLabel("Use prior photos from the same property to recognize rooms").uncheck();
  expect(checks).toBe(0);
  await page.getByLabel("Photos per batch").fill("9"); await fixture.save().click();
  await expect(page.getByRole("status")).toContainText("Check the limits"); expect(writes).toBe(0);
  await page.getByLabel("Photos per batch").fill("6"); await fixture.save().click();
  await expect(page.getByRole("status")).toContainText("could not be saved");
  await expect(page.getByLabel("Photos per batch")).toHaveValue("6"); await expect(fixture.check()).toBeDisabled();
  await fixture.save().click(); await expect(page.getByRole("status")).toHaveText("Vision settings saved.");
  expect(saved).toMatchObject({ assignmentEnabled: true, historicalAssignmentExamplesEnabled: false, dedicatedRecognitionEnabled: false });
  await fixture.check().click(); await expect(page.getByText(/Image analysis was not run/)).toBeVisible(); expect(checks).toBe(1);
});
test("operations users see read-only vision settings", async ({ page }) => {
  const fixture = new SettingsPage(page); await fixture.open(false);
  await expect(fixture.save()).toBeDisabled(); await expect(fixture.check()).toBeDisabled();
  await expect(page.getByLabel("Photos per batch")).toBeDisabled();
});
