import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    clientInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    clientInvoiceLine: { findMany: vi.fn().mockResolvedValue([]) },
    property: { count: vi.fn().mockResolvedValue(0) },
    job: { findMany: vi.fn().mockResolvedValue([]) },
    jobFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    clientSatisfactionRating: { findMany: vi.fn().mockResolvedValue([]) },
    submissionMedia: { findMany: vi.fn().mockResolvedValue([]) },
    cleanerPayAdjustment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { db } from "@/lib/db";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

import { getClientExtras, getClientStats } from "@/lib/accounts/client-stats";
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


it("property history counts completed service dates and actual cleaners, never future appointments or edits", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  vi.mocked(db.job.findMany).mockResolvedValueOnce([
    {id:"done",status:"COMPLETED",scheduledDate:new Date("2026-09-17"),completedAt:new Date("2026-09-18T05:00:00Z"),updatedAt:new Date(),assignments:[{userId:"c1"}]},
    {id:"future",status:"ASSIGNED",scheduledDate:new Date("2027-01-01"),completedAt:null,assignments:[{userId:"c2"}]},
    {id:"legacy",status:"INVOICED",scheduledDate:new Date("2026-06-01"),completedAt:null,assignments:[{userId:"c1"}]},
  ] as any);
  const stats = await getPropertyStats("p1");
  expect(stats).toMatchObject({totalJobs:3,jobsLast30d:1,jobsLast90d:1,jobsLast365d:2,cleanersWhoServiced:1,lastJobAt:new Date("2026-09-18T05:00:00Z")});
  expect(db.job.findMany).toHaveBeenCalledWith(expect.objectContaining({select:expect.objectContaining({completedAt:true})}));
});

it("client outstanding balances subtract payments and exclude approved drafts", async () => {
  vi.mocked(db.clientInvoice.findMany).mockResolvedValueOnce([
    {status:"APPROVED",totalAmount:1000,paidAmount:0,createdAt:new Date("2026-01-01")},
    {status:"SENT",totalAmount:200,paidAmount:50,createdAt:new Date("2026-01-02")},
    {status:"PART_PAID",totalAmount:100,paidAmount:40,createdAt:new Date("2026-01-03")},
    {status:"PAID",totalAmount:400,paidAmount:400,createdAt:new Date("2026-01-04")},
  ] as any);
  const stats=await getClientStats("c1");
  expect(stats).toMatchObject({outstandingAmount:210,invoicesOutstanding:2,totalSpend:400,invoicesPaid:1});
});

it("client trend counts completed service dates rather than future appointments or rescheduled dates", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  vi.mocked(db.job.findMany).mockResolvedValueOnce([
    {status:"COMPLETED",scheduledDate:new Date("2026-09-30"),completedAt:new Date("2026-10-01")},
    {status:"ASSIGNED",scheduledDate:new Date("2026-10-02"),completedAt:null},
    {status:"INVOICED",scheduledDate:new Date("2026-09-01"),completedAt:null},
    {status:"COMPLETED",scheduledDate:null,completedAt:null},
  ] as any);
  const extras = await getClientExtras("client-1");
  expect(extras.trend.find(row => row.label === "Oct")?.jobs).toBe(1);
  expect(extras.trend.find(row => row.label === "Sept" || row.label === "Sep")?.jobs).toBe(1);
  expect(extras.trend.reduce((sum,row) => sum + row.jobs,0)).toBe(2);
  expect(db.job.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{property:{clientId:"client-1"}},select:expect.objectContaining({completedAt:true})}));
});

it("keeps client trend readable when job-history lookup fails without fabricating completed work", async () => {
  vi.mocked(db.job.findMany).mockRejectedValueOnce(new Error("offline"));
  const extras = await getClientExtras("client-1");
  expect(extras.trend).toHaveLength(6);
  expect(extras.trend.every(row => row.jobs === 0)).toBe(true);
});
