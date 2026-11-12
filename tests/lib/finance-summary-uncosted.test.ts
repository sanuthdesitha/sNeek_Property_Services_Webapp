// @vitest-environment node
/**
 * Finance summary (overview estimate): a clean with no known pay rate is left
 * out of the cost, counted and flagged; it is never priced at the default rate.
 * Per-client payment terms: who may change them and the bounds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  jobs: vi.fn(), ops: vi.fn(), clientFind: vi.fn(), clientUpdate: vi.fn(), audit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const db = { userPayRate: { findMany: async () => [] }, staffLeave: { findMany: async () => [] }, 
    quote: { findMany: async () => [] },
    job: { findMany: m.jobs },
    laundryTask: { findMany: async () => [] },
    stockTx: { findMany: async () => [] },
    client: { findUnique: m.clientFind, update: m.clientUpdate },
    auditLog: { create: m.audit },
    $transaction: async (work: (tx: unknown) => unknown) => work(db),
  };
  return { db };
});
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ cleanerJobHourlyRates: {} }) }));
vi.mock("@/lib/inventory/unit-costs", () => ({ getInventoryUnitCosts: async () => ({}) }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));

import { getFinanceSummary, NO_PAY_RATE_ACCOUNTS_HREF } from "@/lib/finance/summary";
import { updateClientPaymentTerms } from "@/lib/billing/client-payment-terms";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const job = (id: string, payRate: number | null, hourlyRate: number | null) => ({
  id, jobType: "AIRBNB_TURNOVER", estimatedHours: 2, isRework: false, reworkPayAmount: null, internalNotes: null,
  property: { clientId: "c1", client: { name: "Client" } },
  assignments: [{ userId: `u-${id}`, payRate, removedAt: null, user: { hourlyRate } }],
  timeLogs: [], payAdjustments: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.clientFind.mockResolvedValue({ id: "c1", paymentTermsDays: null });
  m.clientUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue({});
});

describe("finance summary without a silent default rate", () => {
  it("costs only cleans with a known rate and flags the rest with a link to set rates", async () => {
    m.jobs.mockResolvedValue([job("rated", 30, null), job("user-rate", null, 25), job("no-rate", null, null)]);
    const summary = await getFinanceSummary({ startDate: "2026-10-01", endDate: "2026-10-31" });
    // 2h × $30 + 2h × $25; the unrated clean is not $40/h × 2h.
    expect(summary.totals.cleanerCost).toBe(110);
    expect(summary.uncosted).toEqual({ noPayRate: 1, jobIds: ["no-rate"], href: NO_PAY_RATE_ACCOUNTS_HREF });
    expect(summary.byClient[0]).toMatchObject({ cleanerCost: 110, uncostedNoPayRate: 1 });
    expect(NO_PAY_RATE_ACCOUNTS_HREF).toBe("/v2/admin/accounts?tab=cleaners&rate=none");
  });
});

describe("per-client payment terms", () => {
  it("an administrator sets 0–120 days or the default, audited", async () => {
    m.ops.mockResolvedValue(null);
    const result = await updateClientPaymentTerms({ clientId: "c1", body: { paymentTermsDays: 30 }, actor: { id: "a", role: "ADMIN" } });
    expect(result.status).toBe(200);
    expect(m.clientUpdate).toHaveBeenCalledWith({ where: { id: "c1" }, data: { paymentTermsDays: 30 } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_PAYMENT_TERMS_UPDATED", before: { paymentTermsDays: null }, after: expect.objectContaining({ paymentTermsDays: 30 }) }) });
    for (const bad of [121, -1, 7.5, "14"]) {
      expect((await updateClientPaymentTerms({ clientId: "c1", body: { paymentTermsDays: bad }, actor: { id: "a", role: "ADMIN" } })).status).toBe(400);
    }
    expect((await updateClientPaymentTerms({ clientId: "c1", body: { paymentTermsDays: null }, actor: { id: "a", role: "ADMIN" } })).status).toBe(200);
  });

  it("an operations manager needs finance manage; read-only finance is refused", async () => {
    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), finance: "read" });
    expect((await updateClientPaymentTerms({ clientId: "c1", body: { paymentTermsDays: 30 }, actor: { id: "o", role: "OPS_MANAGER" } })).status).toBe(403);
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), finance: "manage", clients: "manage" });
    expect((await updateClientPaymentTerms({ clientId: "c1", body: { paymentTermsDays: 30 }, actor: { id: "o", role: "OPS_MANAGER" } })).status).toBe(200);
  });
});
