import { describe, expect, it } from "vitest";
import { qaQueueReadiness, qaQueueStage } from "@/lib/qa/queue-readiness";

describe("QA queue readiness", () => {
  it("trusts recognized server readiness and falls back to the existing submission policy", () => {
    expect(qaQueueReadiness({ inspectionReadiness: "CLEANING", status: "SUBMITTED" })).toBe("CLEANING");
    expect(qaQueueReadiness({ inspectionReadiness: "READY" })).toBe("READY");
    expect(qaQueueReadiness({ inspectionReadiness: "REWORK_PENDING" })).toBe("REWORK_PENDING");
    expect(qaQueueReadiness({ inspectionReadiness: "UNKNOWN", formSubmissions: [{}] })).toBe("READY");
    expect(qaQueueReadiness({ status: "SUBMITTED" })).toBe("READY");
    expect(qaQueueReadiness(undefined)).toBe("CLEANING");
  });
  it("does not imply a planned visit is evidence-ready before the cleaner submits", () => {
    const assignment = { scheduledFor: "2026-09-09T03:00:00Z" };
    expect(qaQueueStage({ status: "IN_PROGRESS" }, assignment)).toEqual({ stage: "WAITING", explanation: expect.stringContaining("requires a reason") });
    expect(qaQueueStage({ isRework: true }, assignment).explanation).toContain("rework submission");
    expect(qaQueueStage({ status: "SUBMITTED" }, assignment).stage).toBe("PLANNED");
    expect(qaQueueStage({ status: "SUBMITTED" }, { scheduledFor: "invalid" }).stage).toBe("READY");
    expect(qaQueueStage({ status: "SUBMITTED" }).stage).toBe("READY");
  });
  it("prioritizes unavailable, cancelled, completed and active inspection state", () => {
    expect(qaQueueStage(null).stage).toBe("BLOCKED");
    expect(qaQueueStage({}, { status: "CANCELLED" }).explanation).toContain("cancelled");
    expect(qaQueueStage({}, { status: "COMPLETED" }).stage).toBe("COMPLETED");
    expect(qaQueueStage({}, { status: "IN_PROGRESS" }).stage).toBe("INSPECTING");
  });
});
