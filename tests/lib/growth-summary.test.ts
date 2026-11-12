/**
 * Growth hub figures (2026-11): real counts from each workspace's records,
 * blocks hidden when the viewer may not open that workspace, and no invented
 * figures (opens null until reported, recipients null when not recorded).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ opsAccess: vi.fn(), rows: vi.fn(), leadCount: vi.fn(), quoteCount: vi.fn(), campaigns: vi.fn(), events: vi.fn(), blogCount: vi.fn(), blogs: vi.fn(), groupBy: vi.fn(), positions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.opsAccess, getOpsGrants: vi.fn(async () => []) }));
vi.mock("@/lib/quotes/pipeline", async (original) => ({ ...(await original<typeof import("@/lib/quotes/pipeline")>()), loadPipelineRows: m.rows }));
vi.mock("@/lib/db", () => ({
  db: {
    quoteLead: { count: m.leadCount },
    quote: { count: m.quoteCount },
    emailCampaign: { findMany: m.campaigns },
    emailCampaignEvent: { count: m.events },
    blogPost: { count: m.blogCount, findMany: m.blogs },
    hiringApplication: { groupBy: m.groupBy },
    hiringPosition: { findMany: m.positions },
  },
}));

import { loadGrowthSummary } from "@/lib/growth/summary";

const lead = { kind: "lead", id: "l1", name: "Olivia", reference: "Lead · Randwick", serviceType: "AIRBNB_TURNOVER", suburb: "Randwick", total: null, estimateMin: null, estimateMax: null, margin: null, belowFloor: false, status: "NEW", stage: "new", frequency: null, clientId: null, leadId: "l1", email: null, phone: null, convertedJobId: null, hasQuote: false, updatedAt: "2026-11-12T00:00:00Z", createdAt: "2026-11-12T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  m.opsAccess.mockResolvedValue(null);
  m.rows.mockResolvedValue([lead]);
  m.leadCount.mockResolvedValueOnce(15).mockResolvedValueOnce(0);
  m.quoteCount.mockResolvedValueOnce(7).mockResolvedValueOnce(2);
  m.campaigns.mockResolvedValueOnce([{ id: "c1", recipientCount: 286 }, { id: "c2", recipientCount: null }]).mockResolvedValueOnce([]);
  m.events.mockResolvedValue(0);
  m.blogCount.mockResolvedValue(3);
  m.blogs.mockResolvedValue([]);
  m.groupBy.mockResolvedValue([{ status: "NEW", _count: { _all: 4 } }, { status: "INTERVIEW", _count: { _all: 2 } }]);
  m.positions.mockResolvedValue([]);
});

describe("loadGrowthSummary", () => {
  it("reads real counts and leaves unknown figures null", async () => {
    const summary = await loadGrowthSummary({ id: "a", role: "ADMIN" }, "Australia/Sydney", new Date("2026-11-12T03:00:00Z"));
    expect(summary.leads).toMatchObject({ newThisMonth: 15, newLastMonth: 0, quotesThisMonth: 7, wonThisMonth: 2 });
    expect(summary.leads?.counts.new).toBe(1);
    expect(summary.leads?.next[0]).toMatchObject({ name: "Olivia", label: "Make quote" });
    expect(summary.campaigns).toMatchObject({ sentThisMonth: 2, recipientsThisMonth: null, opensThisMonth: null });
    expect(summary.hiring).toMatchObject({ applied: 4, screening: 0, interview: 2, offer: 0 });
    expect(summary.monthStart).toBe("2026-10-31T13:00:00.000Z");
  });

  it("leaves out blocks an operations manager may not open", async () => {
    m.opsAccess.mockResolvedValue(new Proxy({ hiring: "off", marketing: "off" } as Record<string, string>, { get: (target, key: string) => target[key] ?? "read" }));
    const summary = await loadGrowthSummary({ id: "o", role: "OPS_MANAGER" }, "Australia/Sydney");
    expect(summary.hiring).toBeNull();
    expect(summary.campaigns).toBeNull();
    expect(summary.leads).not.toBeNull();
    expect(m.groupBy).not.toHaveBeenCalled();
  });
});
