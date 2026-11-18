// @vitest-environment node
/**
 * Client-handled maintenance routes (2026-11-18): who may call them.
 *  - office route: the live role guard (ADMIN, OPS_MANAGER); read-only
 *    impersonation cannot write; a take-back needs a reason; refusals carry
 *    their sentence; an operations manager is held to the Maintenance pack
 *    (read to GET, manage to POST) by the shared path rule;
 *  - client routes: the client-portal chokepoint with the maintenance
 *    permission; a refused or revoked caller gets 401/403; the action is
 *    handed the portal scope the chokepoint resolved, never a body field;
 *  - recipient scopes: the client notice reaches only the owning client while
 *    the item is with them; the office notice only maintenance readers;
 *  - no automatic or scheduled reminder exists anywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  portal: vi.fn(),
  view: vi.fn(),
  handOver: vi.fn(),
  remind: vi.fn(),
  takeBack: vi.fn(),
  list: vi.fn(),
  act: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: m.portal }));
vi.mock("@/lib/maintenance/client-handling-notices", () => ({ previewClientMessage: m.preview }));
vi.mock("@/lib/maintenance/client-handling", () => {
  class ClientHandlingError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return {
    ClientHandlingError,
    getAdminClientHandlingView: m.view,
    handOverToClient: m.handOver,
    remindClient: m.remind,
    takeBackFromClient: m.takeBack,
    listClientHandledItems: m.list,
    clientHandlingAct: m.act,
  };
});

import { GET as OFFICE_GET, POST as OFFICE_POST } from "@/app/api/admin/maintenance/[id]/client-handling/route";
import { GET as CLIENT_LIST } from "@/app/api/client/maintenance/handled/route";
import { POST as CLIENT_ACT } from "@/app/api/client/maintenance/handled/[id]/route";
import { ClientHandlingError } from "@/lib/maintenance/client-handling";
import { canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";

const params = { params: { id: "item-1" } };
const officePost = (body: unknown) => OFFICE_POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never, params);
const clientPost = (body: unknown) => CLIENT_ACT(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never, params);
const portalA = { clientId: "client-a", propertyIds: null, actor: "CLIENT", userId: "u-a", userName: "Ann", team: null };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
  m.portal.mockResolvedValue(portalA);
  m.view.mockResolvedValue({ itemId: "item-1" });
  m.preview.mockResolvedValue({ title: "Please arrange: Tap", body: "…" });
});

describe("office route", () => {
  it("guards GET and POST with the live ADMIN / OPS_MANAGER role guard", async () => {
    await OFFICE_GET(new Request("http://localhost/x") as never, params);
    expect(m.requireRole).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const refused = await officePost({ action: "TAKE_BACK", reason: "x" });
    expect(refused.status).toBe(403);
    expect(m.takeBack).not.toHaveBeenCalled();
  });
  it("refuses writes while viewing as someone else in read-only mode", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN }, impersonation: { actorId: "real-admin", mode: "READ_ONLY" } });
    const response = await officePost({ action: "HAND_OVER", transports: ["INBOX"], requestKey: "handover-12345678" });
    expect(response.status).toBe(403);
    expect(m.handOver).not.toHaveBeenCalled();
  });
  it("records the real actor behind a full test-as session", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "ops-target", role: Role.OPS_MANAGER }, impersonation: { actorId: "real-admin", mode: "FULL" } });
    m.handOver.mockResolvedValue({ outcome: "done", view: {} });
    await officePost({ action: "HAND_OVER", note: "Please use your plumber", transports: ["INBOX", "EMAIL"], requestKey: "handover-12345678" });
    expect(m.handOver).toHaveBeenCalledWith(expect.objectContaining({ actor: { userId: "ops-target", impersonatedBy: "real-admin" }, note: "Please use your plumber", transports: ["INBOX", "EMAIL"] }));
  });
  it("needs a reason to take back, and returns a refusal's own sentence", async () => {
    const missing = await officePost({ action: "TAKE_BACK", reason: "  " });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/Pick a reason/);
    m.remind.mockRejectedValue(new ClientHandlingError(409, "A reminder was sent at Wed 18 Nov 09:00."));
    const gap = await officePost({ action: "REMIND", transports: ["EMAIL"], requestKey: "remind-123456789" });
    expect(gap.status).toBe(409);
    expect((await gap.json()).error).toMatch(/A reminder was sent at/);
  });
  it("rejects unknown fields and transports (no SMS, no push)", async () => {
    expect((await officePost({ action: "REMIND", transports: ["SMS"], requestKey: "remind-123456789" })).status).toBe(400);
    expect((await officePost({ action: "HAND_OVER", transports: [], requestKey: "handover-12345678", payPayer: "CLIENT" })).status).toBe(400);
  });
  it("is the Maintenance pack for an operations manager: read to view, manage to change", () => {
    const path = "/api/admin/maintenance/item-1/client-handling";
    expect(opsRequestFeature(path)).toBe("maintenance");
    const read = { maintenance: "read" } as never;
    const manage = { maintenance: "manage" } as never;
    const off = { maintenance: "off" } as never;
    expect(canUseOpsPath(read, path, "GET")).toBe(true);
    expect(canUseOpsPath(read, path, "POST")).toBe(false);
    expect(canUseOpsPath(manage, path, "POST")).toBe(true);
    expect(canUseOpsPath(off, path, "GET")).toBe(false);
  });
});

describe("client routes", () => {
  it("use the client-portal chokepoint with the maintenance permission", async () => {
    m.list.mockResolvedValue([]);
    await CLIENT_LIST();
    expect(m.portal).toHaveBeenCalledWith({ permission: "maintenance" });
    expect(m.list).toHaveBeenCalledWith(portalA);
  });
  it("refuse a caller the chokepoint refuses (wrong role, revoked, assistant without the grant)", async () => {
    m.portal.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await CLIENT_LIST()).status).toBe(403);
    expect((await clientPost({ action: "ACCEPT" })).status).toBe(403);
    m.portal.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await clientPost({ action: "ACCEPT" })).status).toBe(401);
    expect(m.act).not.toHaveBeenCalled();
  });
  it("hands the resolved portal scope to the action; a body cannot name another client", async () => {
    m.act.mockResolvedValue({ outcome: "done", item: { id: "item-1" } });
    const refused = await clientPost({ action: "ACCEPT", clientId: "client-b" });
    expect(refused.status).toBe(400);
    await clientPost({ action: "DECLINE", reason: "I would prefer your team to do it", expectedVersion: 3 });
    expect(m.act).toHaveBeenCalledWith(portalA, expect.objectContaining({ itemId: "item-1", action: "DECLINE", reason: "I would prefer your team to do it", expectedVersion: 3 }));
  });
  it("passes a not-found refusal through as 404 (no existence oracle)", async () => {
    m.act.mockRejectedValue(new ClientHandlingError(404, "This item is not available to you."));
    const response = await clientPost({ action: "ACCEPT" });
    expect(response.status).toBe(404);
  });
  it("has no field for pay, cost or a login for the tradesperson", async () => {
    const response = await clientPost({ action: "SET_TRADESPERSON", tradesperson: { name: "Al", cost: 120 } });
    expect(response.status).toBe(400);
    expect(m.act).not.toHaveBeenCalled();
  });
});

describe("recipient scopes", () => {
  const reader = (item: unknown, user: unknown) => ({
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    propertyMaintenanceItem: { findUnique: vi.fn().mockResolvedValue(item) },
    appSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    jobAssignment: {}, laundryTask: {}, job: {},
  }) as never;
  const clientUser = { id: "u-a", role: "CLIENT", isActive: true, clientId: "client-a" };
  const scope = (type: string) => ({ userId: "u-a", role: "CLIENT" as const, scope: { kind: "ENTITY" as const, type, id: "item-1" } });

  it("MAINTENANCE_ITEM_CLIENT reaches the owning client only while the item is with them", async () => {
    const withClient = { clientVisible: true, clientHandling: "ACCEPTED", property: { clientId: "client-a" } };
    expect(await authorizeEntityRecipient(reader(withClient, clientUser), scope("MAINTENANCE_ITEM_CLIENT"))).toEqual({ ok: true, role: "CLIENT" });
    expect((await authorizeEntityRecipient(reader({ ...withClient, clientHandling: "TAKEN_BACK" }, clientUser), scope("MAINTENANCE_ITEM_CLIENT"))).ok).toBe(false);
    expect((await authorizeEntityRecipient(reader({ ...withClient, clientVisible: false }, clientUser), scope("MAINTENANCE_ITEM_CLIENT"))).ok).toBe(false);
    expect((await authorizeEntityRecipient(reader({ ...withClient, property: { clientId: "client-b" } }, clientUser), scope("MAINTENANCE_ITEM_CLIENT"))).ok).toBe(false);
    expect((await authorizeEntityRecipient(reader(withClient, { ...clientUser, isActive: false }), scope("MAINTENANCE_ITEM_CLIENT"))).ok).toBe(false);
  });
  it("MAINTENANCE_OFFICE reaches an administrator, never a client", async () => {
    const admin = { id: "u-a", role: "ADMIN", isActive: true, clientId: null };
    expect(await authorizeEntityRecipient(reader({ id: "item-1" }, admin), { ...scope("MAINTENANCE_OFFICE"), role: "ADMIN" })).toEqual({ ok: true, role: "ADMIN" });
    expect((await authorizeEntityRecipient(reader({ id: "item-1" }, clientUser), scope("MAINTENANCE_OFFICE"))).ok).toBe(false);
  });
});

describe("no automatic reminder", () => {
  const ROOT = join(__dirname, "..", "..");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : files(path);
      return /\.(ts|tsx|js|cjs|mjs)$/.test(name) ? [path] : [];
    });
  }
  it("only the office's manual route sends a reminder; no worker, schedule or sweep does", () => {
    const users = ["app", "lib", "workers", "worker", "services", "scripts"]
      .flatMap((dir) => files(join(ROOT, dir)))
      .map((path) => relative(ROOT, path).split("\\").join("/"))
      .filter((file) => /\bremindClient\s*\(|kind:\s*"reminder"/.test(readFileSync(join(ROOT, file), "utf8")));
    expect(users.sort()).toEqual(["app/api/admin/maintenance/[id]/client-handling/route.ts", "lib/maintenance/client-handling.ts"]);
  });
});
