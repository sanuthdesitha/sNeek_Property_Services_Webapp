import { test, expect } from "../fixtures/local-admin";
import { readFile } from "node:fs/promises";

test.describe("Reviewed Jobs export", () => {
  test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires isolated account fixtures");
  test.setTimeout(180_000);
  for (const mode of ["complete", "limited", "failed"] as const) {
    test(`shows ${mode} export scope before any local download`, async ({ localAdmin }) => {
      const { page } = localAdmin;
      const job = (index: number) => ({ id: `export-${index}`, jobNumber: `EXPORT-${index}`, jobType: "GENERAL_CLEAN", status: "ASSIGNED", scheduledDate: "2026-09-09T00:00:00Z", property: { name: index === 0 ? '=HYPERLINK("example.invalid")' : `Export property ${index}`, suburb: "Sydney" }, assignments: [] });
      const requests: URL[] = []; const downloads: string[] = [];
      page.on("download", download => downloads.push(download.suggestedFilename()));
      await page.route("**/api/jobs?*", route => {
        const url = new URL(route.request().url()); requests.push(url);
        const exporting = url.searchParams.get("limit") === "5000";
        if (exporting && mode === "failed") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
        const count = exporting && mode === "limited" ? 5000 : 1;
        const totalCount = exporting && mode === "limited" ? 5001 : 1;
        const limit = exporting ? 5000 : 50;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobs: Array.from({ length: count }, (_, index) => job(index)), pagination: { page: 1, limit, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / limit)), hasMore: totalCount > limit } }) });
      });
      await page.goto("/v2/admin/jobs?dateScope=all&jobsState=1&search=Export&invoiced=no");
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Review Jobs export" })).toBeVisible();
      if (mode === "failed") {
        await expect(page.getByText("Could not load export. Refresh and try again.", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /Download reviewed/ })).toHaveCount(0);
        await expect(page.getByText("No jobs match these export filters.", { exact: true })).toHaveCount(0);
      } else {
        const label = mode === "limited" ? "Download reviewed 5,000 rows" : "Download reviewed CSV (1)";
        await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
        if (mode === "limited") await expect(page.getByText(/only the first 5,000 matching jobs/)).toBeVisible();
        expect(downloads).toEqual([]);
        const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: label, exact: true }).click();
        const file = await downloaded; const filePath = await file.path(); expect(filePath).toBeTruthy();
        const csv = await readFile(filePath!, "utf8"); expect(csv).toContain("09/09/2026"); expect(csv).toContain('"\'=HYPERLINK(""example.invalid"")"');
        expect(csv.split("\r\n")).toHaveLength(mode === "limited" ? 5001 : 2);
        await expect(page.getByText(/Your browser handles saving the file/)).toBeVisible();
      }
      const exported = requests.find(url => url.searchParams.get("limit") === "5000");
      expect(Object.fromEntries(exported!.searchParams)).toMatchObject({ page: "1", search: "Export", invoiced: "no", limit: "5000" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
