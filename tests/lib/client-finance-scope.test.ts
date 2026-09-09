import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {
  propertyClientRate: { findMany: vi.fn(async () => []) },
  clientInvoiceLine: { findMany: vi.fn(async () => []) },
  clientInvoice: { findMany: vi.fn(async () => []) },
  job: { findMany: vi.fn(async () => []) },
  priceBook: { findMany: vi.fn(async () => []) },
} }));
import { db } from "@/lib/db";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";

describe("delegated finance scope", () => {
  it("limits rates and work to granted properties and excludes mixed-property invoices", async () => {
    await getClientFinanceOverview("client", ["allowed"]);
    const property = { clientId: "client", id: { in: ["allowed"] } };
    expect(db.propertyClientRate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ property }) }));
    expect(db.job.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ property }) }));
    expect(db.clientInvoice.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lines: { some: {}, every: { job: { property } } } }),
    }));
  });
});
