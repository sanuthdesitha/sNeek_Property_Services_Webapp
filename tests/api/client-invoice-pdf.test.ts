// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), portal: vi.fn(), allowed: vi.fn(), get: vi.fn(), render: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: m.portal }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findFirst: m.allowed }, appSetting: { findUnique: vi.fn() } } }));
vi.mock("@/lib/settings", () => ({ DEFAULT_SETTINGS: {} }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: m.enabled }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: m.get, renderClientInvoicePdf: m.render }));
import { GET } from "@/app/api/client/invoices/[id]/pdf/route";
const call = () => GET(new Request("http://local/api/client/invoices/inv/pdf"), { params: { id: "inv" } });
beforeEach(() => { vi.resetAllMocks(); m.role.mockResolvedValue({ user: { id: "client" } }); m.portal.mockResolvedValue({ actor: "CLIENT", clientId: "c1", visibility: { showFinanceDetails: true }, settings: { companyName: "Company", invoicing: {} } }); m.enabled.mockReturnValue(true); m.allowed.mockResolvedValue({ id: "inv" }); m.get.mockResolvedValue({ id: "inv", clientId: "c1", status: "SENT", invoiceNumber: 'INV-1"\r\nUnsafe' }); m.render.mockResolvedValue(Buffer.from("%PDF-test")); });
it("authorizes ownership before loading details and rendering a private attachment", async () => { const response = await call(); expect(response.status).toBe(200); expect(m.allowed).toHaveBeenCalledWith({ where: { id: "inv", clientId: "c1", status: { in: ["APPROVED", "SENT", "PART_PAID", "PAID"] } }, select: { id: true } }); expect(m.allowed.mock.invocationCallOrder[0]).toBeLessThan(m.get.mock.invocationCallOrder[0]); expect(m.get.mock.invocationCallOrder[0]).toBeLessThan(m.render.mock.invocationCallOrder[0]); expect(response.headers.get("content-type")).toBe("application/pdf"); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("content-disposition")).toBe('attachment; filename="INV-1___Unsafe.pdf"'); });
it("never loads or renders foreign or missing invoices", async () => { m.allowed.mockResolvedValue(null); expect((await call()).status).toBe(404); expect(m.get).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); });
it.each(["DRAFT", "VOID"])("rejects invoice changing to %s before rendering", async status => { m.get.mockResolvedValue({ clientId: "c1", status }); expect((await call()).status).toBe(404); expect(m.render).not.toHaveBeenCalled(); });
it("rechecks client ownership in the loaded snapshot", async () => { m.get.mockResolvedValue({ clientId: "foreign", status: "SENT" }); expect((await call()).status).toBe(404); expect(m.render).not.toHaveBeenCalled(); });
it.each(["UNAUTHORIZED", "FORBIDDEN"])("rejects %s before database access", async message => { m.role.mockRejectedValue(new Error(message)); expect((await call()).status).toBe(message === "UNAUTHORIZED" ? 401 : 403); expect(m.allowed).not.toHaveBeenCalled(); expect(m.render).not.toHaveBeenCalled(); });
it("retains CLIENT-only and merged finance visibility restrictions", async () => { m.portal.mockResolvedValue({ actor: "VA" }); expect((await call()).status).toBe(403); m.portal.mockResolvedValue({ actor: "CLIENT", visibility: {} }); m.enabled.mockReturnValue(false); expect((await call()).status).toBe(403); expect(m.allowed).not.toHaveBeenCalled(); });
it("hides renderer internals", async () => { m.render.mockRejectedValue(new Error("private storage URL")); const response = await call(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private storage URL"); });
