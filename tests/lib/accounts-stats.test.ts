import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    clientInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    clientInvoiceLine: { findMany: vi.fn().mockResolvedValue([]) },
    property: { count: vi.fn().mockResolvedValue(0) },
    job: { findMany: vi.fn().mockResolvedValue([]) },
    jobFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    clientSatisfactionRating: { findMany: vi.fn().mockResolvedValue([]) },
    submissionMedia: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { getClientStats } from "@/lib/accounts/client-stats";
import { getPropertyStats } from "@/lib/accounts/property-stats";

describe("account stats", () => {
  it("client stats — returns zeros with no data", async () => {
    const s = await getClientStats("client-1");
    expect(s.totalSpend).toBe(0);
    expect(s.outstandingAmount).toBe(0);
    expect(s.invoicesPaid).toBe(0);
    expect(s.invoicesOutstanding).toBe(0);
    expect(s.propertiesCount).toBe(0);
    expect(s.activeSubscriptions).toBe(0);
    expect(s.totalJobs).toBe(0);
    expect(s.jobsLast30d).toBe(0);
    expect(s.jobsLast90d).toBe(0);
    expect(s.averageRating).toBeNull();
    expect(s.ratingSampleSize).toBe(0);
    expect(s.lastInvoiceAt).toBeNull();
    expect(s.lastJobAt).toBeNull();
  });

  it("property stats — returns zeros with no data", async () => {
    const s = await getPropertyStats("property-1");
    expect(s.totalJobs).toBe(0);
    expect(s.jobsLast30d).toBe(0);
    expect(s.jobsLast90d).toBe(0);
    expect(s.jobsLast365d).toBe(0);
    expect(s.lifetimeValue).toBe(0);
    expect(s.averageJobRating).toBeNull();
    expect(s.ratingSampleSize).toBe(0);
    expect(s.recentMediaUrls).toEqual([]);
    expect(s.cleanersWhoServiced).toBe(0);
    expect(s.lastJobAt).toBeNull();
  });
});
