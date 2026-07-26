import { describe, it, expect } from "vitest";
import {
  clientRequestMeta,
  hasOpenRequestOfType,
  isOpenClientRequest,
  clientRequestTitle,
  isClientRequestType,
} from "@/lib/job-tasks/client-requests";

function task(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { kind: "CLIENT_REQUEST", requestType: "ETA", note: "How far away?" },
    approvalStatus: "PENDING_APPROVAL",
    executionStatus: "OPEN",
    ...overrides,
  };
}

describe("clientRequestMeta", () => {
  it("parses a valid light-request task", () => {
    expect(clientRequestMeta(task())).toEqual({ requestType: "ETA", note: "How far away?" });
  });

  it("normalises a blank note to null", () => {
    expect(
      clientRequestMeta(task({ metadata: { kind: "CLIENT_REQUEST", requestType: "UPDATE", note: "   " } }))
    ).toEqual({ requestType: "UPDATE", note: null });
    expect(
      clientRequestMeta(task({ metadata: { kind: "CLIENT_REQUEST", requestType: "REPORT" } }))
    ).toEqual({ requestType: "REPORT", note: null });
  });

  it("rejects tasks that are not light requests", () => {
    expect(clientRequestMeta(task({ metadata: null }))).toBeNull();
    expect(clientRequestMeta(task({ metadata: "CLIENT_REQUEST" }))).toBeNull();
    expect(clientRequestMeta(task({ metadata: [] }))).toBeNull();
    // A reschedule request uses `type`, not `kind` — must not match.
    expect(
      clientRequestMeta(task({ metadata: { type: "RESCHEDULE_REQUEST", requestedDate: "2026-08-01" } }))
    ).toBeNull();
    expect(
      clientRequestMeta(task({ metadata: { kind: "CLIENT_REQUEST", requestType: "SOMETHING_ELSE" } }))
    ).toBeNull();
  });
});

describe("isOpenClientRequest", () => {
  it("is open while pending approval and not finished", () => {
    expect(isOpenClientRequest(task())).toBe(true);
    // executionStatus missing → treated as OPEN
    expect(isOpenClientRequest(task({ executionStatus: undefined }))).toBe(true);
  });

  it("is closed once decided or completed/cancelled", () => {
    expect(isOpenClientRequest(task({ approvalStatus: "APPROVED" }))).toBe(false);
    expect(isOpenClientRequest(task({ approvalStatus: "REJECTED" }))).toBe(false);
    expect(isOpenClientRequest(task({ approvalStatus: "AUTO_APPROVED" }))).toBe(false);
    expect(isOpenClientRequest(task({ executionStatus: "COMPLETED" }))).toBe(false);
    expect(isOpenClientRequest(task({ executionStatus: "CANCELLED" }))).toBe(false);
  });

  it("never treats non-light-request tasks as open", () => {
    expect(isOpenClientRequest(task({ metadata: { type: "RESCHEDULE_REQUEST" } }))).toBe(false);
  });
});

describe("hasOpenRequestOfType", () => {
  it("finds an open request of the same type", () => {
    expect(hasOpenRequestOfType([task()], "ETA")).toBe(true);
  });

  it("ignores open requests of other types", () => {
    expect(hasOpenRequestOfType([task()], "UPDATE")).toBe(false);
    expect(hasOpenRequestOfType([task()], "REPORT")).toBe(false);
  });

  it("ignores decided requests of the same type", () => {
    expect(hasOpenRequestOfType([task({ approvalStatus: "APPROVED" })], "ETA")).toBe(false);
    expect(hasOpenRequestOfType([task({ executionStatus: "COMPLETED" })], "ETA")).toBe(false);
  });

  it("handles a mixed task list (reschedules, add-ons, lights)", () => {
    const tasks = [
      task({ metadata: { type: "RESCHEDULE_REQUEST", requestedDate: "2026-08-01" } }),
      task({ metadata: null }), // plain add-on request
      task({ metadata: { kind: "CLIENT_REQUEST", requestType: "REPORT" } }),
    ];
    expect(hasOpenRequestOfType(tasks, "REPORT")).toBe(true);
    expect(hasOpenRequestOfType(tasks, "ETA")).toBe(false);
  });

  it("is false on an empty list", () => {
    expect(hasOpenRequestOfType([], "UPDATE")).toBe(false);
  });
});

describe("labels + type guard", () => {
  it("titles every request type", () => {
    expect(clientRequestTitle("UPDATE")).toBe("Update requested");
    expect(clientRequestTitle("ETA")).toBe("ETA requested");
    expect(clientRequestTitle("REPORT")).toBe("Report requested");
  });

  it("guards request types", () => {
    expect(isClientRequestType("ETA")).toBe(true);
    expect(isClientRequestType("eta")).toBe(false);
    expect(isClientRequestType(null)).toBe(false);
  });
});
