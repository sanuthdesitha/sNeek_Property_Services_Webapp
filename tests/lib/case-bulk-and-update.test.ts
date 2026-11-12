// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  assignees: vi.fn(),
  comment: vi.fn(),
  notify: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("@/lib/cases/service", () => ({ getCaseById: m.read, updateCase: m.update, listCaseAssignees: m.assignees }));
vi.mock("@/lib/db", () => ({ db: { caseComment: { create: m.comment } } }));
vi.mock("@/lib/cases/notifications", () => ({ notifyCaseUpdated: m.notify }));
vi.mock("@/lib/cases/summaries", () => ({ getCaseSummary: m.summary }));

import { applyCaseUpdate } from "@/lib/cases/apply-update";
import { runCaseBulk } from "@/lib/cases/bulk";

const actor = { id: "admin", name: "Admin" };

beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockImplementation(async (id: string) => (id === "gone" ? null : { id, status: "OPEN", clientVisible: false }));
  m.update.mockImplementation(async (id: string, patch: { status?: string }) => ({ id, status: patch.status ?? "OPEN", clientVisible: false }));
  m.summary.mockImplementation(async (id: string) => ({ id }));
  m.assignees.mockResolvedValue([{ id: "ops1" }]);
});

describe("applyCaseUpdate (shared by PATCH and bulk)", () => {
  it("refuses a status change without a note and writes nothing", async () => {
    const result = await applyCaseUpdate({ caseId: "c", patch: { status: "RESOLVED" }, actor });
    expect(result).toEqual({ ok: false, status: 400, error: "A note is required when changing case status." });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("records the status note as an internal comment and notifies without the client for a hidden case", async () => {
    const result = await applyCaseUpdate({ caseId: "c", patch: { status: "RESOLVED" }, statusChangeNote: "Fixed", actor });
    expect(result.ok).toBe(true);
    expect(m.comment.mock.calls[0][0].data).toMatchObject({ isInternal: true, body: expect.stringContaining("Fixed") });
    expect(m.notify.mock.calls[0][0].notifyClient).toBe(false);
  });
});

describe("runCaseBulk", () => {
  it("returns one outcome per case and reports a missing case as refused", async () => {
    const results = await runCaseBulk({ action: "status", ids: ["a", "gone", "b"], status: "WAITING_CLIENT", note: "Asked client" }, actor);
    expect(results).toEqual([
      { id: "a", outcome: "done", case: { id: "a" } },
      { id: "gone", outcome: "refused", reason: "Case not found." },
      { id: "b", outcome: "done", case: { id: "b" } },
    ]);
  });
  it("close and status changes require the note for every row", async () => {
    const results = await runCaseBulk({ action: "close", ids: ["a", "b"], note: "  " }, actor);
    expect(results.every((row) => row.outcome === "refused")).toBe(true);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("close uses the existing CLOSED status", async () => {
    await runCaseBulk({ action: "close", ids: ["a"], note: "Done" }, actor);
    expect(m.update.mock.calls[0][1]).toEqual({ status: "CLOSED" });
  });
  it("assign refuses an owner who is not an active office user", async () => {
    const results = await runCaseBulk({ action: "assign", ids: ["a"], assignedToUserId: "stranger" }, actor);
    expect(results[0]).toMatchObject({ outcome: "refused" });
    expect(m.update).not.toHaveBeenCalled();
    await runCaseBulk({ action: "assign", ids: ["a"], assignedToUserId: "ops1" }, actor);
    expect(m.update.mock.calls[0][1]).toEqual({ assignedToUserId: "ops1" });
  });
  it("a row that throws is refused with its reason while the others finish", async () => {
    m.update.mockImplementationOnce(async () => { throw new Error("JOB_NOT_FOUND"); });
    const results = await runCaseBulk({ action: "assign", ids: ["a", "b"], assignedToUserId: null }, actor);
    expect(results.map((row) => row.outcome)).toEqual(["refused", "done"]);
  });
});
