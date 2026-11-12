// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

/**
 * Owner decision 2026-11-12: inspectors reorder their own day unless the office
 * has set it. The route's guards: live QA role, never while impersonated, the
 * office lock answered with its reason, stale writes refused.
 */
const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  reorderOwnDay: vi.fn(),
  getDayOrderState: vi.fn(),
  clearOfficeDayLock: vi.fn(),
  setOfficeDayOrder: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit } } }));
vi.mock("@/lib/qa/day-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/qa/day-order")>();
  return {
    ...actual,
    reorderOwnDay: m.reorderOwnDay,
    getDayOrderState: m.getDayOrderState,
    clearOfficeDayLock: m.clearOfficeDayLock,
    setOfficeDayOrder: m.setOfficeDayOrder,
  };
});

import { GET, PATCH } from "@/app/api/qa/visit-order/route";
import { DELETE as clearLock } from "@/app/api/admin/qa/day-order/route";
import { PATCH as officeReorder } from "@/app/api/admin/qa/assignments/reorder/route";

const lockedState = {
  dayKey: "2026-11-13",
  locked: true,
  setByOffice: true,
  setByName: "Mia (office)",
  setAt: "2026-11-12T22:00:00.000Z",
  unlockedByName: null,
  unlockedAt: null,
};

function patch(body: unknown) {
  return new NextRequest("http://local/api/qa/visit-order", { method: "PATCH", body: JSON.stringify(body) });
}
const body = { date: "2026-11-13", orderedAssignmentIds: ["b", "a"], expectedOrder: ["a", "b"] };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "qa-1", role: Role.QA_INSPECTOR } });
  m.audit.mockResolvedValue({});
});

describe("PATCH /api/qa/visit-order", () => {
  it("is for QA inspectors only, through the live role guard", async () => {
    m.reorderOwnDay.mockResolvedValue({ kind: "saved", updated: 2, state: { ...lockedState, locked: false, setByOffice: false } });
    const res = await PATCH(patch(body));
    expect(res.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith([Role.QA_INSPECTOR]);
    expect(m.reorderOwnDay).toHaveBeenCalledWith({
      inspectorId: "qa-1",
      dayKey: "2026-11-13",
      orderedAssignmentIds: ["b", "a"],
      expectedOrder: ["a", "b"],
    });
  });

  it("refuses a caller without the QA role", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const res = await PATCH(patch(body));
    expect(res.status).toBe(403);
    expect(m.reorderOwnDay).not.toHaveBeenCalled();
  });

  it("refuses while an administrator is testing as the inspector", async () => {
    m.requireRole.mockResolvedValue({
      user: { id: "qa-1", role: Role.QA_INSPECTOR },
      impersonation: { actorId: "admin-1", mode: "FULL" },
    });
    const res = await PATCH(patch(body));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("IMPERSONATING");
    expect(m.reorderOwnDay).not.toHaveBeenCalled();
  });

  it("answers an office-set day with the reason and who set it", async () => {
    m.reorderOwnDay.mockResolvedValue({ kind: "locked", state: lockedState });
    const res = await PATCH(patch(body));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Order set by the office");
    expect(json.dayOrder.setByName).toBe("Mia (office)");
  });

  it("refuses a stale write and returns the stored order", async () => {
    m.reorderOwnDay.mockResolvedValue({ kind: "stale", currentOrder: ["a", "c", "b"] });
    const res = await PATCH(patch(body));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE_ORDER");
  });

  it("refuses another inspector's visits", async () => {
    m.reorderOwnDay.mockResolvedValue({ kind: "invalid", message: "You can only reorder your own visits for that day." });
    const res = await PATCH(patch(body));
    expect(res.status).toBe(403);
  });

  it("refuses a day it cannot read", async () => {
    const res = await PATCH(patch({ ...body, date: "2026-02-31" }));
    expect(res.status).toBe(400);
    expect(m.reorderOwnDay).not.toHaveBeenCalled();
  });

  it("GET reads only the signed-in person's own day", async () => {
    m.getDayOrderState.mockResolvedValue(lockedState);
    const res = await GET(new NextRequest("http://local/api/qa/visit-order?date=2026-11-13&inspectorId=someone-else"));
    expect(res.status).toBe(200);
    expect(m.getDayOrderState).toHaveBeenCalledWith("qa-1", "2026-11-13");
  });
});

describe("office side", () => {
  it("clearing the lock is office-only and records the actor", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    m.clearOfficeDayLock.mockResolvedValue({ ...lockedState, locked: false, unlockedByName: "Ops" });
    const res = await clearLock(new NextRequest("http://local/api/admin/qa/day-order?inspectorId=qa-1&date=2026-11-13", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(m.clearOfficeDayLock).toHaveBeenCalledWith({ inspectorId: "qa-1", actorId: "ops-1", dayKey: "2026-11-13" });
  });

  it("an inspector cannot clear the lock", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const res = await clearLock(new NextRequest("http://local/api/admin/qa/day-order?inspectorId=qa-1&date=2026-11-13", { method: "DELETE" }));
    expect(res.status).toBe(403);
    expect(m.clearOfficeDayLock).not.toHaveBeenCalled();
  });

  it("the office reorder resolves 'today' to a Sydney date and reports the lock", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    m.setOfficeDayOrder.mockResolvedValue({ kind: "saved", updated: 2, state: lockedState });
    const res = await officeReorder(
      new NextRequest("http://local/api/admin/qa/assignments/reorder", {
        method: "PATCH",
        body: JSON.stringify({ inspectorId: "qa-1", date: "today", orderedAssignmentIds: ["a", "b"] }),
      })
    );
    expect(res.status).toBe(200);
    const call = m.setOfficeDayOrder.mock.calls[0][0];
    expect(call).toMatchObject({ inspectorId: "qa-1", actorId: "admin-1", orderedAssignmentIds: ["a", "b"] });
    expect(call.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await res.json()).dayOrder.locked).toBe(true);
  });
});
