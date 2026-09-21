import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => { bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/photo-review-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next/navigation": path.resolve("e2e/admin/fixtures/photo-review-navigation.ts") }, logLevel: "silent" })).outputFiles[0].text; });
class ReviewPage {
  constructor(readonly page: Page) {}
  async open() {
    await this.page.route("**/__photo_review", route => route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div></body></html>' }));
    await this.page.goto("/__photo_review"); await this.page.addScriptTag({ content: bundle });
  }
  approve() { return this.page.getByRole("button", { name: "Approve selected deduction" }); }
}
test("photo deduction requires explicit selection and reason and displays the committed score", async ({ page }) => {
  let decision: any = null; const writes: any[] = [];
  await page.route("**/api/qa/jobs/synthetic-job/photo-review", async route => {
    if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); decision = { action: "approve", deduction: 5, scoreBefore: 90, scoreAfter: 85, reason: writes[0].reason }; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { enabled: true, hasSubmission: true, canApprove: true, scoreReview: { id: "qa", score: decision ? 85 : 90 }, photos: [], review: { id: "analysis", status: "READY", reviewedAt: decision ? "now" : null, decision, settings: { minConfidence: .8, maxScoreContribution: 10 }, result: { totalPhotos: 1, observations: [{ mediaId: "m", fieldId: "f", fieldLabel: "Kitchen", assessment: "issue", summary: "Visible debris", findings: [{ id: "finding", mediaId: "m", fieldId: "f", fieldLabel: "Kitchen", description: "Debris on floor", severity: "major", confidence: .95 }] }] } } } });
  });
  const fixture = new ReviewPage(page); await fixture.open();
  await expect(fixture.approve()).toBeDisabled(); expect(writes).toHaveLength(0);
  await page.getByLabel("Approve finding: Debris on floor").check(); await expect(fixture.approve()).toBeDisabled();
  await page.getByLabel("Review reason").fill("Verified debris against reference photo"); await fixture.approve().click();
  await expect(page.getByText("Approved deduction: 5 points (90 → 85).")).toBeVisible();
  expect(writes).toEqual([{ action: "approve", analysisId: "analysis", reason: "Verified debris against reference photo", findingIds: ["finding"], expectedReviewId: "qa", expectedScore: 90 }]);
  await expect(page.getByLabel("Approve finding: Debris on floor")).toBeDisabled();
});
