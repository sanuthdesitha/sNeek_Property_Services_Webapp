// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import type { CheckMoveResult } from "@/lib/calendar/check-move";

const m = vi.hoisted(() => ({ session: vi.fn(), ops: vi.fn(), check: vi.fn(), reschedule: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/calendar/check-move", () => ({ checkCalendarMove: m.check }));
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: m.reschedule }));
import { POST } from "@/app/api/admin/jobs/bulk-reschedule/route";
import { BULK_RESCHEDULE_REASON } from "@/lib/jobs/bulk-reschedule";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/jobs/bulk-reschedule", { method: "POST", body: JSON.stringify(body) }));

function ok(jobId: string, overrides: Record<string, unknown> = {}): CheckMoveResult {
  return {
    kind: "ok",
    result: {
      jobId, propertyName: `Property ${jobId}`, fromDate: "2026-11-11", toDate: "2026-11-13", toCleanerName: null, blockers: [],
      warnings: [
        { kind: "clash", text: "Jane C.: Clashes with Manly Loft until 11:00" },
        { kind: "notice", text: "The reschedule notifies the assigned cleaners…" },
      ],
      plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, assign: null },
      ...overrides,
    },
  } as CheckMoveResult;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
  m.ops.mockResolvedValue(null);
  m.check.mockImplementation(async ({ jobId }: { jobId: string }) => {
    if (jobId === "started") return ok(jobId, { blockers: ["Work on this job has started. It cannot be moved from the calendar."], plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "x" }, assign: null } });
    if (jobId === "booking") return ok(jobId, { warnings: [{ kind: "booking", text: "This job follows a booking…" }] });
    if (jobId === "gone") return { kind: "not_found" };
    return ok(jobId);
  });
  m.reschedule.mockResolvedValue({});
});

describe("bulk Reschedule preview", () => {
  it("checks every job with the Calendar's move check, the new date and the time shift, and writes nothing", async () => {
    const response = await post({ mode: "preview", jobIds: ["a", "started", "booking", "gone"], toDate: "2026-11-13", shiftMinutes: 30 });
    expect(response.status).toBe(200);
    const { rows } = await response.json();
    expect(m.check.mock.calls.map((call) => call[0])).toEqual(["a", "started", "booking", "gone"].map((jobId) => ({ jobId, toDate: "2026-11-13", shiftMinutes: 30 })));
    expect(rows.map((row: { jobId: string; movable: boolean }) => [row.jobId, row.movable])).toEqual([["a", true], ["started", false], ["booking", true], ["gone", false]]);
    expect(rows[0].warnings).toEqual([{ kind: "clash", text: "Jane C.: Clashes with Manly Loft until 11:00" }]);
    expect(rows[1].blockers[0]).toMatch(/cannot be moved/);
    expect(rows[2].warnings[0].kind).toBe("booking");
    expect(rows[3].blockers).toEqual(["This job no longer exists."]);
    expect(m.reschedule).not.toHaveBeenCalled();
  });
});

describe("bulk Reschedule apply", () => {
  it("re-checks each row, saves movable ones through the reschedule service with the preview's version, and reports per row", async () => {
    m.reschedule.mockImplementation(async ({ jobId }: { jobId: string }) => {
      if (jobId === "b") throw new Error("This job changed. Reload before rescheduling.");
      return {};
    });
    const body = await (await post({
      mode: "apply", jobIds: ["a", "b", "started"], toDate: "2026-11-13",
      expectedUpdatedAt: { a: "2026-11-02T00:00:00.000Z" },
    })).json();
    expect(body.results).toEqual([
      { jobId: "a", propertyName: "Property a", outcome: "moved", message: "Rescheduled." },
      { jobId: "b", propertyName: "Property b", outcome: "failed", message: "This job changed. Reload before rescheduling." },
      { jobId: "started", propertyName: "Property started", outcome: "refused", message: "Work on this job has started. It cannot be moved from the calendar." },
    ]);
    expect(m.check).toHaveBeenCalledTimes(3);
    expect(m.reschedule).toHaveBeenCalledTimes(2);
    expect(m.reschedule.mock.calls[0][0]).toEqual({
      jobId: "a", date: "2026-11-13", userId: "admin", reason: BULK_RESCHEDULE_REASON, expectedUpdatedAt: "2026-11-02T00:00:00.000Z",
    });
  });

  it("passes the planned start and due times only when the time shifts", async () => {
    m.check.mockResolvedValue(ok("a", { plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "v", startTime: "10:30", dueTime: "14:30" }, assign: null } }));
    await post({ mode: "apply", jobIds: ["a"], toDate: "2026-11-13", shiftMinutes: 30 });
    expect(m.reschedule.mock.calls[0][0]).toMatchObject({ startTime: "10:30", dueTime: "14:30" });
  });
});

describe("bulk Reschedule access and input", () => {
  it("does not widen access: an operations manager needs Calendar manage, as for a single reschedule", async () => {
    m.session.mockResolvedValue({ user: { id: "ops", role: Role.OPS_MANAGER } });
    m.ops.mockResolvedValue({ jobs: "manage", calendar: "view" });
    const response = await post({ mode: "preview", jobIds: ["a"], toDate: "2026-11-13" });
    expect(response.status).toBe(403);
    expect(m.check).not.toHaveBeenCalled();
    m.ops.mockResolvedValue({ jobs: "manage", calendar: "manage" });
    expect((await post({ mode: "preview", jobIds: ["a"], toDate: "2026-11-13" })).status).toBe(200);
  });

  it("refuses malformed requests and more than 100 jobs", async () => {
    expect((await post({ mode: "preview", jobIds: [], toDate: "2026-11-13" })).status).toBe(400);
    expect((await post({ mode: "preview", jobIds: ["a"], toDate: "13/11/2026" })).status).toBe(400);
    expect((await post({ mode: "preview", jobIds: Array.from({ length: 101 }, (_, i) => `j${i}`), toDate: "2026-11-13" })).status).toBe(400);
    expect((await post({ mode: "preview", jobIds: ["a"], toDate: "2026-11-13", shiftMinutes: 900 })).status).toBe(400);
    expect(m.check).not.toHaveBeenCalled();
  });
});
