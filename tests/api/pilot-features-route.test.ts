// @vitest-environment node
/** Settings › System › Pilot features route: live role, ADMIN-only changes, no changes while testing as someone. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ role: vi.fn(), save: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: async () => [] }, property: { findMany: async () => [] } } }));
vi.mock("@/lib/pilots/state", () => ({ savePilotSetting: m.save, loadPilotState: m.load, clearPilotCache: () => undefined }));

import { GET, PATCH } from "@/app/api/admin/pilot-features/route";
import { allOff } from "@/lib/pilots/registry";

const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/admin/pilot-features", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.load.mockResolvedValue(allOff(true));
  m.save.mockResolvedValue({});
});

describe("pilot features route", () => {
  it("lets an operations manager view but not change", async () => {
    m.role.mockResolvedValue({ user: { id: "ops", role: Role.OPS_MANAGER } });
    const view = await (await GET()).json();
    expect(view).toMatchObject({ readable: true, canEdit: false });
    expect(view.pilots.every((pilot: { mode: string }) => pilot.mode === "OFF")).toBe(true);
    const response = await patch({ key: "unused-check", mode: "ON" });
    expect(response.status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });

  it("refuses an administrator testing as someone else", async () => {
    m.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN }, impersonation: { actorId: "admin", mode: "FULL" } });
    expect((await patch({ key: "unused-check", mode: "ON" })).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("saves as the administrator, and refuses a scoped pilot with nobody chosen or an unknown pilot", async () => {
    m.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
    expect((await patch({ key: "unused-check", mode: "SCOPED" })).status).toBe(400);
    expect((await patch({ key: "nonsense", mode: "ON" })).status).toBe(400);
    const response = await patch({ key: "unused-check", mode: "SCOPED", userIds: ["cleaner-a"] });
    expect(response.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith({ id: "admin", role: Role.ADMIN }, { key: "unused-check", mode: "SCOPED", userIds: ["cleaner-a"], propertyIds: [] });
  });

  it("says when the stored state cannot be read", async () => {
    m.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
    m.load.mockResolvedValue(allOff(false));
    expect(await (await GET()).json()).toMatchObject({ readable: false });
  });
});
