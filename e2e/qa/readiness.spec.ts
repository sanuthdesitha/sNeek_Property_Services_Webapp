import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/local-admin";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

class QaQueuePage {
  constructor(private page: Page) {}
  async open() {
    await this.page.goto("/v2/qa");
  }
  async chooseStage(stage: string) { await this.page.getByRole("combobox", { name: "Inspection readiness" }).selectOption(stage); }
  async retry() { await this.page.getByRole("button", { name: "Retry queue" }).click(); }
  async refresh() { await this.page.getByRole("button", { name: "Refresh", exact: true }).click(); }
  house(name: string) { return this.page.getByText(`${name} — Airbnb Turnover`, { exact: true }); }
  error() { return this.page.getByRole("alert").filter({ hasText: "QA queue unavailable" }); }
  empty() { return this.page.getByText("No jobs waiting", { exact: true }); }
}

test("QA queue separates readiness stages and recovers an unavailable queue", async ({ localAdmin }) => {
  const { page } = localAdmin;
  let failed = false;
  const job = (name: string, readiness: string) => ({ id: name, status: readiness === "READY" ? "SUBMITTED" : "IN_PROGRESS", inspectionReadiness: readiness, jobType: "AIRBNB_TURNOVER", property: { name } });
  await page.route("**/api/qa/queue?**", (route) => route.fulfill({
    status: failed ? 503 : 200,
    json: failed ? { error: "Temporarily offline" } : { assignments: [
      { id: "ready", jobId: "Ready house", status: "ASSIGNED", job: job("Ready house", "READY") },
      { id: "waiting", jobId: "Waiting house", status: "ASSIGNED", job: job("Waiting house", "CLEANING") },
    ], unassignedJobs: [] },
  }));
  await page.route("**/api/qa/jobs/*/progress", (route) => route.fulfill({ json: {} }));
  const queue = new QaQueuePage(page);
  await queue.open();
  await expect(queue.house("Ready house")).toBeVisible();
  await expect(queue.house("Waiting house")).toBeVisible();
  await queue.chooseStage("READY");
  await expect(queue.house("Ready house")).toBeVisible();
  await expect(queue.house("Waiting house")).toHaveCount(0);
  failed = true;
  await queue.refresh();
  await expect(queue.error()).toBeVisible();
  await expect(queue.empty()).toHaveCount(0);
  failed = false;
  await queue.retry();
  await expect(queue.house("Ready house")).toBeVisible();
  await expect(queue.error()).toHaveCount(0);
});
