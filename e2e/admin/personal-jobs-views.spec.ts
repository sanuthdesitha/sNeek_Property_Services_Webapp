import { test, expect } from "../fixtures/local-admin";
import type { Page } from "@playwright/test";

class PersonalJobsViews {
  constructor(private page: Page) {}
  async open() { await this.page.goto("/v2/admin/jobs"); }
  async create(name: string) {
    await this.page.getByRole("button", { name: "Save as new view", exact: true }).click();
    await this.page.getByRole("textbox", { name: "View name", exact: true }).fill(name);
    await this.page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(this.page.getByRole("dialog")).toHaveCount(0);
  }
  async remove() {
    await this.page.getByRole("button", { name: "Delete selected view", exact: true }).click();
    await this.page.getByRole("button", { name: "Delete view", exact: true }).click();
    await expect(this.page.getByRole("dialog")).toHaveCount(0);
  }
}

test.describe("personal Jobs views on an isolated account", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
  test.setTimeout(180_000);
  test("creates a personal view, restores after reload and deletes it", async ({ localAdmin }) => {
    const { page } = localAdmin;
    const views = new PersonalJobsViews(page);
    await views.open();
    await views.create("Browser verification view");
    await expect(page.getByRole("combobox", { name: "Personal saved view" })).toContainText("Browser verification view");
    await page.reload();
    await page.getByRole("combobox", { name: "Personal saved view" }).selectOption({ label: "Browser verification view" });
    await views.remove();
    await expect(page.getByRole("combobox", { name: "Personal saved view" })).not.toContainText("Browser verification view");
  });
  test("failed preferences show retry without false saved success", async ({ localAdmin }) => {
    const { page } = localAdmin;
    await page.route("**/api/me/jobs-views", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
    await new PersonalJobsViews(page).open();
    await expect(page.getByRole("button", { name: "Reload views", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as new view", exact: true })).toBeDisabled();
    await expect(page.getByText("View saved.", { exact: true })).toHaveCount(0);
  });
});
