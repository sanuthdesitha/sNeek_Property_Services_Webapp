import { describe, it, expect } from "vitest";
import { deriveJobStage, JOB_STAGE_LABELS, type JobStageInput } from "@/lib/cleaner/job-stage";

/**
 * Table-driven coverage for the pure cleaner journey-stage derivation. Each row
 * is a full input state → the expected stage, exercising the precedence rules.
 */

const base: JobStageInput = {
  needsAcceptance: false,
  hasStarted: false,
  locked: false,
  enRouteActive: false,
  arrived: false,
  formComplete: false,
};

describe("deriveJobStage", () => {
  const cases: Array<{ name: string; input: Partial<JobStageInput>; expected: 1 | 2 | 3 | 4 | 5 }> = [
    // Stage 1 — needsAcceptance wins over everything.
    { name: "offered job → Accept", input: { needsAcceptance: true }, expected: 1 },
    {
      name: "offered wins even if somehow en route",
      input: { needsAcceptance: true, enRouteActive: true },
      expected: 1,
    },
    {
      name: "offered wins even if locked",
      input: { needsAcceptance: true, locked: true, hasStarted: true },
      expected: 1,
    },

    // Stage 5 — locked wins over hasStarted.
    { name: "locked submitted → Wrap up", input: { locked: true }, expected: 5 },
    {
      name: "locked wins over started",
      input: { locked: true, hasStarted: true },
      expected: 5,
    },
    {
      name: "locked + formComplete still Wrap up",
      input: { locked: true, hasStarted: true, formComplete: true },
      expected: 5,
    },

    // Stage 4 — hasStarted (clocked in).
    { name: "clocked in → Clean", input: { hasStarted: true }, expected: 4 },
    {
      name: "clocked in ignores en route flag",
      input: { hasStarted: true, enRouteActive: true },
      expected: 4,
    },
    {
      name: "clocked in and arrived → Clean",
      input: { hasStarted: true, arrived: true },
      expected: 4,
    },

    // Stage 2 — en route only (accepted, not started).
    { name: "en route, not started → Get there", input: { enRouteActive: true }, expected: 2 },

    // Stage 3 — default for accepted-but-not-started (does NOT force travel).
    { name: "accepted, idle → Set up", input: {}, expected: 3 },
    {
      name: "arrived but not en route → Set up (no forced travel)",
      input: { arrived: true }, expected: 3,
    },
    {
      name: "not en route, not started → Set up even if formComplete",
      input: { formComplete: true }, expected: 3,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(deriveJobStage({ ...base, ...c.input })).toBe(c.expected);
    });
  }

  it("exposes a label for every stage", () => {
    for (const stage of [1, 2, 3, 4, 5] as const) {
      expect(JOB_STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});
