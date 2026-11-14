// @vitest-environment node
/**
 * "Simpler confirmations" (board approved 2026-11-14): the server rules behind
 * the dialogs whose confirmation changed.
 *
 *   - no route asks for a typed word, and required reasons have no minimum
 *     length (Xero reconcile, laundry void and undo void);
 *   - the Xero reconcile route still REQUIRES the correction reference, exactly
 *     as before (the dialog keeps it visible and required);
 *   - tier C actions whose PIN used to be checked only by the browser through
 *     the verify-only endpoint now verify `security` in the same request:
 *     checklist module delete, assistant team delete, remove an assistant,
 *     remove a shopping receipt, and the newly sensitive damage-submission void;
 *   - each refuses while testing as someone else, before any credential is read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  verify: vi.fn(),
  capability: vi.fn(),
  voidRun: vi.fn(),
  voidRuns: vi.fn(),
  undoVoid: vi.fn(),
  moduleFind: vi.fn(),
  moduleDelete: vi.fn(),
  audit: vi.fn(),
  teamFind: vi.fn(),
  removeMember: vi.fn(),
  deleteTeam: vi.fn(),
  teamClient: vi.fn(),
  runContext: vi.fn(),
  runUpdate: vi.fn(),
  damageVoid: vi.fn(),
  damageRead: vi.fn(),
  gatewayDelete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/rbac/can", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac/can")>("@/lib/rbac/can");
  return { ...actual, requireCapability: m.capability };
});
vi.mock("@/lib/laundry/run-corrections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/laundry/run-corrections")>("@/lib/laundry/run-corrections");
  return { ...actual, voidLaundryRun: m.voidRun, voidLaundryRuns: m.voidRuns, undoLaundryRunVoid: m.undoVoid };
});
vi.mock("@/lib/db", () => ({
  db: {
    checklistModule: { findUnique: m.moduleFind, delete: m.moduleDelete },
    paymentGateway: { delete: m.gatewayDelete },
    vaTeam: { findUnique: m.teamFind },
    auditLog: { create: m.audit },
    $transaction: async (work: (tx: unknown) => unknown) => work({ $queryRaw: vi.fn() }),
  },
}));
vi.mock("@/lib/va/teams", () => ({ removeVaMember: m.removeMember, deleteVaTeam: m.deleteTeam, updateVaTeam: vi.fn(), vaTeamUpdateSchema: { parse: (v: unknown) => v } }));
vi.mock("@/lib/inventory/shopping-runs", () => ({ getShoppingRunBillingContextById: m.runContext, updateShoppingRunByAdmin: m.runUpdate }));
vi.mock("@/lib/damage/void", () => ({ voidDamageReport: m.damageVoid }));
vi.mock("@/lib/damage/investigation", () => ({ getDamageInvestigationForAdmin: m.damageRead }));
vi.mock("@/lib/damage/review", () => ({ setDamageItemCost: vi.fn(), reviewDamageReport: vi.fn() }));

import { POST as reconcile } from "@/app/api/admin/invoices/[id]/reconcile/route";
import { POST as voidRuns } from "@/app/api/admin/laundry/runs/void/route";
import { POST as undoVoid } from "@/app/api/admin/laundry/runs/void/undo/route";
import { DELETE as deleteModule } from "@/app/api/admin/checklist-library/[moduleId]/route";
import { DELETE as deleteTeam } from "@/app/api/admin/va-teams/[id]/route";
import { DELETE as removeMember } from "@/app/api/admin/va-teams/[id]/members/[userId]/route";
import { PATCH as patchRun } from "@/app/api/admin/inventory/shopping-runs/[id]/route";
import { PATCH as patchDamage } from "@/app/api/admin/damage/[reportId]/route";
import { DELETE as deleteGateway } from "@/app/api/admin/payment-gateways/[id]/route";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";

const admin = { user: { id: "admin", role: "ADMIN" } };
const testing = { user: { id: "target", role: "OPS_MANAGER" }, impersonation: { actorId: "admin" } };
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) });
const version = "2026-11-14T00:00:00.000Z";
const receipt = (key: string) => ({ key, url: `https://files.example/${key}.jpg`, name: `${key}.jpg` });

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue(admin);
  m.verify.mockResolvedValue(true);
  m.capability.mockResolvedValue(undefined);
  m.voidRun.mockResolvedValue({ taskId: "t1", ok: true });
  m.undoVoid.mockResolvedValue({ taskId: "t1", ok: true });
  m.moduleFind.mockResolvedValue({ id: "mod", key: "kitchen", title: "Kitchen" });
  m.teamFind.mockResolvedValue({ clientId: "client" });
  m.runContext.mockResolvedValue({ payment: { receipts: [receipt("a"), receipt("b")] } });
  m.runUpdate.mockResolvedValue({ id: "run" });
  m.damageRead.mockResolvedValue({ id: "report" });
});

describe("Xero reconcile: reason without a minimum, reference still required", () => {
  const call = (body: Record<string, unknown>) => reconcile(json("http://local/api/admin/invoices/inv/reconcile", "POST", body), { params: { id: "inv" } });

  it("accepts a one-word quick-pick reason (the old 10-character minimum is gone) and goes on to the PIN", async () => {
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    await call({ reason: "Voided in Xero", reference: "CN-00412", confirmedInXero: true, security: { pin: "0000" } });
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "0000" }, "invoices.correct");
  });

  it("refuses an empty reason and a missing reference before reading the PIN", async () => {
    expect((await call({ reason: "  ", reference: "CN-00412", confirmedInXero: true, security: { pin: "4826" } })).status).toBe(409);
    expect((await call({ reason: "Voided in Xero", confirmedInXero: true, security: { pin: "4826" } })).status).toBe(409);
    expect(m.verify).not.toHaveBeenCalled();
  });

  it("asks for no typed word", async () => {
    m.verify.mockRejectedValueOnce(new Error("STOP"));
    const response = await call({ reason: "Duplicate in Xero", reference: "INV-9", confirmedInXero: true, security: { pin: "4826" } });
    expect((await response.json()).error).toBe("STOP");
  });
});

describe("laundry void and undo void: required reason, no minimum length", () => {
  const item = { taskId: "t1", expectedUpdatedAt: version };

  it("voids with a one-character reason and refuses an empty one", async () => {
    expect((await voidRuns(json("http://local/void", "POST", { items: [item], reason: "x", security: { pin: "4826" } }))).status).toBe(200);
    expect(m.voidRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "x" }));
    expect((await voidRuns(json("http://local/void", "POST", { items: [item], reason: "", security: { pin: "4826" } }))).status).toBe(400);
    expect(m.voidRun).toHaveBeenCalledTimes(1);
  });

  it("requires a reason to undo a void (new), with no minimum length", async () => {
    expect((await undoVoid(json("http://local/undo", "POST", { ...item, security: { pin: "4826" } }))).status).toBe(400);
    expect(m.verify).not.toHaveBeenCalled();
    expect((await undoVoid(json("http://local/undo", "POST", { ...item, reason: "Voided by mistake", security: { pin: "4826" } }))).status).toBe(200);
    expect(m.undoVoid).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "Voided by mistake" }));
  });
});

describe("tier C routes that now verify the PIN themselves", () => {
  type Case = { name: string; run: (security: unknown) => Promise<Response>; changed: () => ReturnType<typeof vi.fn> };
  const cases: Case[] = [
    {
      name: "checklist module delete",
      run: (security) => deleteModule(json("http://local/m", "DELETE", { security }), { params: { moduleId: "mod" } }),
      changed: () => m.moduleDelete,
    },
    {
      name: "assistant team delete",
      run: (security) => deleteTeam(json("http://local/t", "DELETE", { security }), { params: { id: "team" } }),
      changed: () => m.deleteTeam,
    },
    {
      name: "remove an assistant from a team",
      run: (security) => removeMember(json("http://local/t/m", "DELETE", { security }), { params: { id: "team", userId: "va" } }),
      changed: () => m.removeMember,
    },
    {
      name: "remove a shopping receipt",
      run: (security) => patchRun(json("http://local/run", "PATCH", { payment: { receipts: [receipt("a")] }, security }), { params: { id: "run" } }),
      changed: () => m.runUpdate,
    },
    {
      name: "delete a payment gateway",
      run: (security) => deleteGateway(json("http://local/g", "DELETE", { security }), { params: { id: "gw" } }),
      changed: () => m.gatewayDelete,
    },
    {
      name: "void a damage submission",
      run: (security) => patchDamage(json("http://local/d", "PATCH", { action: "VOID", mode: "KEEP_AND_REOPEN", reason: "Photos do not show the damage", security }), { params: { reportId: "report" } }),
      changed: () => m.damageVoid,
    },
  ];

  it.each(cases)("$name: verifies the own PIN on the server, then acts", async ({ run, changed }) => {
    const response = await run({ pin: "4826" });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "4826" });
    expect(changed()).toHaveBeenCalled();
  });

  it.each(cases)("$name: refuses a missing or wrong credential with 423 and changes nothing", async ({ run, changed }) => {
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_OR_PASSWORD_REQUIRED"));
    expect((await run(undefined)).status).toBe(423);
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    expect((await run({ pin: "0000" })).status).toBe(423);
    expect(changed()).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: refuses while testing as someone else before reading a credential", async ({ run, changed }) => {
    m.role.mockResolvedValue(testing);
    const response = await run({ pin: "4826" });
    expect(response.status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(changed()).not.toHaveBeenCalled();
  });

  it("adding a shopping receipt still needs no PIN", async () => {
    const response = await patchRun(json("http://local/run", "PATCH", { payment: { receipts: [receipt("a"), receipt("b"), receipt("c")] } }), { params: { id: "run" } });
    expect(response.status).toBe(200);
    expect(m.verify).not.toHaveBeenCalled();
  });

  it("a damage void reason is required but has no minimum length", async () => {
    const short = await patchDamage(json("http://local/d", "PATCH", { action: "VOID", mode: "KEEP_AND_REOPEN", reason: "Dup", security: { pin: "4826" } }), { params: { reportId: "report" } });
    expect(short.status).toBe(200);
    const empty = await patchDamage(json("http://local/d", "PATCH", { action: "VOID", mode: "KEEP_AND_REOPEN", reason: " ", security: { pin: "4826" } }), { params: { reportId: "report" } });
    expect(empty.status).toBe(400);
  });
});
