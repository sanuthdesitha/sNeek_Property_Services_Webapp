// @vitest-environment node
/**
 * Owner decision 2026-11-12 (item B): Accounts "Request document" asks which
 * transport to use. Server side: per-person options with reasons, the office
 * user's own "Don't ask again" choice (AppSetting `office_send_transports_v1:
 * <userId>`, no schema change), the order explicit → saved → inbox only, and
 * nothing read, saved or sent while impersonating. Providers are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), settingFind: vi.fn(), settingUpsert: vi.fn(), raw: vi.fn(), requestCreate: vi.fn(),
  office: vi.fn(), sms: vi.fn(), smsState: vi.fn(), controls: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office, outcomeTaken: () => true }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms, getSmsProviderState: m.smsState }));
vi.mock("@/lib/notifications/type-controls", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/type-controls")>("@/lib/notifications/type-controls");
  return { ...actual, getNotificationTypeControls: m.controls };
});
vi.mock("@/lib/db", () => {
  const appSetting = { findUnique: m.settingFind, upsert: m.settingUpsert, create: async () => ({}), update: async () => ({}) };
  return { db: {
    user: { findUnique: m.user },
    appSetting,
    staffDocumentRequest: { create: m.requestCreate },
    notification: { create: m.notify },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ appSetting, $executeRaw: m.raw }),
  } };
});

import { POST as WORKFORCE } from "@/app/api/admin/workforce/route";
import { GET as OPTIONS } from "@/app/api/admin/workforce/document-request/route";
import { DELETE as FORGET, GET as MINE } from "@/app/api/me/send-transports/route";

const office = { user: { id: "office-1", role: Role.OPS_MANAGER, name: "Olly" } };
const person = { id: "c1", name: "Jane", email: "jane@example.invalid", phone: "+61400000111", isActive: true };
const PREF_KEY = "office_send_transports_v1:office-1";
let stored: Record<string, unknown> = {};

const post = (body: Record<string, unknown>) => WORKFORCE(new Request("http://localhost/api/admin/workforce", { method: "POST", body: JSON.stringify(body) }) as never);
const request = (overrides: Record<string, unknown> = {}) => ({ action: "REQUEST_DOCUMENT", userId: "c1", category: "POLICE_CHECK", title: "Police check", ...overrides });
const options = async (userId = "c1") => (await OPTIONS({ nextUrl: new URL(`http://localhost/x?userId=${userId}`) } as never)).json();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_API_KEY", "test-key");
  stored = {};
  m.session.mockResolvedValue(office);
  m.user.mockResolvedValue(person);
  m.settingFind.mockImplementation(async ({ where }: { where: { key: string } }) => (where.key in stored ? { key: where.key, value: stored[where.key] } : null));
  m.settingUpsert.mockImplementation(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => { stored[where.key] = create.value; return {}; });
  m.smsState.mockResolvedValue({ provider: "twilio", configured: true });
  m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: {}, updatedAt: null });
  m.requestCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "req-1", ...data, user: { ...person, role: "CLEANER" }, requestedBy: { id: "office-1", name: "Olly" } }));
  m.office.mockResolvedValue([{ userId: "c1", name: "Jane", transport: "INBOX", path: "pipeline", state: "inbox_available" }]);
  m.sms.mockResolvedValue({ ok: true, status: "sent" });
});

describe("options for the dialog", () => {
  it("offers Inbox, Email and SMS with their reasons", async () => {
    expect(await options()).toMatchObject({
      person: { id: "c1", hasEmail: true, hasPhone: true, active: true },
      transports: { PUSH: { available: true }, EMAIL: { available: true }, SMS: { available: true } },
      saved: null, savedReadable: true, impersonating: false,
    });
    m.user.mockResolvedValue({ ...person, email: null, phone: null });
    const none = await options();
    expect(none.transports.EMAIL).toEqual({ available: false, reason: "No email address recorded." });
    expect(none.transports.SMS).toEqual({ available: false, reason: "No phone number recorded." });
    expect(none.transports.PUSH.available).toBe(true);
  });

  it("disables a transport that is not configured or switched off in Notifications", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    m.smsState.mockResolvedValue({ provider: "none", configured: false });
    m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: { "workforce.document_request": ["INBOX"] }, updatedAt: null });
    const body = await options();
    expect(body.transports.EMAIL.reason).toMatch(/not configured/);
    expect(body.transports.SMS.reason).toMatch(/switched off/);
    expect(body.transports.PUSH).toEqual({ available: false, reason: expect.stringMatching(/Switched off/) });
  });

  it("refuses an unknown person and shows nothing saved while impersonating", async () => {
    m.user.mockResolvedValueOnce(null);
    expect((await OPTIONS({ nextUrl: new URL("http://localhost/x?userId=nobody") } as never)).status).toBe(404);
    stored[PREF_KEY] = { version: 1, kinds: { document_request: { transports: ["EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } } };
    m.session.mockResolvedValue({ ...office, impersonation: { actorId: "admin-1" } });
    expect(await options()).toMatchObject({ saved: null, impersonating: true });
  });
});

describe("which transports a request uses", () => {
  it("uses explicit transports and remembers them for this office user only when asked", async () => {
    const response = await post(request({ transports: ["PUSH", "SMS"], rememberTransports: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ transportsUsed: ["PUSH", "SMS"], transportSource: "request", delivery: { sms: { state: "provider_accepted" } } });
    expect(m.office.mock.calls[0][0].transports).toEqual(["PUSH"]);
    expect(stored[PREF_KEY]).toMatchObject({ version: 1, kinds: { document_request: { transports: ["PUSH", "SMS"] } } });
    expect(m.raw).toHaveBeenCalled();
  });

  it("uses the saved choice silently when the request names none", async () => {
    stored[PREF_KEY] = { version: 1, kinds: { document_request: { transports: ["PUSH", "EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } } };
    const { result } = await (await post(request())).json();
    expect(result).toMatchObject({ transportsUsed: ["PUSH", "EMAIL"], transportSource: "saved" });
    expect(m.office.mock.calls[0][0].transports).toEqual(["PUSH", "EMAIL"]);
    expect(m.sms).not.toHaveBeenCalled();
  });

  it("never guesses from an unreadable saved choice: inbox only", async () => {
    stored[PREF_KEY] = { garbage: true };
    const { result } = await (await post(request())).json();
    expect(result).toMatchObject({ transportsUsed: ["PUSH"], transportSource: "default" });
    expect((await options()).savedReadable).toBe(false);
  });

  it("refuses an empty list, remembering nothing, an unknown transport and impersonation", async () => {
    expect((await post(request({ transports: [] }))).status).toBe(400);
    expect((await post(request({ rememberTransports: true }))).status).toBe(400);
    expect((await post(request({ transports: ["FAX"] }))).status).toBe(400);
    m.session.mockResolvedValueOnce({ ...office, impersonation: { actorId: "admin-1" } });
    const impersonated = await post(request({ transports: ["PUSH"], rememberTransports: true }));
    expect(impersonated.status).toBe(403);
    expect(m.requestCreate).not.toHaveBeenCalled();
    expect(m.settingUpsert).not.toHaveBeenCalled();
  });
});

describe("your sending choices (reset)", () => {
  it("lists and forgets the caller's own choice, never while impersonating", async () => {
    stored[PREF_KEY] = { version: 1, kinds: { document_request: { transports: ["EMAIL"], savedAt: "2026-11-12T00:00:00.000Z" } } };
    expect(await (await MINE()).json()).toMatchObject({ impersonating: false, readable: true, kinds: { document_request: { transports: ["EMAIL"] } } });
    const del = (body: unknown) => FORGET(new Request("http://localhost/api/me/send-transports", { method: "DELETE", body: JSON.stringify(body) }) as never);
    expect((await del({ kind: "something" })).status).toBe(400);
    const forgotten = await (await del({ kind: "document_request" })).json();
    expect(forgotten.kinds).toEqual({});
    expect(stored[PREF_KEY]).toEqual({ version: 1, kinds: {} });
    m.session.mockResolvedValue({ ...office, impersonation: { actorId: "admin-1" } });
    expect((await del({ kind: "document_request" })).status).toBe(403);
    expect(await (await MINE()).json()).toMatchObject({ impersonating: true, kinds: {} });
  });
});
