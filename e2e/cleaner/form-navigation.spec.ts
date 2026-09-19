import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/form-navigation-browser-entry.tsx")], bundle: true, write: false,
    format: "iife", platform: "browser", logLevel: "silent", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, alias: { "@": process.cwd() } })).outputFiles[0].text;
});
class FormNavigationPage {
  constructor(readonly page: Page) {}
  async open() {
    this.page.on("pageerror", error => { throw error; });
    await this.page.route("**/__synthetic_form_navigation", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
    await this.page.goto("/__synthetic_form_navigation"); await this.page.addScriptTag({ content: bundle });
  }
  nav() { return this.page.getByRole("navigation", { name: "Form room navigation" }); }
}
test("room jumps open collapsed fields, move keyboard focus, and never manufacture answers", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = new FormNavigationPage(page); await fixture.open();
  await expect(fixture.nav()).toContainText("2 items to finish");
  await fixture.nav().getByRole("button", { name: "Bedroom: 1 remaining" }).click();
  await expect(page.locator('[data-field-id="bedroom_note"]')).toBeFocused();
  await expect(page.getByTestId("answers")).toHaveText("{}");
  await fixture.nav().getByRole("button", { name: "Next incomplete room" }).click();
  await expect(page.locator('[data-field-id="kitchen_note"]')).toBeFocused();
  await page.locator('[data-field-id="kitchen_note"] input').fill("Done");
  await expect(fixture.nav()).toContainText("Kitchen: Required items complete");
  await expect(fixture.nav()).toContainText("1 items to finish");
});
test("changing laundry context exposes unanswered requirements and exact jumps reveal the new room", async ({ page }) => {
  const fixture = new FormNavigationPage(page); await fixture.open();
  await expect(fixture.nav()).toContainText("Laundry: Not applicable");
  await page.getByRole("button", { name: "Toggle laundry ready" }).click();
  await expect(fixture.nav()).toContainText("3 items to finish");
  await fixture.nav().getByRole("button", { name: "Laundry: 1 remaining" }).click();
  await expect(page.locator('[data-field-id="laundry_note"]')).toBeFocused();
  await expect(page.getByTestId("answers")).toHaveText("{}");
  await page.getByRole("button", { name: "Toggle laundry ready" }).click();
  await expect(fixture.nav()).toContainText("2 items to finish");
  await expect(page.locator('[data-field-id="laundry_note"]')).toHaveCount(0);
});
