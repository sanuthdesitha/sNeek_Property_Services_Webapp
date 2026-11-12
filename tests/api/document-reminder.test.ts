// @vitest-environment node
// Wave E: Command "Send reminder" for an expiring document goes through the
// workforce route's REQUEST_DOCUMENT with the document id: explicit transports,
// truthful states (the pipeline's and the SMS provider's own answers, never a
// "sent" written before delivery), one reminder per document per day, a retry
// of the same request answered from the receipt.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), document: vi.fn(), settingCreate: vi.fn(), settingFind: vi.fn(), settingUpdate: vi.fn(), requestCreate: vi.fn(),
  audit: vi.fn(), notify: vi.fn(), office: vi.fn(), sms: vi.fn(), controls: vi.fn(), settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office, outcomeTaken: () => true }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/type-controls", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/type-controls")>("@/lib/notifications/type-controls");
  return { ...actual, getNotificationTypeControls: m.controls };
});
vi.mock("@/lib/db", () => ({ db: {
  staffDocument: { findUnique: m.document },
  staffDocumentRequest: { create: m.requestCreate },
  appSetting: { create: m.settingCreate, findUnique: m.settingFind, update: m.settingUpdate },
  auditLog: { create: m.audit },
  notification: { create: m.notify },
} }));

import { POST as WORKFORCE } from "@/app/api/admin/workforce/route";
import { GET as PREVIEW } from "@/app/api/admin/workforce/document-reminder/route";

const admin = { user: { id: "admin-1", role: Role.ADMIN, name: "Ana" } };
const doc = { id: "doc-1", title: "Police check", category: "COMPLIANCE", expiresAt: new Date("2026-11-20T00:00:00Z"), user: { id: "c1", name: "Jane", email: "jane@example.invalid", phone: "+61400000111", role: "CLEANER", isActive: true } };
const post = (body: Record<string, unknown>) => WORKFORCE(new Request("http://localhost/api/admin/workforce", { method: "POST", body: JSON.stringify(body) }) as never);
const reminder = (overrides: Record<string, unknown> = {}) => ({ action: "REQUEST_DOCUMENT", documentId: "doc-1", transports: ["PUSH"], idempotencyKey: "docrem-1234567890", ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue(admin);
  m.settings.mockResolvedValue({ timezone: "Australia/Sydney" });
  m.document.mockResolvedValue(doc);
  m.settingCreate.mockResolvedValue({});
  m.settingFind.mockResolvedValue(null);
  m.settingUpdate.mockResolvedValue({});
  m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: {}, updatedAt: null });
  m.requestCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "req-1", ...data, notes: data.notes, user: { id: "c1", name: "Jane", email: "jane@example.invalid", phone: "+61400000111", role: "CLEANER" }, requestedBy: { id: "admin-1", name: "Ana" } }));
  m.office.mockResolvedValue([
    { userId: "c1", name: "Jane", transport: "INBOX", path: "pipeline", state: "inbox_available" },
    { userId: "c1", name: "Jane", transport: "MOBILE_PUSH", path: "pipeline", state: "queued" },
  ]);
  m.sms.mockResolvedValue({ ok: false, status: "disabled", error: "SMS delivery is disabled." });
});

describe("Send reminder for an expiring document", () => {
  it("creates the renewal request through REQUEST_DOCUMENT and returns the pipeline's real states", async () => {
    const response = await post(reminder());
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.delivery.outcomes.map((o: { state: string }) => o.state)).toEqual(["inbox_available", "queued"]);
    expect(result.delivery.sms).toBeNull();
    expect(m.requestCreate.mock.calls[0][0].data).toMatchObject({ userId: "c1", category: "COMPLIANCE", title: "Renewed Police check", dueAt: doc.expiresAt });
    expect(m.office.mock.calls[0][0]).toMatchObject({ typeKey: "workforce.document_request", scopeType: "STAFF_MEMBER", transports: ["PUSH"] });
    // No inbox row is written as "SENT" by the request itself any more.
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "STAFF_DOCUMENT_REMINDER_SENT", entity: "StaffDocument", entityId: "doc-1", after: { deliveryConfirmed: false } });
  });

  it("records the SMS provider's answer, never assuming it was sent", async () => {
    const { result } = await (await post(reminder({ transports: ["SMS"], idempotencyKey: "docrem-sms-123456" }))).json();
    expect(result.delivery.sms).toEqual({ transport: "SMS", state: "skipped", errorCode: "sms_disabled" });
    expect(m.notify.mock.calls[0][0].data).toMatchObject({ channel: "SMS", status: "FAILED" });
    expect(m.office).not.toHaveBeenCalled();
  });

  it("is one reminder per document per day: a retry of the same request replays, another is refused", async () => {
    const done = { documentId: "doc-1", dayKey: "2026-11-12", idempotencyKey: "docrem-1234567890", actorId: "admin-1", at: "2026-11-12T01:00:00.000Z", status: "DONE", result: { requestId: "req-1", dayKey: "2026-11-12", delivery: { outcomes: [], sms: null }, replayed: false } };
    m.settingCreate.mockRejectedValue({ code: "P2002" });
    m.settingFind.mockResolvedValue({ value: done });
    const replay = await post(reminder());
    expect(replay.status).toBe(200);
    expect((await replay.json()).result).toMatchObject({ requestId: "req-1", replayed: true });
    const other = await post(reminder({ idempotencyKey: "docrem-another-999" }));
    expect(other.status).toBe(409);
    expect((await other.json()).error).toMatch(/already sent today at 12:00/);
    expect(m.requestCreate).not.toHaveBeenCalled();
  });

  it("refuses an inactive person, a document without expiry, impersonation and an empty transport list", async () => {
    m.document.mockResolvedValueOnce({ ...doc, user: { ...doc.user, isActive: false } });
    expect((await post(reminder())).status).toBe(409);
    m.document.mockResolvedValueOnce({ ...doc, expiresAt: null });
    expect((await post(reminder())).status).toBe(409);
    m.session.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "owner" } });
    expect((await post(reminder())).status).toBe(403);
    expect((await post(reminder({ transports: [] }))).status).toBe(400);
    expect(m.requestCreate).not.toHaveBeenCalled();
  });

  it("keeps the older Request document path (no document id) with its previous transports, now with real states", async () => {
    const response = await post({ action: "REQUEST_DOCUMENT", userId: "c1", category: "id", title: "Licence" });
    expect(response.status).toBe(200);
    expect(m.office.mock.calls[0][0].transports).toEqual(["PUSH", "EMAIL"]);
    expect(m.sms).toHaveBeenCalledTimes(1);
    expect((await response.json()).result.delivery.sms).toMatchObject({ state: "skipped" });
  });

  it("previews what will be sent and whether a reminder already went today", async () => {
    m.settingFind.mockResolvedValue({ value: { at: "2026-11-12T01:00:00.000Z", status: "DONE" } });
    const body = await (await PREVIEW({ nextUrl: new URL("http://localhost/x?documentId=doc-1") } as never)).json();
    expect(body).toMatchObject({ requestTitle: "Renewed Police check", person: { name: "Jane", hasEmail: true, hasPhone: true }, sentToday: { state: "requested" } });
  });
});
