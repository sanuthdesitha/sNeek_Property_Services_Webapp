import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY SCHEDULED JOB MUST EXIST ON BOTH SCHEDULERS.
 *
 * There are two: the pg-boss worker (`workers/boss.ts`, the preferred one) and
 * a fallback in the web process (`lib/ops/web-scheduler.ts`) for a single
 * container with no worker. The fallback stands itself down the moment it sees
 * a pg-boss schedule, so anything registered ONLY in the fallback never runs on
 * a real deployment.
 *
 * That is exactly what happened. Eleven jobs — the visa/licence expiry check,
 * the missed-clock-in failsafe, the stale-en-route sweep, auto-pause, the QA
 * auto-score sweep and six more — lived only in the fallback and had never
 * fired in production. The code existed, was tested, and was documented as
 * shipped. The only symptom was an absence: a reminder nobody received, a sweep
 * nobody noticed not happening.
 *
 * This test reads both files as TEXT rather than importing them. Importing
 * `workers/boss.ts` would execute `main()` and try to open a pg-boss connection,
 * and importing the web scheduler drags in most of the application. The
 * registration name is a string literal in both files, which is all we need.
 *
 * A NEW JOB IS ADDED IN TWO PLACES OR IT IS NOT ADDED. If this fails, the fix is
 * to register the named job on the missing side — not to add it to an ignore
 * list.
 */

const ROOT = join(__dirname, "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/** `{ name: "ical-sync"` in the fallback's JOBS array. */
function fallbackJobNames(): string[] {
  const source = read("lib/ops/web-scheduler.ts");
  return Array.from(source.matchAll(/\{\s*name:\s*"([a-z0-9-]+)"/g), (m) => m[1]).sort();
}

/** `boss.schedule("ical-sync"` in the worker. */
function workerJobNames(): string[] {
  const source = read("workers/boss.ts");
  return Array.from(source.matchAll(/boss\.schedule\(\s*"([a-z0-9-]+)"/g), (m) => m[1]).sort();
}

describe("scheduler parity", () => {
  it("finds jobs on both sides at all — a broken regex must not pass as parity", () => {
    // Without this, renaming `boss.schedule` would empty both lists and the
    // subset check below would trivially succeed while covering nothing.
    expect(fallbackJobNames().length).toBeGreaterThan(20);
    expect(workerJobNames().length).toBeGreaterThan(20);
  });

  it("registers every fallback job on the pg-boss worker", () => {
    const worker = new Set(workerJobNames());
    const missing = fallbackJobNames().filter((name) => !worker.has(name));

    expect(
      missing,
      "These jobs are registered ONLY in lib/ops/web-scheduler.ts. The fallback " +
        "stands down whenever the worker is running, so on a real deployment " +
        `they never fire. Register them in workers/boss.ts: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("names each job exactly once per scheduler", () => {
    // A duplicate name means one registration silently shadows the other, and
    // which one wins depends on registration order rather than on intent.
    const sides: Array<[string, string[]]> = [
      ["web-scheduler", fallbackJobNames()],
      ["boss", workerJobNames()],
    ];
    for (const [label, names] of sides) {
      expect(new Set(names).size, `${label} registers a job name more than once`).toBe(
        names.length
      );
    }
  });
});
