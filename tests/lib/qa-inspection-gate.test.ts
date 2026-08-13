import { describe, it, expect } from "vitest";
import {
  decideInspectionStart,
  normalizeInspectionReason,
  MAX_INSPECTION_REASON_LENGTH,
} from "@/lib/qa/inspection-gate";

describe("decideInspectionStart", () => {
  it("allows a submitted job through with no reason", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS", hasSubmission: true });
    expect(result).toEqual({ outcome: "ALLOWED", earlyStartReason: null, shouldPushCleaner: false });
  });

  it("allows a gradable status through even without a submission row", () => {
    // The SUBMITTED transition and the FormSubmission write are not one
    // transaction, so status alone must still count as ready.
    const result = decideInspectionStart({ status: "SUBMITTED", hasSubmission: false });
    expect(result.outcome).toBe("ALLOWED");
  });

  it("ignores a reason on a job that is already ready", () => {
    const result = decideInspectionStart({ status: "COMPLETED" }, "not needed here at all");
    expect(result).toMatchObject({ outcome: "ALLOWED", earlyStartReason: null });
  });

  it("refuses an unsubmitted job when no reason is given", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS", hasSubmission: false });
    expect(result.outcome).toBe("REASON_REQUIRED");
    expect(result).toHaveProperty("message", expect.stringContaining("not submitted"));
  });

  it("refuses a too-short reason", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS" }, "busy");
    expect(result.outcome).toBe("REASON_REQUIRED");
  });

  it("refuses whitespace padded into looking long enough", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS" }, "   ok     ");
    expect(result.outcome).toBe("REASON_REQUIRED");
  });

  it("allows an unsubmitted job with a real reason and asks for a cleaner push", () => {
    const result = decideInspectionStart(
      { status: "IN_PROGRESS", hasSubmission: false },
      "  Guest checks in at 2pm, cleaner unreachable  "
    );
    expect(result).toEqual({
      outcome: "ALLOWED_EARLY",
      earlyStartReason: "Guest checks in at 2pm, cleaner unreachable",
      shouldPushCleaner: true,
    });
  });

  it("tells a rework apart from a first clean in the refusal message", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS", isRework: true });
    expect(result).toHaveProperty("message", expect.stringContaining("rework"));
  });

  it("treats a non-string reason as absent", () => {
    const result = decideInspectionStart({ status: "IN_PROGRESS" }, { note: "sneaky" });
    expect(result.outcome).toBe("REASON_REQUIRED");
  });
});

describe("normalizeInspectionReason", () => {
  it("trims and caps overly long text", () => {
    expect(normalizeInspectionReason("  hello  ")).toBe("hello");
    expect(normalizeInspectionReason("x".repeat(900))).toHaveLength(MAX_INSPECTION_REASON_LENGTH);
  });

  it("returns empty string for non-strings", () => {
    expect(normalizeInspectionReason(undefined)).toBe("");
    expect(normalizeInspectionReason(42)).toBe("");
  });
});
