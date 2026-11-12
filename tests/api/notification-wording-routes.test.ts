// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), ops: vi.fn(), save: vi.fn(), read: vi.fn(), summaries: vi.fn(), provider: vi.fn(), available: vi.fn(),
  audit: vi.fn(), me: vi.fn(), office: vi.fn(), sms: vi.fn(), notify: vi.fn(), upsert: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/notifications/wording/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/wording/store")>("@/lib/notifications/wording/store");
  return { ...actual, saveWording: m.save };
});
vi.mock("@/lib/notifications/wording/read", () => ({ readTypeWording: m.read, readWordingSummaries: m.summaries }));
vi.mock("@/lib/notifications/wording/ai-provider", () => ({ requestWordingJson: m.provider, wordingProviderAvailability: m.available }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit }, user: { findUnique: m.me }, notification: { create: m.notify }, appSetting: { findUnique: async () => null, upsert: m.upsert } } }));

import { GET as LIST } from "@/app/api/admin/notifications/wording/route";
import { GET as READ, PUT as SAVE } from "@/app/api/admin/notifications/wording/[typeKey]/route";
import { POST as REGENERATE } from "@/app/api/admin/notifications/wording/regenerate/route";
import { POST as TEST_SEND } from "@/app/api/admin/notifications/catalog/test/route";

const admin = { user: { id: "admin-1", name: "Hannah", role: Role.ADMIN, heldRoles: [Role.ADMIN] } };
const ops = { user: { id: "ops-1", name: "Ravi", role: Role.OPS_MANAGER, heldRoles: [Role.OPS_MANAGER] } };
const params = { params: { typeKey: "job.reminder.scheduled" } };
const put = (body: unknown) => new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) });
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const edit = { kind: "EDIT", partId: "cleaner", transport: "SMS", fields: { body: "{{propertyName}} at {{when}}" }, expectedHash: "h" };
const regenerate = { typeKey: "job.reminder.scheduled", partId: "cleaner", transport: "SMS", fields: { body: "sNeek Ops: Your cleaning job at {{propertyName}} starts soon ({{when}}). {{propertyAddress}}.{{timingSuffix}}" } };

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue(admin);
  m.read.mockResolvedValue({ status: "EDITABLE", reason: null, href: null, parts: [] });
  m.summaries.mockResolvedValue([]);
  m.save.mockResolvedValue({ version: 2, hash: "h2" });
  m.available.mockResolvedValue({ available: true, reason: null });
  m.me.mockResolvedValue({ id: "admin-1", role: "ADMIN", name: "Hannah", email: "h@example.invalid", phone: "+61400000000", isActive: true });
  m.office.mockResolvedValue([]);
});

describe("who may edit wording (owner decision 2026-11-12)", () => {
  it("lets an administrator save, with the actor and role recorded", async () => {
    const response = await SAVE(put(edit), params);
    expect(response.status).toBe(200);
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(m.save.mock.calls[0][0]).toMatchObject({ typeKey: "job.reminder.scheduled", kind: "EDIT", actor: { id: "admin-1", role: "ADMIN" } });
  });

  it("lets an operations manager with the notifications pack at Manage save, regenerate and test", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ communications: "manage" });
    m.me.mockResolvedValue({ id: "ops-1", role: "OPS_MANAGER", name: "Ravi", email: "r@example.invalid", phone: null, isActive: true });
    m.provider.mockResolvedValue({ body: "{{propertyName}} {{when}} ok" });
    expect((await SAVE(put(edit), params)).status).toBe(200);
    expect(m.save.mock.calls[0][0].actor).toMatchObject({ id: "ops-1", role: "OPS_MANAGER" });
    expect((await REGENERATE(post(regenerate))).status).toBe(200);
    expect((await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["EMAIL"] }))).status).toBe(200);
  });

  it.each([["view only", { communications: "read" }], ["no pack", { communications: "off" }]])("refuses an operations manager with %s (403), changing nothing", async (_label, levels) => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue(levels);
    expect((await SAVE(put(edit), params)).status).toBe(403);
    expect((await REGENERATE(post(regenerate))).status).toBe(403);
    expect((await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["EMAIL"] }))).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.provider).not.toHaveBeenCalled();
    expect(m.office).not.toHaveBeenCalled();
    // Reading stays open to them, marked read-only.
    const read = await (await READ(new Request("http://localhost/x"), params)).json();
    expect(read).toMatchObject({ canEdit: false, regenerate: { available: false } });
  });

  it("refuses everything while impersonating, even for an administrator", async () => {
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "owner" } });
    expect((await SAVE(put(edit), params)).status).toBe(403);
    expect((await REGENERATE(post(regenerate))).status).toBe(403);
    expect((await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["SMS"] }))).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.sms).not.toHaveBeenCalled();
  });

  it("maps a stale write to 409 and invalid wording to 400 with the problems", async () => {
    const { WordingConflictError, WordingInvalidError } = await import("@/lib/notifications/wording/store");
    m.save.mockRejectedValueOnce(new WordingConflictError());
    expect((await SAVE(put(edit), params)).status).toBe(409);
    m.save.mockRejectedValueOnce(new WordingInvalidError([{ field: null, code: "missing_required", message: "{{when}} is required and missing." }]));
    const invalid = await SAVE(put(edit), params);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).problems[0].code).toBe("missing_required");
  });

  it("lists summaries for operations managers with read access", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ communications: "read" });
    const body = await (await LIST()).json();
    expect(body).toMatchObject({ canEdit: false });
  });
});

describe("regenerate wording", () => {
  it("returns a proposal that keeps every required variable and never saves it", async () => {
    m.provider.mockResolvedValue({ body: "Hi! {{when}} you're at {{propertyName}} ({{propertyAddress}}).{{timingSuffix}}" });
    const response = await REGENERATE(post(regenerate));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, proposal: { body: expect.stringContaining("{{when}}") }, droppedVariables: [] });
    expect(m.save).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "NOTIFICATION_WORDING_PROPOSAL_REQUESTED", after: { accepted: false, outcome: "proposal" } });
  });

  it("sends only the template, the variable list and tone guidance to the provider (no personal data)", async () => {
    m.provider.mockResolvedValue({ body: "{{propertyName}} {{when}}" });
    await REGENERATE(post(regenerate));
    const prompt: string = m.provider.mock.calls[0][0].prompt;
    expect(prompt).toContain("{{propertyName}}: Property (required)");
    expect(prompt).toContain(regenerate.fields.body);
    expect(prompt).not.toMatch(/Jane|Manly|@example|\+61/);
  });

  it("rejects a proposal that drops a required variable or invents one, with the reason", async () => {
    m.provider.mockResolvedValueOnce({ body: "Your job at {{propertyName}} is soon" });
    const dropped = await REGENERATE(post(regenerate));
    expect(dropped.status).toBe(422);
    expect((await dropped.json()).error).toMatch(/\{\{when\}\} is required/);
    m.provider.mockResolvedValueOnce({ body: "{{propertyName}} {{when}} {{gateCode}}" });
    expect((await (await REGENERATE(post(regenerate))).json()).error).toMatch(/gateCode/);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("is unavailable with the reason when no provider is configured", async () => {
    m.available.mockResolvedValue({ available: false, reason: "No AI text provider is configured (Settings, AI). Wording can still be edited by hand." });
    const response = await REGENERATE(post(regenerate));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/No AI text provider/);
    expect(m.provider).not.toHaveBeenCalled();
  });
});

describe("send test to me: truthful results", () => {
  it("reports SMS as accepted by the provider only when the provider accepted it", async () => {
    m.sms.mockResolvedValue({ ok: true, status: "sent", provider: "twilio" });
    const body = await (await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["SMS"] }))).json();
    expect(body.outcomes).toEqual([expect.objectContaining({ transport: "SMS", state: "provider_accepted" })]);
    expect(m.sms.mock.calls[0]).toEqual(["+61400000000", expect.stringMatching(/^\[Test\] sNeek Ops: Your cleaning job at Manly Loft starts soon \(tomorrow 10:00\)/)]);
  });

  it("says skipped when SMS is switched off and failed when you have no phone", async () => {
    m.sms.mockResolvedValue({ ok: false, status: "disabled", provider: "none", error: "SMS delivery is disabled." });
    expect((await (await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["SMS"] }))).json()).outcomes[0]).toMatchObject({ state: "skipped", errorCode: "sms_disabled" });
    m.me.mockResolvedValue({ id: "admin-1", role: "ADMIN", name: "Hannah", email: null, phone: null, isActive: true });
    expect((await (await TEST_SEND(post({ typeKey: "job.reminder.scheduled", transports: ["SMS"] }))).json()).outcomes[0]).toMatchObject({ state: "failed", errorCode: "no_phone_on_your_account" });
  });

  it("sends email through the office path only to you, with the saved wording", async () => {
    m.office.mockResolvedValue([{ userId: "admin-1", name: "Hannah", transport: "EMAIL", path: "direct", state: "provider_accepted" }]);
    const body = await (await TEST_SEND(post({ typeKey: "job.cancelled", transports: ["INBOX"] }))).json();
    expect(m.office.mock.calls[0][0]).toMatchObject({ transports: ["INBOX"], subject: "[Test] Job cancelled", recipients: [{ id: "admin-1" }] });
    expect(body.outcomes[0].state).toBe("provider_accepted");
  });
});
