// @vitest-environment node
/**
 * Sending safeguards routes: who may read and change what.
 * Reads: ADMIN and OPS_MANAGER (the notifications pack is the middleware's
 * job). Changes: ADMIN only, never while testing as someone else; the limits
 * and the emergency stop also need the person's own PIN; out-of-bounds limits
 * are refused rather than clamped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { DEFAULT_SAFEGUARD_LIMITS, DEFAULT_SAFEGUARD_SETTINGS } from "@/lib/notifications/safeguards/config";

const m = vi.hoisted(() => ({
  session: vi.fn(), verify: vi.fn(), overview: vi.fn(), saveLimits: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/security/admin-verification", () => ({
  verifySensitiveAction: m.verify,
  isSensitiveRefusal: (error: unknown) => error instanceof Error && error.message === "INVALID_SECURITY_VERIFICATION",
  SensitiveVerificationError: class extends Error { code = "X"; },
}));
vi.mock("@/lib/notifications/safeguards/overview", () => ({ buildSafeguardsOverview: m.overview }));
vi.mock("@/lib/notifications/safeguards/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/safeguards/store")>("@/lib/notifications/safeguards/store");
  return { ...actual, saveSafeguardLimits: m.saveLimits, setEmergencyStop: m.stop, pauseNotificationType: m.pause, resumeIncident: m.resume };
});
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET, PATCH } from "@/app/api/admin/notifications/safeguards/route";
import { POST as STOP } from "@/app/api/admin/notifications/safeguards/emergency-stop/route";
import { POST as PAUSES } from "@/app/api/admin/notifications/safeguards/pauses/route";

const OVERVIEW = { generatedAt: "2026-11-15T00:00:00.000Z", timeZone: "Australia/Sydney", since: "2026-11-14T13:00:00.000Z", settings: DEFAULT_SAFEGUARD_SETTINGS, volumes: [], topRecipients: [], suppressedByReason: [], recentNotSent: [], paused: [], incidents: [], pausableTypes: [] };
const admin = { user: { id: "admin", role: Role.ADMIN } };
const manager = { user: { id: "manager", role: Role.OPS_MANAGER } };
const impersonating = { user: { id: "admin", role: Role.ADMIN }, impersonation: { targetUserId: "cleaner" } };

function body(value: unknown) {
  return new Request("http://local/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.overview.mockResolvedValue(OVERVIEW);
  m.verify.mockResolvedValue(true);
  m.saveLimits.mockResolvedValue(DEFAULT_SAFEGUARD_SETTINGS);
  m.stop.mockResolvedValue(DEFAULT_SAFEGUARD_SETTINGS);
  m.pause.mockResolvedValue({ incident: { id: "i1" }, created: true });
  m.resume.mockResolvedValue({ id: "i1", status: "RESOLVED" });
});

describe("GET /api/admin/notifications/safeguards", () => {
  it("lets an operations manager read, saying why they cannot change anything", async () => {
    m.session.mockResolvedValue(manager);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(await response.json()).toMatchObject({ canManage: false, readOnlyReason: "Only an administrator can change the sending safeguards." });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers 401 / 403 from the live session guard", async () => {
    m.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await GET()).status).toBe(401);
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await GET()).status).toBe(403);
  });
});

describe("changes", () => {
  it("refuses an operations manager, and an administrator testing as someone else, before any change or PIN check", async () => {
    for (const session of [manager, impersonating]) {
      m.session.mockResolvedValue(session);
      expect((await PATCH(body({ limits: DEFAULT_SAFEGUARD_LIMITS, expectedUpdatedAt: null, security: { pin: "1234" } }))).status).toBe(403);
      expect((await STOP(body({ on: true, security: { pin: "1234" } }))).status).toBe(403);
      expect((await PAUSES(body({ action: "pause", typeKey: "job.qa_and_accountability" }))).status).toBe(403);
    }
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.saveLimits).not.toHaveBeenCalled();
    expect(m.stop).not.toHaveBeenCalled();
    expect(m.pause).not.toHaveBeenCalled();
  });

  it("needs the administrator's own PIN for the emergency stop and the limits", async () => {
    m.session.mockResolvedValue(admin);
    m.verify.mockRejectedValue(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await STOP(body({ on: true, security: { pin: "0000" } }))).status).toBe(423);
    expect((await PATCH(body({ limits: DEFAULT_SAFEGUARD_LIMITS, expectedUpdatedAt: null, security: { pin: "0000" } }))).status).toBe(423);
    expect(m.stop).not.toHaveBeenCalled();
    expect(m.saveLimits).not.toHaveBeenCalled();
    m.verify.mockResolvedValue(true);
    const response = await STOP(body({ on: true, reason: "Spam reported", security: { pin: "1234" } }));
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenLastCalledWith("admin", { pin: "1234" });
    expect(m.stop).toHaveBeenCalledWith("admin", true, "Spam reported");
  });

  it("refuses limits outside the safe bounds with the reason", async () => {
    m.session.mockResolvedValue(admin);
    const actual = await vi.importActual<typeof import("@/lib/notifications/safeguards/store")>("@/lib/notifications/safeguards/store");
    m.saveLimits.mockImplementation(async (actor: string, limits: unknown) => {
      const { limitsOutOfBounds } = await import("@/lib/notifications/safeguards/config");
      const problems = limitsOutOfBounds(limits);
      if (problems.length) throw new actual.SafeguardInputError(problems);
      return DEFAULT_SAFEGUARD_SETTINGS;
    });
    const response = await PATCH(body({ limits: { ...DEFAULT_SAFEGUARD_LIMITS, EMAIL: { ...DEFAULT_SAFEGUARD_LIMITS.EMAIL, perHour: 0 } }, expectedUpdatedAt: null, security: { pin: "1234" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Per person per hour must be a whole number from 5 to 60/);
  });

  it("pauses and resumes for an administrator without a PIN (pausing only makes things safer)", async () => {
    m.session.mockResolvedValue(admin);
    expect((await PAUSES(body({ action: "pause", typeKey: "job.qa_and_accountability", note: "loop" }))).status).toBe(200);
    expect(m.pause).toHaveBeenCalledWith("admin", "job.qa_and_accountability", "loop");
    expect((await PAUSES(body({ action: "resume", incidentId: "i1" }))).status).toBe(200);
    expect(m.resume).toHaveBeenCalledWith("admin", "i1", null);
    m.resume.mockResolvedValue(null);
    expect((await PAUSES(body({ action: "resume", incidentId: "gone" }))).status).toBe(404);
    expect((await PAUSES(body({ action: "explode" }))).status).toBe(400);
  });
});
