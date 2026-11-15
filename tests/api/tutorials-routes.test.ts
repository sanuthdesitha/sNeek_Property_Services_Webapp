// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  state: vi.fn(),
  record: vi.fn(),
  preference: vi.fn(),
  settings: vi.fn(),
  stats: vi.fn(),
  roleSwitch: vi.fn(),
  saveTour: vi.fn(),
  person: vi.fn(),
  reset: vi.fn(),
  legacy: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: m.session, requireRole: m.role }));
vi.mock("@/lib/auth/account-state", () => ({ getAuthUserState: m.legacy }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.findUser, findMany: m.findUsers } } }));
vi.mock("@/lib/tutorials/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tutorials/store")>();
  return {
    ...actual,
    readTourClientState: m.state,
    recordTourProgress: m.record,
    updateTourPreference: m.preference,
    readTourSettings: m.settings,
    readTourStats: m.stats,
    setRoleToursOn: m.roleSwitch,
    saveTourSetting: m.saveTour,
    readPersonTours: m.person,
    resetPersonTours: m.reset,
  };
});

import { GET as meGet, POST as mePost } from "@/app/api/me/tours/route";
import { PATCH as prefPatch } from "@/app/api/me/tours/preference/route";
import { GET as adminGet, PATCH as adminPatch } from "@/app/api/admin/tutorials/route";
import { PATCH as tourPatch } from "@/app/api/admin/tutorials/tours/[key]/route";
import { GET as peopleGet } from "@/app/api/admin/tutorials/people/route";
import { GET as personGet, PATCH as personPatch } from "@/app/api/admin/tutorials/people/[id]/route";

const ORIGIN = "http://app.test";
function write(path: string, body: unknown, method = "POST", origin = ORIGIN) {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers: { origin, host: "app.test", "content-type": "application/json" }, body: JSON.stringify(body) });
}
const progressBody = { tourKey: "cleaner.today", version: 1000, status: "IN_PROGRESS", seenSteps: ["clock"], currentStep: 1 };
const cleaner = { user: { id: "cleaner-1", role: "CLEANER", heldRoles: ["CLEANER"] } };

beforeEach(() => {
  vi.resetAllMocks();
  m.state.mockResolvedValue({ recordable: true, progress: {} });
  m.record.mockResolvedValue({ tourKey: "cleaner.today" });
  m.settings.mockResolvedValue({ roles: {}, tours: {} });
  m.stats.mockResolvedValue([]);
  m.legacy.mockResolvedValue({ tutorialSeen: true });
});

describe("a person's own progress", () => {
  it("needs a live session", async () => {
    m.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await meGet()).status).toBe(401);
    expect((await mePost(write("/api/me/tours", progressBody))).status).toBe(401);
    expect(m.state).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });

  it("reads and writes only the signed-in person's rows", async () => {
    m.session.mockResolvedValue(cleaner);
    await meGet();
    expect(m.state).toHaveBeenCalledWith(expect.anything(), { userId: "cleaner-1", role: "CLEANER", impersonating: false, legacyWelcomeSeen: true });
    const response = await mePost(write("/api/me/tours", { ...progressBody, userId: "someone-else" }));
    expect(response.status).toBe(200);
    expect(m.record).toHaveBeenCalledWith(expect.anything(), "cleaner-1", expect.not.objectContaining({ userId: expect.anything() }));
  });

  it("never reads or writes anyone's progress while testing as someone else", async () => {
    m.session.mockResolvedValue({ ...cleaner, impersonation: { actorId: "admin-1", mode: "FULL", startedAt: 1 } });
    await meGet();
    expect(m.legacy).not.toHaveBeenCalled();
    expect(m.state).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ impersonating: true }));
    const post = await mePost(write("/api/me/tours", progressBody));
    expect(post.status).toBe(409);
    expect((await post.json()).recorded).toBe(false);
    expect((await prefPatch(write("/api/me/tours/preference", { toursOn: false }, "PATCH"))).status).toBe(409);
    expect(m.record).not.toHaveBeenCalled();
    expect(m.preference).not.toHaveBeenCalled();
  });

  it("refuses cross-origin writes, unknown tours and tours for another role", async () => {
    m.session.mockResolvedValue(cleaner);
    expect((await mePost(write("/api/me/tours", progressBody, "POST", "https://evil.test"))).status).toBe(403);
    expect((await mePost(write("/api/me/tours", { ...progressBody, tourKey: "admin.jobs" }))).status).toBe(403);
    expect((await mePost(write("/api/me/tours", { ...progressBody, tourKey: "nope" }))).status).toBe(403);
    expect((await mePost(write("/api/me/tours", { ...progressBody, status: "WON" }))).status).toBe(400);
    expect(m.record).not.toHaveBeenCalled();
  });
});

describe("Settings › System › Tutorials", () => {
  const ops = { user: { id: "ops-1", role: "OPS_MANAGER" } };
  const admin = { user: { id: "admin-1", role: "ADMIN" } };

  it("lets administrators and operations managers view, and says only administrators edit", async () => {
    m.role.mockResolvedValue(ops);
    const response = await adminGet();
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect((await response.json()).canEdit).toBe(false);
    m.role.mockResolvedValue(admin);
    expect((await (await adminGet()).json()).canEdit).toBe(true);
  });

  it("requires ADMIN for every change (role switch, tour wording, a person's reset)", async () => {
    m.role.mockImplementation(async (roles: string[]) => {
      if (!roles.includes("OPS_MANAGER")) throw new Error("FORBIDDEN");
      return ops;
    });
    expect((await adminPatch(write("/api/admin/tutorials", { role: "CLEANER", toursOn: false }, "PATCH"))).status).toBe(403);
    expect((await tourPatch(write("/api/admin/tutorials/tours/admin.jobs", { status: "PAUSED" }, "PATCH"), { params: { key: "admin.jobs" } })).status).toBe(403);
    expect((await personPatch(write("/api/admin/tutorials/people/u1", { reset: "all" }, "PATCH"), { params: { id: "u1" } })).status).toBe(403);
    expect(m.roleSwitch).not.toHaveBeenCalled();
    expect(m.saveTour).not.toHaveBeenCalled();
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("an administrator's change uses their own id and validates targets from the registry", async () => {
    m.role.mockResolvedValue(admin);
    m.saveTour.mockResolvedValue({ status: "LIVE" });
    const ok = await tourPatch(write("/api/admin/tutorials/tours/admin.jobs", { steps: [{ id: "row", body: "Open a job." }] }, "PATCH"), { params: { key: "admin.jobs" } });
    expect(ok.status).toBe(200);
    expect(m.saveTour).toHaveBeenCalledWith(expect.anything(), "admin.jobs", expect.any(Object), "admin-1");
    const bad = await tourPatch(write("/api/admin/tutorials/tours/admin.jobs", { steps: [{ id: "row", target: "#free-css" }] }, "PATCH"), { params: { key: "admin.jobs" } });
    expect(bad.status).toBe(400);
  });

  it("resets only tour progress for the chosen person", async () => {
    m.role.mockResolvedValue(admin);
    m.findUser.mockResolvedValue({ id: "u1", name: "Jane", email: "j@x", role: "CLEANER", createdAt: new Date() });
    m.reset.mockResolvedValue(2);
    m.person.mockResolvedValue({ toursOn: true, progress: [] });
    const response = await personPatch(write("/api/admin/tutorials/people/u1", { reset: "all" }, "PATCH"), { params: { id: "u1" } });
    expect(response.status).toBe(200);
    expect(m.reset).toHaveBeenCalledWith(expect.anything(), "u1", "all");
  });

  it("people search and person reads need the office roles", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await peopleGet(new NextRequest(`${ORIGIN}/api/admin/tutorials/people?q=ja`))).status).toBe(403);
    expect((await personGet(new NextRequest(`${ORIGIN}/api/admin/tutorials/people/u1`), { params: { id: "u1" } })).status).toBe(403);
    expect(m.findUsers).not.toHaveBeenCalled();
  });
});
