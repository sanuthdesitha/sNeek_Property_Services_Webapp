import { test, expect } from "../fixtures/local-admin";
import type { Page } from "@playwright/test";

class JobsScrollPage {
  constructor(private page: Page) {}
  async installResults() {
    const jobs = Array.from({ length: 40 }, (_, index) => ({ id: `scroll-job-${index}`, jobNumber: index + 1, jobType: "REGULAR_CLEAN", status: "UNASSIGNED", scheduledDate: "2026-09-09T00:00:00.000Z", property: { name: `Scroll property ${index}`, suburb: "Sydney" }, assignments: [] }));
    await this.page.route("**/api/jobs?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs, pagination: { page: 1, limit: 50, totalCount: 40, totalPages: 1, hasMore: false } }) }));
  }
  async open() { await this.page.goto("/v2/admin/jobs?dateScope=all&jobsState=1"); await this.loaded(); }
  async loaded() { await expect(this.page.getByRole("button", { name: "Manage Scroll property 39", exact: true })).toBeAttached(); }
  async scrollTo(y: number) {
    await this.page.evaluate(value => window.scrollTo({ top: value, behavior: "instant" }), y);
    await expect.poll(() => this.page.evaluate(() => window.scrollY)).toBe(y);
    await expect.poll(() => this.page.evaluate(() => JSON.parse(sessionStorage.getItem("sneek:jobs-scroll:v1") ?? "[]").some((row: { y: number }) => row.y === window.scrollY))).toBe(true);
  }
}

test.describe("Jobs exact scroll navigation", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
  test.setTimeout(180_000);
  test("restores the loaded list after reload and browser Back", async ({ localAdmin }) => {
    const { page } = localAdmin;
    const jobs = new JobsScrollPage(page); await jobs.installResults(); await jobs.open();
    await jobs.scrollTo(900);
    await page.reload(); await jobs.loaded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);
    // A real second app page gives Back the previous Jobs history entry.
    await page.goto("/v2/admin/notifications");
    await page.goBack(); await jobs.loaded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);
  });
  test("does not apply list coordinates to a different filter", async ({ localAdmin }) => {
    const { page } = localAdmin;
    const jobs = new JobsScrollPage(page); await jobs.installResults(); await jobs.open(); await jobs.scrollTo(900);
    await page.goto("/v2/admin/jobs?dateScope=all&statusChip=UNASSIGNED&jobsState=1"); await jobs.loaded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});
