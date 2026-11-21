// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may read and change personal notification switches:
 * - a person their own (a client login: its client account), never while
 *   testing as someone else;
 * - ADMIN anyone's; OPS_MANAGER reads only (ADMIN and OPS_MANAGER are not
 *   interchangeable); never while testing as someone else;
 * - every write names the actual actor.
 */
const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  userFindUnique: vi.fn(),
  apply: vi.fn(),
  userView: vi.fn(),
  clientView: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.requireSession, requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.userFindUnique } } }));
vi.mock("@/lib/notifications/personal/view", () => ({ buildUserSwitchesView: m.userView, buildClientSwitchesView: m.clientView }));
vi.mock("@/lib/notifications/personal/write", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/personal/write")>("@/lib/notifications/personal/write");
  return { ...actual, applySwitchChanges: m.apply };
});

import { GET as ownGet, PATCH as ownPatch } from "@/app/api/me/notification-switches/route";
import { GET as adminGet, PATCH as adminPatch } from "@/app/api/admin/notifications/switches/route";
import { StaleSwitchesError } from "@/lib/notifications/personal/write";

const body = JSON.stringify({ revision: 3, changes: [{ id: "all", on: false }] });
const patchReq = (url: string) => new NextRequest(url, { method: "PATCH", body });
const view = (kind: "USER" | "CLIENT", id: string) => ({ subject: { kind, id }, revision: 3 });

beforeEach(() => {
  vi.resetAllMocks();
  m.userView.mockImplementation(async (id: string, access: unknown) => ({ ...view("USER", id), access }));
  m.clientView.mockImplementation(async (id: string, access: unknown) => ({ ...view("CLIENT", id), access }));
  m.apply.mockResolvedValue(undefined);
});

describe("own switches", () => {
  it("a client login reads and changes its client account's switches, as itself", async () => {
    m.requireSession.mockResolvedValue({ user: { id: "login-1", name: "Ana", role: "CLIENT" }, impersonation: null });
    m.userFindUnique.mockResolvedValue({ clientId: "client-1" });
    expect(await (await ownGet()).json()).toMatchObject({ subject: { kind: "CLIENT", id: "client-1" }, access: { canEdit: true } });
    const res = await ownPatch(patchReq("http://localhost/api/me/notification-switches"));
    expect(res.status).toBe(200);
    expect(m.apply).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: "CLIENT", id: "client-1" }, actor: { id: "login-1", name: "Ana", role: "CLIENT" }, expectedRevision: 3 }));
  });

  it("while testing as someone else the switches are read-only and a change is refused", async () => {
    m.requireSession.mockResolvedValue({ user: { id: "cleaner-1", name: "Cleo", role: "CLEANER" }, impersonation: { actorId: "admin-1", mode: "VIEW" } });
    expect(await (await ownGet()).json()).toMatchObject({ subject: { kind: "USER", id: "cleaner-1" }, access: { canEdit: false } });
    const res = await ownPatch(patchReq("http://localhost/api/me/notification-switches"));
    expect(res.status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("a stale save is refused with the current switches", async () => {
    m.requireSession.mockResolvedValue({ user: { id: "cleaner-1", name: "Cleo", role: "CLEANER" }, impersonation: null });
    m.apply.mockRejectedValue(new StaleSwitchesError());
    const res = await ownPatch(patchReq("http://localhost/api/me/notification-switches"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "STALE", current: { subject: { id: "cleaner-1" } } });
  });
});

describe("someone else's switches", () => {
  it("an operations manager can read but not change them", async () => {
    m.requireRole.mockImplementation(async (roles: string[]) => {
      if (!roles.includes("OPS_MANAGER")) throw new Error("FORBIDDEN");
      return { user: { id: "ops-1", name: "Otto", role: "OPS_MANAGER" }, impersonation: null };
    });
    const read = await adminGet(new NextRequest("http://localhost/api/admin/notifications/switches?userId=cleaner-1"));
    expect(await read.json()).toMatchObject({ access: { canEdit: false, readOnlyReason: expect.stringContaining("administrator") } });
    const write = await adminPatch(patchReq("http://localhost/api/admin/notifications/switches?userId=cleaner-1"));
    expect(write.status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("an administrator changes them as themselves, never while testing as someone else", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin-1", name: "Ada", role: "ADMIN" }, impersonation: null });
    const ok = await adminPatch(patchReq("http://localhost/api/admin/notifications/switches?clientId=client-1"));
    expect(ok.status).toBe(200);
    expect(m.apply).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: "CLIENT", id: "client-1" }, actor: { id: "admin-1", name: "Ada", role: "ADMIN" } }));
    m.apply.mockClear();
    m.requireRole.mockResolvedValue({ user: { id: "client-login", name: "Ana", role: "CLIENT" }, impersonation: { actorId: "admin-1" } });
    const refused = await adminPatch(patchReq("http://localhost/api/admin/notifications/switches?clientId=client-1"));
    expect(refused.status).toBe(403);
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("names exactly one person or client", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin-1", name: "Ada", role: "ADMIN" }, impersonation: null });
    expect((await adminGet(new NextRequest("http://localhost/api/admin/notifications/switches"))).status).toBe(400);
    expect((await adminGet(new NextRequest("http://localhost/api/admin/notifications/switches?userId=a&clientId=b"))).status).toBe(400);
  });
});
