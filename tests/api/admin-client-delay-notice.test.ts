// @vitest-environment node
/**
 * Live ops "Notify client" (owner decision, third set item 2): the existing
 * client delay notice route (ADMIN only) and its new confirm preview.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), job: vi.fn(), audits: vi.fn(), audit: vi.fn(), office: vi.fn(), controls: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, auditLog: { findMany: m.audits, create: m.audit } } }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: m.controls, typeRespectsPreferences: () => false }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));

import { GET, POST } from "@/app/api/admin/notifications/actions/client-delay/route";

function asRole(role: "ADMIN" | "OPS_MANAGER") {
  m.auth.mockImplementation(async (roles: string[]) => {
    if (!roles.includes(role)) throw new Error("FORBIDDEN");
    return { user: { id: "admin-1", role } };
  });
}

const job = (enabled: boolean | null, users = [{ id: "u1", role: "CLIENT", name: "Jo Client", email: "jo@example.invalid", isActive: true }]) => ({
  id: "j1", jobNumber: "J-1", property: { name: "Glebe House", client: { id: "cl", notificationPref: enabled === null ? null : { notificationsEnabled: enabled }, users } },
});

const get = (query: string) => GET(new Request(`http://localhost/api/admin/notifications/actions/client-delay?${query}`));
const post = (body: unknown) => POST(new Request("http://localhost/api/admin/notifications/actions/client-delay", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  asRole("ADMIN");
  m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: {}, updatedAt: null });
  m.job.mockResolvedValue(job(true));
  m.audits.mockResolvedValue([]);
  m.office.mockResolvedValue([
    { userId: "u1", name: "Jo Client", transport: "INBOX", path: "pipeline", state: "inbox_available" },
    { userId: "u1", name: "Jo Client", transport: "EMAIL", path: "direct", state: "provider_accepted" },
  ]);
});

describe("who may notify a client", () => {
  it("refuses an operations manager for the preview and the send", async () => {
    asRole("OPS_MANAGER");
    expect((await get("jobId=j1")).status).toBe(403);
    expect((await post({ jobId: "j1", transports: ["PUSH"] })).status).toBe(403);
    expect(m.office).not.toHaveBeenCalled();
  });
});

describe("confirm preview", () => {
  it("shows the client logins and the exact wording with the real ETA", async () => {
    const response = await get("jobId=j1&etaMinutes=25");
    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview).toMatchObject({
      jobId: "j1", subject: "Your clean is running late", blocked: null, etaMinutes: 25,
      body: "Your clean at Glebe House is running late. The new estimate is about 25 minutes.",
      recipients: [{ id: "u1", name: "Jo Client", email: "jo@example.invalid" }],
    });
    expect(m.office).not.toHaveBeenCalled();
  });

  it("returns the send's refusal when the client switched notifications off", async () => {
    m.job.mockResolvedValue(job(false));
    const preview = await (await get("jobId=j1")).json();
    expect(preview.blocked).toBe("This client has switched off job notifications.");
    expect(preview.recipients).toEqual([]);
  });

  it("reports today's earlier request with who and when", async () => {
    m.audits.mockResolvedValue([{ entityId: "j1", createdAt: new Date("2026-11-11T00:05:00Z"), user: { name: "Ann Admin", email: "ann@example.invalid" } }]);
    const preview = await (await get("jobId=j1")).json();
    expect(preview.lastRequest).toEqual({ at: "2026-11-11T00:05:00.000Z", byName: "Ann Admin" });
    expect(m.audits.mock.calls[0][0].where).toMatchObject({ action: "CLIENT_DELAY_NOTICE_SENT", entityId: { in: ["j1"] } });
  });

  it("refuses a bad ETA", async () => {
    expect((await get("jobId=j1&etaMinutes=0")).status).toBe(400);
  });
});

describe("send", () => {
  it("refuses with the reason when the client switched notifications off", async () => {
    m.job.mockResolvedValue(job(false));
    const response = await post({ jobId: "j1", transports: ["PUSH"], idempotencyKey: "delay:j1:2026-11-11" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This client has switched off job notifications.");
    expect(m.office).not.toHaveBeenCalled();
  });

  it("is idempotent per key and records the key, returning truthful states", async () => {
    const first = await (await post({ jobId: "j1", etaMinutes: 25, transports: ["PUSH", "EMAIL"], idempotencyKey: "delay:j1:2026-11-11" })).json();
    await post({ jobId: "j1", etaMinutes: 25, transports: ["PUSH", "EMAIL"], idempotencyKey: "delay:j1:2026-11-11" });
    // Same key → same pipeline event id both times (the pipeline dedupes on it).
    expect(m.office.mock.calls[0][0].eventId).toBe("client-delay:j1:delay:j1:2026-11-11");
    expect(m.office.mock.calls[1][0].eventId).toBe(m.office.mock.calls[0][0].eventId);
    expect(m.audit.mock.calls[0][0].data.after).toMatchObject({ idempotencyKey: "delay:j1:2026-11-11", deliveryConfirmed: false });
    expect(first.outcomes.map((row: { state: string }) => row.state)).toEqual(["inbox_available", "provider_accepted"]);
  });
});
