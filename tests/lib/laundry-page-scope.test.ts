// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Laundry-portal screens and counts that list tasks straight from the database. */
const FILES = [
  "app/v2/laundry/page.tsx",
  "app/v2/laundry/stats/page.tsx",
  "app/v2/laundry/reports/page.tsx",
  "app/v2/laundry/invoices/page.tsx",
  "app/api/laundry/attention-counts/route.ts",
];

describe("every laundry-portal read is limited to the viewer's properties", () => {
  it.each(FILES)("%s applies the viewer scope", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("laundryTaskScope(session.user)");
    const taskQueries = source.match(/laundryTask\s*\.\s*(findMany|count|groupBy|aggregate)/g) ?? [];
    const scoped = source.match(/\.\.\.scope\b/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(taskQueries.length);
  });
});
