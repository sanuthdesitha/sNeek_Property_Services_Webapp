// @vitest-environment node
/**
 * Route guards for the one account-creation flow (2026-11-16): live session
 * guards, testing-as refused, the Hiring pack for operations managers, the
 * response never carrying a link or password, and the Xero lookup being
 * read-only (GET through the token service, nothing created in Xero).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ops: vi.fn(),
  create: vi.fn(),
  hire: vi.fn(),
  preview: vi.fn(),
  move: vi.fn(),
  canTerms: vi.fn(),
  connected: vi.fn(),
  search: vi.fn(),
  sync: vi.fn(),
  token: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/db", () => ({ db: { client: { findUnique: vi.fn() }, laundrySupplier: { findUnique: vi.fn() } } }));
vi.mock("@/lib/accounts/create-account", () => ({
  createAccountWithInvitation: m.create,
  findAccountByEmail: vi.fn(async () => null),
  AccountCreateError: class extends Error {},
}));
vi.mock("@/lib/hiring/hire", () => ({
  hireApplicant: m.hire,
  loadHirePreview: m.preview,
  moveApplicationStage: m.move,
  HiringError: class HiringError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/billing/client-payment-terms", () => ({ canEditClientPaymentTerms: m.canTerms }));
vi.mock("@/lib/xero/client", () => ({ hasActiveXeroConnection: m.connected, searchXeroContacts: m.search, syncXeroContact: m.sync }));

import { POST as createUser } from "@/app/api/admin/users/route";
import { POST as hire } from "@/app/api/admin/workforce/hiring/applications/[id]/hire/route";
import { POST as stage } from "@/app/api/admin/workforce/hiring/applications/[id]/stage/route";
import { GET as xeroContacts } from "@/app/api/admin/clients/xero-contacts/route";

const admin = { user: { id: "admin-1", role: "ADMIN", heldRoles: ["ADMIN"] } };
const manager = { user: { id: "ops-1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const outcome = {
  user: { id: "u1", name: "Rosa", email: "rosa@example.invalid", role: "CLEANER" },
  replayed: false, signIn: "INVITATION", invitation: { expiresAt: "2026-11-21T00:00:00.000Z" },
  email: { state: "ACCEPTED", error: null }, sms: { state: "NOT_REQUESTED", error: null },
};
const post = (path: string, body: unknown) => new NextRequest(`https://app.invalid${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.ops.mockResolvedValue({ hiring: "manage" });
  m.create.mockResolvedValue(outcome);
  m.hire.mockResolvedValue({ outcome, applicationId: "a1" });
  m.move.mockResolvedValue({ id: "a1", from: "SCREENING", to: "INTERVIEW" });
});

describe("Invite person route", () => {
  it("creates through the shared service with SMS off unless ticked, and returns no link or password", async () => {
    const response = await createUser(post("/api/admin/users", { name: "Rosa", email: "rosa@example.invalid", role: "CLEANER", phone: "0438112905" }));
    expect(response.status).toBe(201);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ origin: "INVITE_PERSON", actor: { id: "admin-1", role: "ADMIN" }, input: expect.objectContaining({ role: "CLEANER", signIn: "INVITATION", sendSms: false }) }));
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("invitationLink\"");
    expect(text).not.toMatch(/accept-invite|tempPassword/);
  });

  it("is refused while testing as someone, before anything is created", async () => {
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1", mode: "FULL", startedAt: 0 } });
    const response = await createUser(post("/api/admin/users", { name: "x", email: "x@example.invalid", role: "CLEANER" }));
    expect(response.status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("is refused to operations managers (the live role guard)", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await createUser(post("/api/admin/users", { name: "x", email: "x@example.invalid", role: "CLEANER" }));
    expect(response.status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("Hiring routes", () => {
  it("an operations manager without Hiring at Manage cannot hire or move", async () => {
    m.requireRole.mockResolvedValue(manager);
    m.ops.mockResolvedValue({ hiring: "read" });
    expect((await hire(post("/x", { sendSms: false }), { params: { id: "a1" } })).status).toBe(403);
    expect((await stage(post("/x", { to: "INTERVIEW" }), { params: { id: "a1" } })).status).toBe(403);
    expect(m.hire).not.toHaveBeenCalled();
    expect(m.move).not.toHaveBeenCalled();
  });

  it("hire passes the explicit choice and SMS tick through, and never accepts packs from a manager", async () => {
    m.requireRole.mockResolvedValue(manager);
    const response = await hire(post("/x", { accountKind: "CLEANER", sendSms: true, opsPacks: ["finance"], idempotencyKey: "abcdefgh12" }), { params: { id: "a1" } });
    expect(response.status).toBe(201);
    expect(m.hire).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "a1", accountKind: "CLEANER", sendSms: true, opsPacks: undefined, idempotencyKey: "abcdefgh12" }));
    expect(JSON.stringify(await response.json())).not.toMatch(/accept-invite/);
  });

  it("a stage move to Hired is refused by the route's own schema (the account step owns it)", async () => {
    expect((await stage(post("/x", { to: "HIRED" }), { params: { id: "a1" } })).status).toBe(400);
    expect(m.move).not.toHaveBeenCalled();
  });
});

describe("Xero contact lookup (Add client)", () => {
  const get = (q: string) => xeroContacts(new NextRequest(`https://app.invalid/api/admin/clients/xero-contacts?q=${q}`));

  it("is read-only: searches and never syncs or creates a Xero contact", async () => {
    m.canTerms.mockResolvedValue(true);
    m.connected.mockResolvedValue(true);
    m.search.mockResolvedValue({ ok: true, contacts: [{ id: "c", name: "Seaside", email: null, status: "ACTIVE" }] });
    const response = await get("Sea");
    expect(response.status).toBe(200);
    expect(m.search).toHaveBeenCalledWith("Sea");
    expect(m.sync).not.toHaveBeenCalled();
  });

  it("says not connected in words, and refuses people without the finance right", async () => {
    m.canTerms.mockResolvedValue(true);
    m.connected.mockResolvedValue(false);
    expect(await (await get("Sea")).json()).toMatchObject({ connected: false, contacts: [], reason: expect.stringMatching(/not connected/) });
    m.canTerms.mockResolvedValue(false);
    expect((await get("Sea")).status).toBe(403);
    expect(m.search).not.toHaveBeenCalled();
  });
});
