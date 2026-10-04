import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kickWebScheduledOps } from "@/lib/ops/web-scheduler";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");
describe("dedicated scheduler boundary", () => {
  it("never starts work from a page render or the compatibility hook", () => {
    expect(read("app/layout.tsx")).not.toContain("kickWebScheduledOps");
    expect(kickWebScheduledOps()).toBeUndefined();
    expect(read("lib/ops/web-scheduler.ts")).not.toMatch(/import |setTimeout|db\./);
  });
  it("registers every scheduled job explicitly in Sydney exactly once", () => {
    const source = read("workers/boss.ts");
    const schedules = [...source.matchAll(/await boss\.schedule\(([^\n]+)\);/g)].map(m => m[1]);
    expect(schedules.length).toBeGreaterThan(20);
    for (const call of schedules) expect(call).toMatch(/, \{ tz: TZ \}$/);
    const names = schedules.map(call => call.split(",")[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(source).toContain('const TZ = "Australia/Sydney"');
    expect(names).toContain('"auto-clockout-sweep"');
  });
  it("keeps short campaign dispatch and daily review cache refresh", () => {
    const source = read("workers/boss.ts");
    expect(source).toContain('boss.schedule("email-campaign-dispatch", "*/5 * * * *"');
    expect(source).toContain('boss.schedule("marketing-campaign-dispatch", "*/5 * * * *"');
    expect(source).toContain('boss.schedule("google-reviews-refresh", "0 3 * * *"');
  });
});
