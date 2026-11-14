// @vitest-environment node
/**
 * "Xero needs reconnecting": INBOX only through the intent pipeline, to
 * active administrators (scope STAFF_MEMBER per person), one event per outage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn(), users: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.users } } }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ disabledTransports: {} }), typeRespectsPreferences: () => false }));
import { sendXeroReconnectNotice, XERO_SETTINGS_URL } from "@/lib/xero/reconnect-notice";
import { catalogEntry } from "@/lib/notifications/catalog";
import { wordingDefinition } from "@/lib/notifications/wording/registry";

const at = new Date("2026-11-15T02:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  m.send.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "admin-1", role: "ADMIN", name: "Owner", email: "o@example.invalid" }]);
});

describe("Xero reconnect notice", () => {
  it("goes to administrators' inbox only, once per outage, with the reason", async () => {
    await sendXeroReconnectNotice({ connectionId: "conn-1", tenantName: "Fixture Org", reason: "Xero refused to renew the sign-in.", needsReconnectAt: at });
    expect(m.users.mock.calls[0][0]).toMatchObject({ where: { isActive: true, role: "ADMIN" } });
    expect(m.send).toHaveBeenCalledTimes(1);
    const input = m.send.mock.calls[0][0];
    expect(input).toMatchObject({
      typeKey: "xero.reconnect_needed", eventKey: "xero.reconnect_needed", eventId: `xero-reconnect:conn-1:${at.toISOString()}`,
      transports: ["INBOX"], scopeType: "STAFF_MEMBER", severity: "ACTION", category: "billing", url: XERO_SETTINGS_URL, actorId: null,
    });
    expect(input.scopeId({ id: "admin-1" })).toBe("admin-1");
    expect(input.email).toBeUndefined();
    expect(input.subject).toBe("Xero needs reconnecting: Fixture Org");
    expect(input.body).toContain("Xero refused to renew the sign-in.");
  });

  it("sends nothing when there is no active administrator", async () => {
    m.users.mockResolvedValue([]);
    expect(await sendXeroReconnectNotice({ connectionId: "conn-1", tenantName: "Org", reason: "r", needsReconnectAt: at })).toEqual([]);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("is in the catalog as inbox-only pipeline, with editable wording", () => {
    expect(catalogEntry("xero.reconnect_needed")).toMatchObject({ transports: ["INBOX"], defaultTransports: ["INBOX"], path: "PIPELINE", producers: ["lib/xero/reconnect-notice.ts"], eventKeys: ["xero.reconnect_needed"] });
    expect(wordingDefinition("xero.reconnect_needed")?.status).toBe("EDITABLE");
  });
});
