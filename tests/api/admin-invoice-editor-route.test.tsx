// @vitest-environment node
/**
 * Authorisation for the invoice editor: the page and its read model keep the
 * invoice API's roles (ADMIN, OPS_MANAGER); operations managers need the
 * finance feature to open it and "manage" on it to edit; ADMIN has full rights
 * independently of operations packs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getOpsAccess: vi.fn(),
  load: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.getOpsAccess }));
vi.mock("@/lib/billing/client-invoice-editor", () => ({ loadClientInvoiceEditor: m.load }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), releaseInvoiceConsumables: vi.fn() }));
vi.mock("@/lib/billing/client-invoice-patch", () => ({ patchClientInvoice: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/navigation", () => ({ notFound: m.notFound, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/v2/admin/finance/invoices/editor/invoice-editor-page", () => ({
  InvoiceEditorPage: (props: unknown) => ({ type: "InvoiceEditorPage", props }),
}));

import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { invoiceEditorAccess } from "@/lib/billing/client-invoice-access";
import { GET } from "@/app/api/admin/invoices/[id]/route";
import EditorRoute from "@/app/v2/admin/finance/invoices/[id]/page";

const admin = { user: { id: "a", role: "ADMIN" } };
const ops = { user: { id: "o", role: "OPS_MANAGER" } };

function levels(finance: "off" | "read" | "manage") {
  return { ...allOpsLevels("manage"), finance };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.getOpsAccess.mockResolvedValue(null);
  m.load.mockResolvedValue({ row: { id: "inv" } });
});

describe("invoiceEditorAccess", () => {
  it("gives ADMIN full rights regardless of packs", async () => {
    expect(await invoiceEditorAccess(admin.user, "inv")).toEqual({ canView: true, canManage: true });
  });
  it.each([
    ["manage", { canView: true, canManage: true }],
    ["read", { canView: true, canManage: false }],
    ["off", { canView: false, canManage: false }],
  ] as const)("operations manager with finance %s", async (level, expected) => {
    m.getOpsAccess.mockResolvedValue(levels(level));
    expect(await invoiceEditorAccess(ops.user, "inv")).toEqual(expected);
  });
});

describe("editor page", () => {
  it("uses the invoice API's role list", async () => {
    await EditorRoute({ params: { id: "inv" } });
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });

  it("refuses a role outside the list before loading anything", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(EditorRoute({ params: { id: "inv" } })).rejects.toThrow("FORBIDDEN");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("does not load the invoice for an operations manager without finance", async () => {
    m.requireRole.mockResolvedValue(ops);
    m.getOpsAccess.mockResolvedValue(levels("off"));
    const page = (await EditorRoute({ params: { id: "inv" } })) as { props: { children: unknown[] } };
    expect(JSON.stringify(page)).toContain("This section is not available to your account.");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("loads a view-only editor for finance read access", async () => {
    m.requireRole.mockResolvedValue(ops);
    m.getOpsAccess.mockResolvedValue(levels("read"));
    await EditorRoute({ params: { id: "inv" }, searchParams: { back: "status=SENT" } });
    expect(m.load).toHaveBeenCalledWith("inv", { canManage: false });
  });

  it("passes the remembered list view to the back link, and 404s an unknown invoice", async () => {
    const page = (await EditorRoute({ params: { id: "inv" }, searchParams: { back: "status=SENT" } })) as { props: { backHref: string } };
    expect(page.props.backHref).toBe("/v2/admin/finance?tab=invoices&status=SENT");
    m.load.mockResolvedValue(null);
    await expect(EditorRoute({ params: { id: "missing" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("GET /api/admin/invoices/[id]?view=editor", () => {
  const request = () => new NextRequest("http://local/api/admin/invoices/inv?view=editor");
  it("checks the live role guard and the manage level", async () => {
    m.requireRole.mockResolvedValue(ops);
    m.getOpsAccess.mockResolvedValue(levels("read"));
    const response = await GET(request(), { params: { id: "inv" } });
    expect(response.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.load).toHaveBeenCalledWith("inv", { canManage: false });
  });
  it("refuses without a session and 404s an unknown invoice", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await GET(request(), { params: { id: "inv" } })).status).toBeGreaterThanOrEqual(400);
    expect(m.load).not.toHaveBeenCalled();
    m.load.mockResolvedValue(null);
    expect((await GET(request(), { params: { id: "inv" } })).status).toBe(404);
  });
});
