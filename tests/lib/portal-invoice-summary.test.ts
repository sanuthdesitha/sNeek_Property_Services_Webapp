// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPortalInvoiceSummary } from "@/lib/billing/portal-invoice-summary";

const mocks = vi.hoisted(() => ({ session: vi.fn(), ctx: vi.fn(), settings: vi.fn(), settingRow: vi.fn(), invoice: vi.fn(), visible: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.ctx, propertyScopeWhere: (ctx: any) => ({ clientId: ctx.clientId, id: { in: ctx.propertyIds } }) }));
vi.mock("@/lib/settings", () => ({ DEFAULT_SETTINGS: {}, getAppSettings: mocks.settings }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: mocks.visible }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: mocks.settingRow }, clientInvoice: { findFirst: mocks.invoice } } }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "actor", role: "CLIENT" } });
  mocks.ctx.mockResolvedValue({ clientId: "own", propertyIds: null, visibility: {} });
  mocks.settings.mockResolvedValue({}); mocks.visible.mockReturnValue(true);
  mocks.invoice.mockResolvedValue({ id: "inv-1" });
});

describe("selected invoice access", () => {
  it.each(["ADMIN", "OPS_MANAGER"])("permits %s summary without extending the client path", async role => {
    mocks.session.mockResolvedValue({ user: { role } });
    await getPortalInvoiceSummary("inv-1", "admin");
    expect(mocks.invoice.mock.calls[0][0].where).toEqual({ AND: [{ id: "inv-1" }, {}] });
    expect(mocks.ctx).not.toHaveBeenCalled();
    await expect(getPortalInvoiceSummary("inv-1", "client")).rejects.toThrow("FORBIDDEN");
  });
  it.each(["CLIENT", "VA", "CLEANER", "LAUNDRY", "QA_INSPECTOR", "MAINTENANCE"])("refuses %s on admin summary", async role => {
    mocks.session.mockResolvedValue({ user: { role } });
    await expect(getPortalInvoiceSummary("inv-1", "admin")).rejects.toThrow("FORBIDDEN");
    expect(mocks.invoice).not.toHaveBeenCalled();
  });
  it("requires finance permission and selects only public summary fields", async () => {
    await getPortalInvoiceSummary("inv-1", "client");
    expect(mocks.ctx).toHaveBeenCalledWith({ settings: {}, permission: "invoicesView" });
    expect(mocks.visible).toHaveBeenCalledWith({}, "finance");
    expect(mocks.invoice.mock.calls[0][0]).toEqual({ where: { AND: [{ id: "inv-1" }, { clientId: "own", status: { notIn: ["DRAFT", "VOID"] } }] },
      select: { id: true, invoiceNumber: true, status: true, totalAmount: true, createdAt: true, sentAt: true, periodStart: true, periodEnd: true } });
  });
  it.each([{ propertyIds: [] }, { propertyIds: ["property-1"] }])("excludes empty/mixed/jobless invoices for property-scoped VA %#", async ({ propertyIds }) => {
    mocks.session.mockResolvedValue({ user: { role: "VA" } });
    mocks.ctx.mockResolvedValue({ clientId: "own", propertyIds, visibility: {} });
    await getPortalInvoiceSummary("inv-1", "client");
    expect(mocks.invoice.mock.calls[0][0].where.AND[1].lines).toEqual({ some: {}, every: { job: { property: { clientId: "own", id: { in: propertyIds } } } } });
  });
  it("does not query when finance visibility or permission is denied", async () => {
    mocks.visible.mockReturnValue(false);
    await expect(getPortalInvoiceSummary("inv-1", "client")).rejects.toThrow("FORBIDDEN");
    expect(mocks.invoice).not.toHaveBeenCalled();
    mocks.ctx.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(getPortalInvoiceSummary("inv-1", "client")).rejects.toThrow("FORBIDDEN");
    expect(mocks.invoice).not.toHaveBeenCalled();
  });
  it("propagates unavailable data rather than fabricating a zero invoice", async () => {
    mocks.invoice.mockRejectedValue(new Error("database unavailable"));
    await expect(getPortalInvoiceSummary("inv-1", "client")).rejects.toThrow("database unavailable");
  });
});
