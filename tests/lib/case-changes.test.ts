import { describe, it, expect } from "vitest";
import { describeCaseChanges } from "@/lib/cases/changes";

/**
 * Cases exist to settle disputes, and until now only STATUS changes left a
 * trace. Someone could raise a case to CRITICAL, re-assign it, or make it
 * visible to the client, and the record showed nothing.
 */
describe("describeCaseChanges", () => {
  it("records a severity change", () => {
    expect(describeCaseChanges({ severity: "MEDIUM" }, { severity: "CRITICAL" })).toEqual([
      "Severity: MEDIUM → CRITICAL",
    ]);
  });

  it("records re-assignment, including to nobody", () => {
    expect(describeCaseChanges({ assignedToUserId: "u1" }, { assignedToUserId: "u2" })).toEqual([
      "Assigned: u1 → u2",
    ]);
    expect(describeCaseChanges({ assignedToUserId: "u1" }, { assignedToUserId: null })).toEqual([
      "Assigned: u1 → nothing",
    ]);
  });

  it("records making a case visible to the client", () => {
    // The moment a client can see a case is the moment it becomes evidence.
    expect(describeCaseChanges({ clientVisible: false }, { clientVisible: true })).toEqual([
      "Visible to client: no → yes",
    ]);
  });

  it("records linking and unlinking a job", () => {
    expect(describeCaseChanges({ jobId: null }, { jobId: "job-1" })).toEqual([
      "Linked job: nothing → job-1",
    ]);
    expect(describeCaseChanges({ jobId: "job-1" }, { jobId: null })).toEqual([
      "Linked job: job-1 → nothing",
    ]);
  });

  it("says nothing when a field is set to the value it already held", () => {
    // A timeline full of "severity: HIGH → HIGH" buries the entries that matter.
    expect(describeCaseChanges({ severity: "HIGH" }, { severity: "HIGH" })).toEqual([]);
    expect(describeCaseChanges({ clientVisible: true }, { clientVisible: true })).toEqual([]);
  });

  it("ignores fields the patch never mentioned", () => {
    expect(describeCaseChanges({ severity: "HIGH", title: "Leak" }, {})).toEqual([]);
  });

  it("treats empty string and null as the same absence", () => {
    // A cleared field should not read as a change when it was already blank.
    expect(describeCaseChanges({ resolutionNote: "" }, { resolutionNote: null })).toEqual([]);
    expect(describeCaseChanges({ assignedToUserId: null }, { assignedToUserId: "  " })).toEqual([]);
  });

  it("notes long free text as edited rather than quoting it", () => {
    const before = { description: "a".repeat(4000) };
    const after = { description: "b".repeat(4000) };
    // Quoting a 6000-character diff would swamp the timeline it clarifies.
    expect(describeCaseChanges(before, after)).toEqual(["Description edited"]);
  });

  it("humanises the case type", () => {
    expect(
      describeCaseChanges({ caseType: "DAMAGE_REPORT" }, { caseType: "SERVICE_ISSUE" })
    ).toEqual(["Type: DAMAGE REPORT → SERVICE ISSUE"]);
  });

  it("reports several changes in one edit, in a stable order", () => {
    const lines = describeCaseChanges(
      { severity: "LOW", assignedToUserId: null, clientVisible: false, jobId: null },
      { severity: "HIGH", assignedToUserId: "u9", clientVisible: true, jobId: "job-7" }
    );
    expect(lines).toEqual([
      "Severity: LOW → HIGH",
      "Assigned: nothing → u9",
      "Linked job: nothing → job-7",
      "Visible to client: no → yes",
    ]);
  });
});
