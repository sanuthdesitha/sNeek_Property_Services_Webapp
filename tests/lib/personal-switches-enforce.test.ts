// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The send-time check (lib/notifications/personal/enforce.ts) on every
 * transport, with the recipient found the way each chokepoint finds them:
 * email by address, text by phone number, app (inbox, phone push, browser
 * push) by account. A client who switched notifications off gets none of the
 * automatic messages; security messages and a person's deliberate office send
 * still go; an unreadable switch follows the email layer's fail-open rule.
 */
const m = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  clientFindUnique: vi.fn(),
  clientFindMany: vi.fn(),
  appSetting: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: m.userFindUnique, findMany: m.userFindMany },
    client: { findUnique: m.clientFindUnique, findMany: m.clientFindMany },
    appSetting: { findUnique: m.appSetting },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkPersonalSend } from "@/lib/notifications/personal/enforce";
import { applyPersonalInboxSwitches, writeDecidedInbox } from "@/lib/notifications/personal/inbox-guard";
import { fixedReasonFor, personalTransportsOfType, personalTypesFor } from "@/lib/notifications/personal/model";

const CLIENT_ROW = {
  id: "client-1", name: "Harbour Stays",
  notificationPref: { notificationsEnabled: false, notifyOnEnRoute: true, notifyOnJobStart: true, notifyOnJobComplete: true, preferredChannel: "EMAIL", switches: null },
};
const LOGIN_ROW = { id: "login-1", name: "Ana", role: "CLIENT", clientId: "client-1", allEmailOff: false, emailPreferences: [], notificationPreference: null };

beforeEach(() => {
  vi.resetAllMocks();
  m.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "login-1" ? LOGIN_ROW : null));
  m.userFindMany.mockResolvedValue([]);
  m.clientFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "client-1" ? CLIENT_ROW : null));
  // The client's own address and phone, not a login.
  m.clientFindMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ("email" in where || "phone" in where ? [CLIENT_ROW] : []));
  m.appSetting.mockResolvedValue(null);
});

describe("a client with notifications off", () => {
  const automaticClientTypes = personalTypesFor("CLIENT").filter((entry) => fixedReasonFor(entry, false) === null);

  it("gets no automatic message of any client type on any transport", async () => {
    for (const entry of automaticClientTypes) {
      for (const transport of personalTransportsOfType(entry)) {
        const check = transport === "EMAIL"
          ? await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", meta: { typeKey: entry.key } })
          : transport === "SMS"
            ? await checkPersonalSend({ transport: "SMS", address: "0412 000 111", meta: { typeKey: entry.key } })
            : await checkPersonalSend({ transport: "INBOX", userId: "login-1", meta: { typeKey: entry.key } });
        expect(check.allowed, `${entry.key} ${transport}`).toBe(false);
        if (!check.allowed) expect(check.text).toBe("Not sent: this client has switched these notifications off.");
      }
    }
  });

  it("an email with no type and no kind (the old gap) is stopped too", async () => {
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", hints: { subject: "Something new" } })).allowed).toBe(false);
  });

  it("phone and browser push to a client login are stopped", async () => {
    expect((await checkPersonalSend({ transport: "MOBILE_PUSH", userId: "login-1", hints: { category: "jobs" } })).allowed).toBe(false);
    expect((await checkPersonalSend({ transport: "WEB_PUSH", userId: "login-1", meta: { recipientUserId: "login-1" } })).allowed).toBe(false);
  });

  it("security messages always go", async () => {
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", critical: true })).allowed).toBe(true);
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", meta: { typeKey: "account.security" } })).allowed).toBe(true);
    expect((await checkPersonalSend({ transport: "SMS", address: "0412000111", meta: { typeKey: "account.invitations" } })).allowed).toBe(true);
  });

  it("a message a person in the office deliberately sent still goes", async () => {
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", meta: { typeKey: "client.documents", officeDecision: true } })).allowed).toBe(true);
  });

  it("campaigns follow their own consent and unsubscribe, not this switch", async () => {
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", marketing: true })).allowed).toBe(true);
    expect((await checkPersonalSend({ transport: "SMS", address: "0412000111", meta: { typeKey: "marketing.campaigns" } })).allowed).toBe(true);
  });

  it("an inbox row written by any producer is recorded as not sent and never pushed", async () => {
    const row = { userId: "login-1", channel: "PUSH", subject: "Case updated", body: "x", status: "SENT", externalId: "mobile-outbox:pending:cases" };
    const out = await applyPersonalInboxSwitches({ ...row });
    expect(out).toMatchObject({ status: "FAILED", externalId: null, errorMsg: "Not sent: this client has switched these notifications off." });
    const many = await applyPersonalInboxSwitches([{ ...row }, { ...row, userId: "someone-else" }]);
    expect(many[0]).toMatchObject({ status: "FAILED" });
    expect(many[1]).toMatchObject({ status: "SENT" });
  });

  it("a write that already decided (or a deliberate office send) is left as written", async () => {
    const row = { userId: "login-1", channel: "PUSH", subject: "Approval needed", body: "x", status: "SENT" };
    const out = await writeDecidedInbox("OFFICE_DECISION", () => applyPersonalInboxSwitches({ ...row }));
    expect(out).toMatchObject({ status: "SENT" });
    expect(await applyPersonalInboxSwitches({ ...row, id: "intent-123" })).toMatchObject({ status: "SENT" });
  });
});

describe("fail rule", () => {
  it("allows the message when the switches cannot be read (as the email preference layer does)", async () => {
    m.clientFindMany.mockRejectedValue(new Error("database unavailable"));
    expect((await checkPersonalSend({ transport: "EMAIL", address: "office@harbour.example", meta: { typeKey: "client.post_job" } })).allowed).toBe(true);
  });
});

describe("staff", () => {
  it("an operational type the office must be able to send is never stopped by a person's switch", async () => {
    m.userFindUnique.mockResolvedValue({ id: "cleaner-1", name: "Cleo", role: "CLEANER", clientId: null, allEmailOff: true, emailPreferences: [], notificationPreference: { switches: { all: false } } });
    expect((await checkPersonalSend({ transport: "INBOX", userId: "cleaner-1", meta: { typeKey: "job.skipped_or_cancelled" } })).allowed).toBe(true);
    expect((await checkPersonalSend({ transport: "EMAIL", userId: "cleaner-1", meta: { typeKey: "job.changed", recipientUserId: "cleaner-1" } })).allowed).toBe(false);
  });
});
