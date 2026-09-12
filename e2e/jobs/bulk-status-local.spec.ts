import { test, expect } from "../fixtures/local-admin";

test.describe("Reviewed Jobs bulk status", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires isolated account fixtures");
  test.setTimeout(180_000);
  for (const outcome of ["success", "conflict", "unknown"] as const) {
    test(`reviews consequences and handles ${outcome} without automatic retry`, async ({ localAdmin }) => {
      const { page } = localAdmin;
      const jobs = [{ id: "preview-job", jobNumber: 1, jobType: "REGULAR_CLEAN", status: "ASSIGNED", scheduledDate: "2026-09-09T00:00:00.000Z", property: { name: "Preview property", suburb: "Sydney" }, assignments: [] }];
      await page.route("**/api/jobs?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs, pagination: { page: 1, limit: 50, totalCount: 1, totalPages: 1, hasMore: false } }) }));
      await page.route("**/api/admin/jobs/bulk-status/preview?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
        context: route.request().headers()["x-jobs-view-context"], status: "UNASSIGNED", reviewToken: "a".repeat(64),
        rows: [{ id: "preview-job", label: "Preview property", before: "ASSIGNED", after: "UNASSIGNED", blocked: false, consequences: ["Clear completion time.", "Remove 0 active cleaner assignments."] }],
      }) }));
      const writes: unknown[] = [];
      await page.route("**/api/admin/jobs/bulk-status", async route => {
        writes.push(route.request().postDataJSON());
        await route.fulfill({ status: outcome === "success" ? 200 : outcome === "conflict" ? 409 : 503, contentType: "application/json", body: JSON.stringify(outcome === "success" ? { ok: true, updated: 1, status: "UNASSIGNED" } : { error: "Jobs changed since review." }) });
      });
      await page.goto("/v2/admin/jobs?dateScope=all&jobsState=1");
      await page.getByRole("checkbox", { name: "Select Preview property", exact: true }).check();
      await page.getByRole("button", { name: "Change status", exact: true }).click();
      await page.getByLabel("Bulk status", { exact: true }).selectOption("UNASSIGNED");
      expect(writes).toEqual([]);
      await page.getByRole("button", { name: "Review changes", exact: true }).click();
      await expect(page.getByText("Clear completion time.", { exact: true })).toBeVisible();
      expect(writes).toEqual([]);
      await page.getByRole("button", { name: "Apply reviewed changes (1)", exact: true }).click();
      if (outcome === "success") await expect(page.getByRole("dialog")).toHaveCount(0);
      else if (outcome === "conflict") { await expect(page.getByText("Jobs changed since review.", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeEnabled(); }
      else { await expect(page.getByText(/The outcome is unknown/)).toBeVisible(); await expect(page.getByRole("button", { name: "Refresh preview", exact: true })).toBeDisabled(); }
      expect(writes).toEqual([{ jobIds: ["preview-job"], status: "UNASSIGNED", reviewToken: "a".repeat(64) }]);
    });
  }
});
