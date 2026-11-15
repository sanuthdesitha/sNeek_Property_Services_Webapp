// @vitest-environment node
/**
 * The assign dialog's facts come from the same helpers the assign routes use
 * for their 409: leave on the job's day and an expired police check or visa.
 */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ jobs: vi.fn(), users: vi.fn(), group: vi.fn(), leave: vi.fn(), documents: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: m.jobs }, user: { findMany: m.users }, jobAssignment: { groupBy: m.group } } }));
vi.mock("@/lib/accounts/leave", () => ({ loadLeaveForUsers: m.leave }));
vi.mock("@/lib/workforce/assignment-document-warnings", () => ({ assignmentDocumentWarnings: m.documents }));
import { loadAssignFacts } from "@/lib/jobs/assign-facts-load";

beforeEach(() => {
  vi.resetAllMocks();
  m.jobs.mockResolvedValue([{ id: "j1", scheduledDate: new Date("2026-11-21T00:00:00Z") }]);
  m.users.mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]);
  m.leave.mockResolvedValue(new Map([["u2", [{ startDate: "2026-11-19", endDate: "2026-11-23", kind: "LEAVE" }]]]));
  m.documents.mockResolvedValue([{ userId: "u3", name: "Liam", kind: "POLICE_CHECK", reason: "police check expired 2 Oct 2026", expiredOn: "2026-10-02" }]);
  m.group.mockResolvedValue([{ userId: "u1", _count: { _all: 2 } }]);
});

it("marks leave and expired documents per cleaner and counts other jobs that day", async () => {
  const facts = await loadAssignFacts(["j1"]);
  expect(facts?.cleaners).toEqual([
    { userId: "u1", otherJobsThatDay: 2, warnings: [] },
    { userId: "u2", otherJobsThatDay: 0, warnings: [{ kind: "leave", jobId: "j1", text: "On leave 19–23 Nov" }] },
    { userId: "u3", otherJobsThatDay: 0, warnings: [{ kind: "police_check", jobId: "j1", text: "police check expired 2 Oct 2026" }] },
  ]);
});

it("returns null when a job is missing, so the route answers 404", async () => {
  expect(await loadAssignFacts(["j1", "gone"])).toBeNull();
});
