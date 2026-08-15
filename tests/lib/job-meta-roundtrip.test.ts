import { describe, it, expect } from "vitest";
import {
  defaultJobMeta,
  parseJobInternalNotes,
  serializeJobInternalNotes,
} from "@/lib/jobs/meta";

/**
 * Regression cover for the reschedule corruption.
 *
 * `Job.internalNotes` is not free text — it carries the whole serialised
 * JobMeta blob. `applyReschedule` used to APPEND a plain line to it, which made
 * the JSON invalid; the next parse fell back to defaults and the next writer
 * re-serialised those defaults as clean JSON, permanently destroying the job's
 * timing rules, per-cleaner payouts, transport allowances and attachments.
 *
 * These pin the two properties that fix depends on: appending through the blob
 * preserves everything else, and the old concatenation demonstrably did not.
 */

function populatedMeta() {
  return {
    ...defaultJobMeta(),
    internalNoteText: "Original note",
    tags: ["urgent"],
    cleanerPayouts: { "user-1": 180 },
    transportAllowances: { "user-1": 25 },
    earlyCheckin: { enabled: true, preset: "custom" as const, time: "12:30" },
  };
}

describe("job meta round-trip (reschedule corruption)", () => {
  it("preserves every structured key when a reason is appended through the blob", () => {
    const before = populatedMeta();
    const stored = serializeJobInternalNotes({
      ...before,
      internalNoteText: [before.internalNoteText, "Reschedule reason: client asked"]
        .filter(Boolean)
        .join("\n"),
    });

    const after = parseJobInternalNotes(stored);
    expect(after.internalNoteText).toContain("Original note");
    expect(after.internalNoteText).toContain("Reschedule reason: client asked");
    // The keys the old concatenation destroyed:
    expect(after.tags).toEqual(["urgent"]);
    expect(after.cleanerPayouts).toEqual({ "user-1": 180 });
    expect(after.transportAllowances).toEqual({ "user-1": 25 });
    expect(after.earlyCheckin.enabled).toBe(true);
    expect(after.earlyCheckin.time).toBe("12:30");
  });

  it("demonstrates the OLD behaviour losing everything — the bug this pins", () => {
    const stored = serializeJobInternalNotes(populatedMeta());
    // What applyReschedule used to do: append a raw line to the JSON.
    const corrupted = `${stored}\nReschedule reason: client asked`;

    const after = parseJobInternalNotes(corrupted);
    // Invalid JSON degrades to defaults with the raw text preserved, so the
    // structured payload is gone even though nothing threw.
    expect(after.tags).toEqual([]);
    expect(after.cleanerPayouts).toEqual({});
    expect(after.transportAllowances).toEqual({});
    expect(after.earlyCheckin.enabled).toBe(false);
  });

  it("round-trips an empty blob without inventing content", () => {
    const after = parseJobInternalNotes(serializeJobInternalNotes(defaultJobMeta()));
    expect(after.internalNoteText).toBe("");
    expect(after.tags).toEqual([]);
  });

  it("treats plain legacy text as a note rather than throwing", () => {
    const after = parseJobInternalNotes("just a note someone typed");
    expect(after.internalNoteText).toBe("just a note someone typed");
    expect(after.tags).toEqual([]);
  });
});
