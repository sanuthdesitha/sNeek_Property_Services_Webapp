// @vitest-environment node
/**
 * Personal notification switches (2026-11-21) on a real, disposable
 * PostgreSQL (127.0.0.1:55439):
 * - a client account stored with notifications off before this change (the
 *   reported bug) gets no automatic email through the real email chokepoint,
 *   by its own address or a login's, while a deliberate office send and a
 *   security email still go; the skip is reported, never as sent;
 * - the inbox middleware records a stopped row as not sent and the personal
 *   inbox query never returns it;
 * - the client and an administrator change the same switches; every change
 *   is stamped with the actual actor and audited; a save naming an older
 *   revision is refused; the older client route keeps working and is stamped;
 * - switching one type's email back on lifts an email-kind row without
 *   switching on the other types that row covered.
 *
 * Email: the provider SDK is a stub; the sending safeguards gate is replaced
 * so this test decides only the personal layer.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  sent: [] as Array<{ to: unknown; subject: string }>,
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: unknown; subject: string }) => {
        m.sent.push({ to: payload.to, subject: payload.subject });
        return { data: { id: `ext-${m.sent.length}` }, error: null };
      },
    };
  },
}));
vi.mock("@/lib/notifications/safeguards/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/safeguards/gate")>("@/lib/notifications/safeguards/gate");
  return {
    ...actual,
    guardOutbound: vi.fn(async () => ({ allowed: true, eventId: null, messageClass: "NORMAL" })),
    recordOutboundOutcome: vi.fn(async () => undefined),
    refuseOversizedSend: vi.fn(async () => null),
  };
});

import { sendEmailDetailed } from "@/lib/notifications/email";
import { applyPersonalInboxSwitches } from "@/lib/notifications/personal/inbox-guard";
import { notificationWhereForRole } from "@/lib/notifications/feed";
import { applySwitchChanges, StaleSwitchesError } from "@/lib/notifications/personal/write";
import { buildClientSwitchesView, buildUserSwitchesView } from "@/lib/notifications/personal/view";
import { listSwitchedOff } from "@/lib/notifications/personal/off-list";
import { PATCH as legacyClientPatch } from "@/app/api/me/client-notification-preferences/route";

const sessionMock = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => {
    if (!sessionMock.session) throw new Error("UNAUTHORIZED");
    return sessionMock.session;
  }),
  requireRole: vi.fn(async () => sessionMock.session),
}));

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `pns-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const clientEmail = `${tag}-office@test.local`;
const loginEmail = `${tag}-ana@test.local`;
const admin = { id: id("admin"), name: "Ada Admin", role: "ADMIN" };
const loginActor = { id: id("ana"), name: "Ana Client", role: "CLIENT" };

describe.skipIf(!url)("personal notification switches (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    process.env.RESEND_API_KEY = "re_test_stub";
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.create({ data: { id: admin.id, email: `${admin.id}@test.local`, role: "ADMIN", name: admin.name } });
    await m.client.user.create({ data: { id: id("cleo"), email: `${id("cleo")}@test.local`, role: "CLEANER", name: "Cleo Cleaner" } });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} Harbour Stays`, email: clientEmail, phone: "0412 999 001" } });
    await m.client.user.create({ data: { id: loginActor.id, email: loginEmail, role: "CLIENT", name: loginActor.name, clientId: id("client") } });
    // Stored before this change, exactly as the reported client had it.
    await m.client.clientNotificationPreference.create({ data: { clientId: id("client"), notificationsEnabled: false, notifyOnEnRoute: true, notifyOnJobStart: true, notifyOnJobComplete: true, preferredChannel: "EMAIL" } });
    // A cleaner who opted out of case emails before this change.
    await m.client.userEmailPreference.create({ data: { userId: id("cleo"), key: "case_alert", enabled: false } });
  });

  beforeEach(() => {
    m.sent.length = 0;
  });

  afterAll(async () => {
    if (!m.client) return;
    const userIds = [admin.id, id("cleo"), loginActor.id];
    await m.client.notification.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: [...userIds, id("client")] } }] } });
    await m.client.userEmailPreference.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.userNotificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.clientNotificationPreference.deleteMany({ where: { clientId: id("client") } });
    await m.client.user.deleteMany({ where: { id: { in: userIds } } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.$disconnect();
  });

  it("an automatic email to the client's address or a login's address is not sent, and says so", async () => {
    const byClient = await sendEmailDetailed({ kind: "case_alert", to: clientEmail, subject: "Case updated", html: "<p>x</p>" });
    expect(byClient).toMatchObject({ ok: false, skipped: true, personalSkip: { text: "Not sent: this client has switched these notifications off." } });
    const kindless = await sendEmailDetailed({ to: loginEmail, subject: "Your clean report is ready", html: "<p>x</p>" });
    expect(kindless).toMatchObject({ ok: false, skipped: true });
    expect(m.sent).toEqual([]);
  });

  it("a deliberate office send and a security email still go", async () => {
    const office = await sendEmailDetailed({ to: clientEmail, subject: "Your quote", html: "<p>x</p>", transactional: true, safeguard: { typeKey: "client.documents", officeDecision: true } });
    const security = await sendEmailDetailed({ to: loginEmail, subject: "Your sign-in code", html: "<p>x</p>", critical: true, transactional: true });
    expect(office.ok).toBe(true);
    expect(security.ok).toBe(true);
    expect(m.sent).toHaveLength(2);
  });

  it("an inbox row for the client login is recorded as not sent and never shown", async () => {
    const data = await applyPersonalInboxSwitches({ userId: loginActor.id, channel: "PUSH", subject: "Case updated", body: "x", status: "SENT", externalId: "mobile-outbox:pending:cases", sentAt: new Date() });
    const row = await m.client.notification.create({ data: data as never });
    expect(row).toMatchObject({ status: "FAILED", externalId: null, errorMsg: "Not sent: this client has switched these notifications off." });
    const inbox = await m.client.notification.findMany({ where: notificationWhereForRole("CLIENT" as never, loginActor.id) });
    expect(inbox.map((item) => item.id)).not.toContain(row.id);
  });

  it("the administrator sees what the client switched off, switches it back on, and the client sees it on", async () => {
    const before = await buildClientSwitchesView(id("client"), { canEdit: true, readOnlyReason: null });
    expect(before?.master.on).toBe(false);
    await applySwitchChanges({ subject: { kind: "CLIENT", id: id("client") }, actor: admin, expectedRevision: before!.revision, changes: [{ id: "all", on: true }] });
    const after = await buildClientSwitchesView(id("client"), { canEdit: false, readOnlyReason: null });
    expect(after?.master.on).toBe(true);
    expect(after?.master.changed).toMatchObject({ byName: "Ada Admin", byRole: "ADMIN" });
    const audit = await m.client.auditLog.findFirst({ where: { entity: "Client", entityId: id("client"), action: "NOTIFICATION_SWITCHES_CHANGED" }, orderBy: { createdAt: "desc" } });
    expect(audit?.userId).toBe(admin.id);
    expect((await sendEmailDetailed({ kind: "case_alert", to: clientEmail, subject: "Case updated", html: "<p>x</p>" })).ok).toBe(true);
  });

  it("a save naming an older revision is refused and changes nothing", async () => {
    const view = await buildClientSwitchesView(id("client"), { canEdit: true, readOnlyReason: null });
    await applySwitchChanges({ subject: { kind: "CLIENT", id: id("client") }, actor: loginActor, expectedRevision: view!.revision, changes: [{ id: "type:office.cases:EMAIL", on: false }] });
    await expect(applySwitchChanges({ subject: { kind: "CLIENT", id: id("client") }, actor: admin, expectedRevision: view!.revision, changes: [{ id: "type:office.cases:EMAIL", on: true }] })).rejects.toBeInstanceOf(StaleSwitchesError);
    const current = await buildClientSwitchesView(id("client"), { canEdit: true, readOnlyReason: null });
    const cell = current!.groups.flatMap((group) => group.rows).find((row) => row.key === "office.cases")!.cells.find((item) => item.transport === "EMAIL")!;
    expect(cell.on).toBe(false);
    expect(cell.changed).toMatchObject({ byName: "Ana Client" });
    // Per type and transport: case emails stop, a post-job email does not.
    expect((await sendEmailDetailed({ kind: "case_alert", to: clientEmail, subject: "Case updated", html: "<p>x</p>", safeguard: { typeKey: "office.cases" } })).ok).toBe(false);
    expect((await sendEmailDetailed({ kind: "client_automation", to: clientEmail, subject: "How did we do?", html: "<p>x</p>", safeguard: { typeKey: "client.post_job" } })).ok).toBe(true);
  });

  it("the older client route still works, refuses testing-as, and is stamped with the client", async () => {
    sessionMock.session = { user: { id: loginActor.id, name: loginActor.name, role: "CLIENT" }, impersonation: { actorId: admin.id } };
    const refused = await legacyClientPatch(new Request("http://localhost/api/me/client-notification-preferences", { method: "PATCH", body: JSON.stringify({ notificationsEnabled: false }) }) as never);
    expect(refused.status).toBe(403);
    sessionMock.session = { user: { id: loginActor.id, name: loginActor.name, role: "CLIENT" }, impersonation: null };
    const res = await legacyClientPatch(new Request("http://localhost/api/me/client-notification-preferences", { method: "PATCH", body: JSON.stringify({ notificationsEnabled: false, preferredChannel: "SMS" }) }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notificationsEnabled: false, preferredChannel: "SMS" });
    const view = await buildClientSwitchesView(id("client"), { canEdit: true, readOnlyReason: null });
    expect(view?.master).toMatchObject({ on: false, changed: { byName: "Ana Client", byRole: "CLIENT" } });
    const list = await listSwitchedOff();
    expect(list.find((entry) => entry.id === id("client"))).toMatchObject({ kind: "CLIENT", summary: expect.stringContaining("All notifications off") });
  });

  it("switching one type's email back on lifts the older kind switch without switching on the others", async () => {
    const before = await buildUserSwitchesView(id("cleo"), { canEdit: true, readOnlyReason: null });
    const casesEmail = before!.groups.flatMap((group) => group.rows).find((row) => row.key === "office.cases")!.cells.find((cell) => cell.transport === "EMAIL")!;
    expect(casesEmail.on).toBe(false);
    await applySwitchChanges({ subject: { kind: "USER", id: id("cleo") }, actor: admin, expectedRevision: before!.revision, changes: [{ id: casesEmail.id, on: true }] });
    expect(await m.client.userEmailPreference.count({ where: { userId: id("cleo"), key: "case_alert" } })).toBe(0);
    const pref = await m.client.userNotificationPreference.findUnique({ where: { userId: id("cleo") } });
    const switches = pref?.switches as Record<string, boolean>;
    expect(switches["type:office.cases:EMAIL"]).toBeUndefined();
    // Every other type of the same email kind stays off, one by one.
    const kindTypes = Object.keys(switches).filter((key) => key.endsWith(":EMAIL"));
    expect(kindTypes.every((key) => switches[key] === false)).toBe(true);
  });
});
