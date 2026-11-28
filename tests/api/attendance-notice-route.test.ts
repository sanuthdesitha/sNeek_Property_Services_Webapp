// @vitest-environment node
/** "I can't attend" / "Running late" route: live role, pilot, impersonation. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), pilot: vi.fn(), send: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/pilots/state", () => ({ isPilotOn: m.pilot }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: m.deliver }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job } } }));
vi.mock("@/lib/jobs/attendance-notice", () => ({ AttendanceNoticeError: class extends Error {}, sendAttendanceNotice: m.send }));

import { POST } from "@/app/api/cleaner/jobs/[id]/attendance-notice/route";

const post = (body: unknown) => POST(new NextRequest("http://local/x", { method: "POST", body: JSON.stringify(body) }), { params: { id: "job-1" } });
const late = { kind: "RUNNING_LATE", requestKey: "attend-abcdefgh", reason: "Traffic on the bridge", minutes: 20 };

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "cleaner-1", role: Role.CLEANER } });
  m.job.mockResolvedValue({ propertyId: "property-1" });
  m.pilot.mockResolvedValue(true);
  m.send.mockResolvedValue({ outcome: "SENT", intentIds: ["i1"] });
  m.deliver.mockResolvedValue(new Map([["i1", { state: "inbox_available" }]]));
});

describe("attendance notice route", () => {
  it("sends as the cleaner and reports the inbox state", async () => {
    const response = await post(late);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "SENT", office: { queued: 1, inInbox: 1 } });
    expect(m.send).toHaveBeenCalledWith({ id: "cleaner-1" }, "job-1", late, "Australia/Sydney");
    expect(m.pilot).toHaveBeenCalledWith("before-start-extras", { userId: "cleaner-1", propertyId: "property-1" });
  });

  it("pilot off: 409 PILOT_OFF and nothing sent; testing as the cleaner: 403", async () => {
    m.pilot.mockResolvedValue(false);
    const off = await post(late);
    expect(off.status).toBe(409);
    expect((await off.json()).code).toBe("PILOT_OFF");
    m.role.mockResolvedValue({ user: { id: "cleaner-1", role: Role.CLEANER }, impersonation: { actorId: "admin" } });
    expect((await post(late)).status).toBe(403);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("only cleaners (live role guard)", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await post(late)).status).toBe(403);
    expect(m.role).toHaveBeenCalledWith([Role.CLEANER]);
  });
});
