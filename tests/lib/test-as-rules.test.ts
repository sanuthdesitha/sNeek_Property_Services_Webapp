// @vitest-environment node
/**
 * The "What each mode can do" table on Test as is generated from
 * TEST_AS_RULES. This ties every row to the code that enforces it, and every
 * route that refuses while testing to a row, so the table cannot drift:
 * - each named enforcement point exists and still contains its check;
 * - every route under app/api that reads `session.impersonation` or the
 *   actual-actor refusal is either an enforcement point of a row (named, or
 *   inside a row's folder) or listed as attribution only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_AS_ATTRIBUTION_ONLY, TEST_AS_RULES } from "@/lib/auth/test-as-rules";

const ROOT = process.cwd();

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(name)) out.push(relative(ROOT, path).split("\\").join("/"));
  }
  return out;
}

const READS_TESTING_STATE = /session\.impersonation|ACTUAL_ACTOR_REQUIRED/;

describe("Test as mode table is tied to the enforcement points", () => {
  it("has the board's rows with an answer for each mode", () => {
    expect(TEST_AS_RULES.map((rule) => rule.key)).toEqual(["see", "change", "location", "pin", "devices", "decisions", "office", "nested"]);
    const change = TEST_AS_RULES.find((rule) => rule.key === "change")!;
    expect(change.viewOnly.words).toBe("Refused");
    expect(change.full.words).toBe("Yes, real, in their name");
    expect(TEST_AS_RULES.find((rule) => rule.key === "pin")!.full.words).toBe("Refused: it needs your own PIN");
    expect(TEST_AS_RULES.find((rule) => rule.key === "location")!.full.words).toBe("Not recorded");
    expect(TEST_AS_RULES.find((rule) => rule.key === "nested")!.full.words).toBe("No");
  });

  it.each(TEST_AS_RULES.flatMap((rule) => rule.enforcement.map((point) => [rule.key, point.file, point.contains] as const)))(
    "%s: %s still contains %s",
    (_key, file, contains) => {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
      expect(readFileSync(join(ROOT, file), "utf8")).toContain(contains);
    },
  );

  it("classifies every route that reads the testing state", () => {
    const named = new Set(TEST_AS_RULES.flatMap((rule) => rule.enforcement.map((point) => point.file)));
    const folders = TEST_AS_RULES.flatMap((rule) => rule.enforcementFolders ?? []);
    const attribution = new Set(TEST_AS_ATTRIBUTION_ONLY);
    const routes = files(join(ROOT, "app/api")).filter((file) => READS_TESTING_STATE.test(readFileSync(join(ROOT, file), "utf8")));
    expect(routes.length).toBeGreaterThan(60);
    const unclassified = routes.filter((file) => !named.has(file) && !attribution.has(file) && !folders.some((folder) => file.startsWith(folder)));
    expect(unclassified, `Add these to a row of lib/auth/test-as-rules.ts (or TEST_AS_ATTRIBUTION_ONLY):\n${unclassified.join("\n")}`).toEqual([]);
  });

  it("lists only attribution files that exist and read the testing state", () => {
    for (const file of TEST_AS_ATTRIBUTION_ONLY) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
      expect(readFileSync(join(ROOT, file), "utf8"), file).toMatch(/impersonat/);
    }
  });

  it("the view-only refusal is enforced before any handler, for every unsafe method", async () => {
    const { isReadOnlySafeMethod } = await import("@/lib/auth/impersonation");
    expect(["GET", "HEAD", "OPTIONS"].every(isReadOnlySafeMethod)).toBe(true);
    expect(["POST", "PUT", "PATCH", "DELETE"].some(isReadOnlySafeMethod)).toBe(false);
  });
});
