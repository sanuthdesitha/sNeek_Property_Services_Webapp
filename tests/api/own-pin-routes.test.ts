// @vitest-environment node
/**
 * Own PIN routes (owner decision 2026-11-13):
 *  - the actual actor rule (`actualActorRefusal`): only the signed-in person,
 *    never while testing as someone;
 *  - GET/POST/DELETE /api/me/admin-pin: one's own PIN only, password required;
 *  - POST /api/admin/users/[id]/reset-pin: administrators only, never on
 *    oneself, only for administrators and operations managers, confirmed with
 *    the administrator's own PIN;
 *  - POST /api/admin/security/verify (Rate card / Price book unlock): passes the
 *    new PIN through for the one-time transition and answers the code.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  impersonation: vi.fn(),
  realSession: vi.fn(),
  role: vi.fn(),
  userFind: vi.fn(),
  verify: vi.fn(),
  state: vi.fn(),
  setPin: vi.fn(),
  clearPin: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSession: m.getSession, requireRealSession: m.realSession, requireRole: m.role }));
vi.mock("@/lib/auth/impersonation-server", () => ({ resolveImpersonation: m.impersonation }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.userFind } } }));
vi.mock("@/lib/security/own-pin", () => ({ resetPersonPin: m.reset }));
vi.mock("@/lib/security/admin-verification", async () => {
  const rules = await import("@/lib/security/pin-rules");
  class SensitiveVerificationError extends Error {
    code: string;
    constructor(code: Parameters<typeof rules.sensitiveVerificationErrorMessage>[0]) {
      super(rules.sensitiveVerificationErrorMessage(code));
      this.code = code;
    }
  }
  return { SensitiveVerificationError, verifySensitiveAction: m.verify, getAdminPinState: m.state, setAdminPin: m.setPin, clearAdminPin: m.clearPin };
});

import { actualActorRefusal } from "@/lib/security/actual-actor";
import { DELETE as deleteOwnPin, GET as getOwnPin, POST as postOwnPin } from "@/app/api/me/admin-pin/route";
import { POST as resetPin } from "@/app/api/admin/users/[id]/reset-pin/route";
import { POST as verify } from "@/app/api/admin/security/verify/route";
import { SensitiveVerificationError } from "@/lib/security/admin-verification";

const req = (url: string, body?: unknown, method = "POST") => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue({ user: { id: "ops-1" } });
  m.impersonation.mockResolvedValue(null);
  m.realSession.mockResolvedValue({ user: { id: "ops-1", role: "OPS_MANAGER" } });
  m.userFind.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "cleaner-1" ? { id: "cleaner-1", role: "CLEANER", extraRoles: [] } : where.id === "admin-1" ? { id: "admin-1", role: "ADMIN", extraRoles: [] } : { id: where.id, role: "OPS_MANAGER", extraRoles: [] },
  );
  m.state.mockResolvedValue({ hasPin: true, updatedAt: null, lockedUntil: null, resetByAdministrator: false });
});

describe("actual actor rule", () => {
  it("accepts only the signed-in person acting as themselves", async () => {
    expect(await actualActorRefusal("ops-1")).toBeNull();
    expect(await actualActorRefusal("admin-1")).toBe("ACTUAL_ACTOR_REQUIRED");
    m.impersonation.mockResolvedValue({ actor: { id: "ops-1" }, target: { id: "cleaner-1" } });
    expect(await actualActorRefusal("ops-1")).toBe("ACTUAL_ACTOR_REQUIRED");
    m.getSession.mockResolvedValue(null);
    expect(await actualActorRefusal("ops-1")).toBe("UNAUTHORIZED");
  });
});

describe("/api/me/admin-pin", () => {
  it("returns the person's own PIN state and id, never a hash", async () => {
    const response = await getOwnPin();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ hasPin: true, updatedAt: null, lockedUntil: null, resetByAdministrator: false, userId: "ops-1" });
    expect(m.state).toHaveBeenCalledWith("ops-1");
  });

  it("refuses while testing as someone else, so nobody sets another person's PIN", async () => {
    m.impersonation.mockResolvedValue({ actor: { id: "ops-1" }, target: { id: "cleaner-1" } });
    const response = await postOwnPin(req("/api/me/admin-pin", { currentPassword: "pw", pin: "4826" }));
    expect(response.status).toBe(403);
    expect(m.setPin).not.toHaveBeenCalled();
  });

  it("refuses people who are not administrators or operations managers", async () => {
    m.realSession.mockResolvedValue({ user: { id: "cleaner-1", role: "CLEANER" } });
    m.getSession.mockResolvedValue({ user: { id: "cleaner-1" } });
    expect((await getOwnPin()).status).toBe(403);
  });

  it("needs the current password to set or remove the PIN", async () => {
    expect((await postOwnPin(req("/api/me/admin-pin", { pin: "4826" }))).status).toBe(400);
    expect((await deleteOwnPin(req("/api/me/admin-pin", {}, "DELETE"))).status).toBe(400);
    expect(m.setPin).not.toHaveBeenCalled();
    m.setPin.mockResolvedValue(undefined);
    const ok = await postOwnPin(req("/api/me/admin-pin", { currentPassword: "pw", pin: "4826" }));
    expect(ok.status).toBe(200);
    expect(m.setPin).toHaveBeenCalledWith("ops-1", "4826", "pw");
  });

  it("answers 429 while locked", async () => {
    m.setPin.mockRejectedValue(new SensitiveVerificationError("PIN_LOCKED"));
    const response = await postOwnPin(req("/api/me/admin-pin", { currentPassword: "pw", pin: "4826" }));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("PIN_LOCKED");
  });

  it("rate-limits PIN changes per person", async () => {
    m.realSession.mockResolvedValue({ user: { id: "ops-rate", role: "OPS_MANAGER" } });
    m.getSession.mockResolvedValue({ user: { id: "ops-rate" } });
    m.setPin.mockRejectedValue(new Error("Current password is incorrect."));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await postOwnPin(req("/api/me/admin-pin", { currentPassword: "bad", pin: "4826" }))).status);
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses[5]).toBe(429);
  });
});

describe("POST /api/admin/users/[id]/reset-pin", () => {
  beforeEach(() => {
    m.role.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    m.verify.mockResolvedValue(true);
    m.reset.mockResolvedValue({ hadPin: true });
  });

  it("clears an operations manager's PIN after the administrator's own PIN", async () => {
    const response = await resetPin(req("/api/admin/users/ops-1/reset-pin", { security: { pin: "2468" } }), { params: { id: "ops-1" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin-1", { pin: "2468" });
    expect(m.reset).toHaveBeenCalledWith("admin-1", "ops-1");
    expect(JSON.stringify(await response.json())).not.toMatch(/pin":"\d/);
  });

  it("is administrator only (the live role guard refuses an operations manager)", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await resetPin(req("/api/admin/users/ops-2/reset-pin", { security: { pin: "1" } }), { params: { id: "ops-2" } })).status).toBe(403);
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("refuses one's own PIN, a person without a PIN, and a wrong PIN", async () => {
    expect((await resetPin(req("/api/admin/users/admin-1/reset-pin", {}), { params: { id: "admin-1" } })).status).toBe(400);
    expect((await resetPin(req("/api/admin/users/cleaner-1/reset-pin", { security: { pin: "2468" } }), { params: { id: "cleaner-1" } })).status).toBe(400);
    m.verify.mockRejectedValue(new SensitiveVerificationError("INVALID_SECURITY_VERIFICATION"));
    expect((await resetPin(req("/api/admin/users/ops-1/reset-pin", { security: { pin: "0000" } }), { params: { id: "ops-1" } })).status).toBe(423);
    expect(m.reset).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/security/verify (Rate card and Price book unlock)", () => {
  beforeEach(() => {
    m.role.mockResolvedValue({ user: { id: "ops-1", role: "OPS_MANAGER" } });
  });

  it("checks the person's own PIN and passes a new PIN through for the one-time transition", async () => {
    m.verify.mockResolvedValue(true);
    expect((await verify(req("/api/admin/security/verify", { pin: "4826" }))).status).toBe(200);
    expect(m.verify).toHaveBeenLastCalledWith("ops-1", { pin: "4826", password: undefined, newPin: undefined });
    await verify(req("/api/admin/security/verify", { password: "pw", newPin: "4826" }));
    expect(m.verify).toHaveBeenLastCalledWith("ops-1", { pin: undefined, password: "pw", newPin: "4826" });
  });

  it("answers the refusal code: setup needed, testing as someone, locked", async () => {
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_SETUP_REQUIRED"));
    const setup = await verify(req("/api/admin/security/verify", { password: "pw" }));
    expect(setup.status).toBe(400);
    expect(await setup.json()).toMatchObject({ ok: false, code: "PIN_SETUP_REQUIRED", error: expect.stringMatching(/no PIN yet/) });
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("ACTUAL_ACTOR_REQUIRED"));
    expect((await verify(req("/api/admin/security/verify", { pin: "4826" }))).status).toBe(403);
    m.verify.mockRejectedValueOnce(new SensitiveVerificationError("PIN_LOCKED"));
    expect((await verify(req("/api/admin/security/verify", { pin: "4826" }))).status).toBe(429);
  });
});
