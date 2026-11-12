// @vitest-environment node
/**
 * Parity audit 2026-11-12 (Quality): laundry team metrics readable through the
 * quality pack, the review queue counters on the inspections route, and the
 * old /admin/accountability links resolving to the Quality hub.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  metrics: vi.fn(),
  assignmentCount: vi.fn(),
  assignmentFindMany: vi.fn(),
  settings: vi.fn(),
  deliver: vi.fn(),
  userFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT ${href}`);
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/laundry/team-metrics", () => ({ getLaundryTeamMetrics: m.metrics }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.deliver }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.test${path}` }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/db", () => ({
  db: {
    qaAssignment: { count: m.assignmentCount, findMany: m.assignmentFindMany },
    user: { findMany: m.userFindMany, findUnique: m.userFindUnique },
  },
}));

import { GET as qualityLaundryTeam } from "@/app/api/admin/quality/laundry-team-metrics/route";
import { GET as inspections } from "@/app/api/admin/quality/inspections/route";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { notifyCoachingAcknowledged, notifyRecurringPatternAlert } from "@/lib/notifications/accountability";
import AccountabilityRedirect from "@/app/admin/accountability/page";
import CoachingRedirect from "@/app/admin/accountability/coaching/[id]/page";

const METRICS = { team: [{ userId: "l1", name: "Lee", pickups: 3, drops: 2, onTimeDropPct: 100, photoCompliancePct: 50, avgCycleDays: 1.5, stuckCount: 0 }], teamTotals: { stuckUnattributed: 0 }, suppliers: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
  m.metrics.mockResolvedValue(METRICS);
  m.settings.mockResolvedValue({ companyName: "Test", timezone: "Australia/Sydney" });
  m.assignmentCount.mockResolvedValue(0);
  m.assignmentFindMany.mockResolvedValue([]);
  m.userFindMany.mockResolvedValue([{ id: "a", role: "ADMIN", email: "a@test", phone: null, name: "A" }]);
  m.userFindUnique.mockResolvedValue({ id: "a", role: "ADMIN", email: "a@test", phone: null, name: "A", isActive: true });
});

describe("laundry team metrics through the quality pack", () => {
  const qualityOnly = { ...allOpsLevels("off"), quality: "read" as const };

  it("is gated by the quality pack, read only; the laundry route keeps the laundry pack", () => {
    expect(opsRequestFeature("/api/admin/quality/laundry-team-metrics")).toBe("quality");
    expect(canUseOpsPath(qualityOnly, "/api/admin/quality/laundry-team-metrics?period=30d", "GET")).toBe(true);
    expect(canUseOpsPath(qualityOnly, "/api/admin/quality/laundry-team-metrics", "POST")).toBe(false);
    expect(canUseOpsPath(qualityOnly, "/api/admin/laundry/team-metrics", "GET")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("off"), laundry: "read" }, "/api/admin/laundry/team-metrics", "GET")).toBe(true);
  });

  it("returns the same service's figures through the live role guard", async () => {
    const response = await qualityLaundryTeam(new NextRequest("http://localhost/api/admin/quality/laundry-team-metrics?period=7d"));
    expect(response.status).toBe(200);
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.metrics).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({ team: METRICS.team, suppliers: [], period: { key: "7d" } });
  });

  it("refuses when the guard refuses, and never reads the metrics", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await qualityLaundryTeam(new NextRequest("http://localhost/api/admin/quality/laundry-team-metrics?period=30d"));
    expect(response.status).toBe(403);
    expect(m.metrics).not.toHaveBeenCalled();
  });
});

describe("inspections route carries the review queue counters", () => {
  it("adds awaiting, in progress and completed today to the paged list", async () => {
    m.assignmentCount.mockImplementation(async (args: { where: { status: unknown } }) => {
      if (args.where.status === "IN_PROGRESS") return 2;
      if (args.where.status === "COMPLETED") return 7;
      if (typeof args.where.status === "object" && Array.isArray((args.where.status as { in: string[] }).in) && (args.where.status as { in: string[] }).in.length === 2) return 4;
      return 6; // the list's own total (open, assigned, in progress)
    });
    const response = await inspections(new NextRequest("http://localhost/api/admin/quality/inspections?page=1&pageSize=20"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(6);
    expect(body.counters).toEqual({ awaiting: 4, inProgress: 2, completedToday: 7, timeZone: "Australia/Sydney" });
  });
});

describe("old accountability links resolve to the Quality hub", () => {
  it("points the recurring-pattern alert at that cleaner's issues in that category", async () => {
    await notifyRecurringPatternAlert({ cleanerName: "Marco", category: "linen", count: 3, windowDays: 30, cleanerId: "c1" });
    const url = m.deliver.mock.calls[0][0].url as string;
    expect(url).toBe("https://app.test/v2/admin/quality?tab=issues&cleanerId=c1&category=linen&period=30d");
    expect(m.deliver.mock.calls[0][0].email.html).toContain(url);
    expect(url).not.toContain("/admin/accountability");
  });

  it("points 'coaching acknowledged' at the Coaching tab", async () => {
    await notifyCoachingAcknowledged({ createdById: "a", coachingId: "rec1", cleanerName: "Marco" });
    expect(m.deliver.mock.calls[0][0].url).toBe("https://app.test/v2/admin/quality?tab=coaching");
  });

  it("redirects /admin/accountability (keeping its query) and old coaching links", () => {
    expect(() => AccountabilityRedirect({ searchParams: { cleanerId: "c1" } })).toThrow("REDIRECT /v2/admin/quality?tab=cleaners&cleanerId=c1");
    expect(() => CoachingRedirect()).toThrow("REDIRECT /v2/admin/quality?tab=coaching");
    // The ops catalog keeps gating the old path by the quality pack.
    expect(opsRequestFeature("/admin/accountability")).toBe("quality");
  });
});
