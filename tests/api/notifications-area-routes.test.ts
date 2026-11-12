// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), office: vi.fn(), me: vi.fn(), controls: vi.fn(), saveControls: vi.fn(), changeSwitch: vi.fn(), view: vi.fn(),
  settings: vi.fn(), sms: vi.fn(), webPush: vi.fn(), count: vi.fn(), findFirst: vi.fn(), group: vi.fn(), heartbeats: vi.fn(),
  item: vi.fn(), auditCount: vi.fn(), audit: vi.fn(), email: vi.fn(), smsSend: vi.fn(), receipt: vi.fn(), notify: vi.fn(), ops: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office, outcomeTaken: () => true }));
vi.mock("@/lib/notifications/catalog-switches", async () => {
  const { z } = await import("zod");
  return { catalogView: m.view, changeExistingSwitch: m.changeSwitch, existingSwitchSchema: z.object({ kind: z.literal("EMAIL_KIND"), emailKind: z.string(), enabled: z.boolean() }) };
});
vi.mock("@/lib/notifications/type-controls", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/type-controls")>("@/lib/notifications/type-controls");
  return { ...actual, getNotificationTypeControls: m.controls, saveNotificationTypeControls: m.saveControls };
});
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/sms", () => ({ getSmsProviderState: m.sms, sendSmsDetailed: m.smsSend }));
vi.mock("@/lib/notifications/web-push", () => ({ isWebPushConfigured: m.webPush }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: m.me },
  notificationIntent: { count: m.count, findFirst: m.findFirst, groupBy: m.group },
  notification: { count: m.count, findFirst: m.findFirst, groupBy: m.group, create: m.notify },
  appSetting: { findMany: m.heartbeats, create: m.receipt, update: vi.fn().mockResolvedValue({}) },
  lostFoundItem: { findUnique: m.item },
  auditLog: { count: m.auditCount, create: m.audit },
} }));

import { PATCH as CATALOG_PATCH, GET as CATALOG_GET } from "@/app/api/admin/notifications/catalog/route";
import { POST as TEST_SEND } from "@/app/api/admin/notifications/catalog/test/route";
import { GET as HEALTH } from "@/app/api/admin/notifications/health/route";
import { GET as DELIVERIES } from "@/app/api/admin/notifications/deliveries/route";
import { POST as CLIENT_DELAY } from "@/app/api/admin/notifications/actions/client-delay/route";
import { POST as STAFF_MESSAGE } from "@/app/api/admin/notifications/actions/staff-message/route";
import { POST as GUEST } from "@/app/api/admin/notifications/actions/guest-message/route";

const request = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const admin = { user: { id: "admin-1", role: Role.ADMIN } };

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue(admin);
  m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: {}, updatedAt: null });
  m.view.mockResolvedValue([]);
  m.office.mockResolvedValue([{ userId: "admin-1", name: "Me", transport: "INBOX", path: "pipeline", state: "inbox_available" }]);
  m.me.mockResolvedValue({ id: "admin-1", role: "ADMIN", name: "Me", email: "me@example.invalid", isActive: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("role and impersonation boundaries", () => {
  it("reads the catalog as ADMIN or OPS_MANAGER but changes switches as ADMIN only", async () => {
    await CATALOG_GET();
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    m.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const refused = await CATALOG_PATCH(request({ controls: { expectedUpdatedAt: null, respectsPreferences: { "job.reminder.manual": true } } }));
    expect(refused.status).toBe(403);
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN]);
    expect(m.saveControls).not.toHaveBeenCalled();
  });

  it("refuses switch changes, test sends and messages while impersonating", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "owner" } });
    expect((await CATALOG_PATCH(request({ controls: { expectedUpdatedAt: null } }))).status).toBe(403);
    expect((await TEST_SEND(request({ typeKey: "job.reminder.manual", transports: ["PUSH"] }))).status).toBe(403);
    expect((await STAFF_MESSAGE(request({ recipientIds: ["c1"], subject: "Hi", body: "Hi", transports: ["PUSH"] }))).status).toBe(403);
    expect(m.office).not.toHaveBeenCalled();
  });

  // Owner decision 2026-11-12: operations managers may send these too, each
  // only with the pack of the page it lives on at manage (Jobs; Lost & found).
  it("gates the client delay notice and guest messages by the page's pack for operations managers", async () => {
    const ops = { user: { id: "ops-1", role: Role.OPS_MANAGER, heldRoles: [Role.OPS_MANAGER] } };
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ jobs: "read", "lost-found": "read", communications: "manage" });
    const delay = await CLIENT_DELAY(request({ jobId: "job-1", transports: ["PUSH"] }));
    expect(delay.status).toBe(403);
    expect((await delay.json()).error).toMatch(/Jobs & assignments permission/);
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    const guest = await GUEST(request({ lostFoundItemId: "i1", transport: "EMAIL", to: "guest@example.invalid", body: "Found it" }));
    expect(guest.status).toBe(403);
    expect((await guest.json()).error).toMatch(/Lost & found permission/);
    expect(m.office).not.toHaveBeenCalled();
    expect(m.email).not.toHaveBeenCalled();
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await STAFF_MESSAGE(request({ recipientIds: ["c1"], subject: "Hi", body: "Hi", transports: ["PUSH"] }))).status).toBe(403);
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });

  it("refuses the delivery log and health to signed-out users", async () => {
    m.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await DELIVERIES(new Request("http://localhost/api/admin/notifications/deliveries"))).status).toBe(401);
    expect((await HEALTH()).status).toBe(401);
  });
});

describe("send test to me", () => {
  it("goes only to the signed-in user, through the staff scope, marked as a test", async () => {
    const response = await TEST_SEND(request({ typeKey: "job.reminder.manual", transports: ["PUSH", "EMAIL"] }));
    expect(response.status).toBe(200);
    const call = m.office.mock.calls[0][0];
    expect(call.recipients).toEqual([{ id: "admin-1", role: "ADMIN", name: "Me", email: "me@example.invalid" }]);
    // Since the wording layer (2026-11) a test carries the type's live wording with sample data.
    expect(call).toMatchObject({ scopeType: "STAFF_MEMBER", eventKey: "notification.test", subject: "[Test] Unfinished job reminder", transports: ["PUSH", "EMAIL"] });
    expect(call.body).toContain("You have an unfinished job at Manly Loft");
    expect(call.email(call.recipients[0]).subject).toBe("[Test] Reminder: unfinished job at Manly Loft (J-1061)");
    expect(call.scopeId(call.recipients[0])).toBe("admin-1");
  });

  it("refuses types without a test and malformed requests", async () => {
    // job.changed has no editable wording and no catalog test.
    expect((await TEST_SEND(request({ typeKey: "job.changed", transports: ["EMAIL"] }))).status).toBe(400);
    expect((await TEST_SEND(request({ typeKey: "job.reminder.manual", transports: [] }))).status).toBe(400);
    expect(m.office).not.toHaveBeenCalled();
  });
});

describe("health", () => {
  it("reports credential presence and switches without ever returning a secret value", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_super_secret_value");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio_secret_token");
    vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "");
    m.settings.mockResolvedValue({ notificationAudienceControls: { channels: { email: true, sms: true, push: true } }, emailAutomation: { masterEnabled: true } });
    m.sms.mockResolvedValue({ provider: "twilio", configured: true });
    m.webPush.mockResolvedValue(false);
    m.count.mockResolvedValue(0);
    m.findFirst.mockResolvedValue(null);
    m.group.mockResolvedValue([]);
    m.heartbeats.mockResolvedValue([]);
    const response = await HEALTH();
    const text = await response.text();
    expect(text).not.toContain("re_super_secret_value");
    expect(text).not.toContain("twilio_secret_token");
    const body = JSON.parse(text);
    expect(body.transports.find((row: { transport: string }) => row.transport === "EMAIL")).toMatchObject({ configured: true, onPipeline: false });
    expect(body.transports.find((row: { transport: string }) => row.transport === "WEB_PUSH")).toMatchObject({ configured: false });
    expect(body.banners.some((banner: { typeKey: string; transport: string }) => banner.typeKey === "job.reminder.manual" && banner.transport === "EMAIL")).toBe(true);
    expect(body.worker.status).toBe("MISSING");
    expect(body.envFlags.map((flag: { name: string }) => flag.name)).not.toContain("RESEND_API_KEY");
  });
});

describe("guest message", () => {
  it("is tied to an item, rate-limited from the audit log and audited with a masked address", async () => {
    m.item.mockResolvedValue({ id: "i1", itemName: "Watch", jobId: "job-1" });
    m.auditCount.mockResolvedValue(0);
    m.receipt.mockResolvedValue({});
    m.email.mockResolvedValue({ ok: true, externalId: "resend-9" });
    const response = await GUEST(request({ lostFoundItemId: "i1", transport: "EMAIL", to: "guest@example.invalid", body: "We found your watch." }));
    expect(await response.json()).toEqual({ state: "provider_accepted", errorCode: null });
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "guest@example.invalid", subject: "About your Watch" }));
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "GUEST_MESSAGE_SENT", entity: "LostFoundItem", entityId: "i1", after: { to: "g***@example.invalid", deliveryConfirmed: false } });
    m.auditCount.mockResolvedValue(5);
    expect((await GUEST(request({ lostFoundItemId: "i1", transport: "EMAIL", to: "guest@example.invalid", body: "Again" }))).status).toBe(429);
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown item and an invalid address without sending", async () => {
    m.item.mockResolvedValue(null);
    expect((await GUEST(request({ lostFoundItemId: "nope", transport: "EMAIL", to: "guest@example.invalid", body: "x" }))).status).toBe(404);
    expect((await GUEST(request({ lostFoundItemId: "i1", transport: "SMS", to: "not a phone", body: "x" }))).status).toBe(400);
    expect(m.email).not.toHaveBeenCalled();
    expect(m.smsSend).not.toHaveBeenCalled();
  });
});
