// @vitest-environment node
/**
 * Boards "Invite person", "Hiring application" and "Add client" (2026-11-16)
 * on a real disposable PostgreSQL (127.0.0.1:55439, a FRESH database: these
 * tests write the operations permission policy, a fixture-wide setting).
 *
 * One account service: an invitation link (never a temporary password in any
 * email or response), explicit roles, starting packs for an ops manager,
 * SMS only when ticked, repeat-safe submits, the email-in-use rules, the
 * operations-manager hiring limit and testing-as refusal on the server,
 * stage moves that never send, and Add client with a portal login.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The designed invitation email only draws its button for an absolute link.
vi.hoisted(() => {
  process.env.APP_BASE_URL = "https://app.example.invalid";
});
const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  emails: [] as Array<{ to: string; subject: string; html: string }>,
  sms: [] as Array<{ to: string; body: string }>,
  emailOk: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/account-state", () => ({ upsertAuthUserState: vi.fn(async () => ({})) }));
vi.mock("@/lib/accounts/user-details", () => ({ upsertUserExtendedProfile: vi.fn(async () => ({})), getUserExtendedProfiles: vi.fn(async () => new Map()) }));
vi.mock("@/lib/notifications/email", () => ({
  sendEmailDetailed: vi.fn(async (input: { to: string; subject: string; html: string }) => {
    m.emails.push({ to: input.to, subject: input.subject, html: input.html });
    return m.emailOk ? { ok: true, acceptance: "ACCEPTED", externalId: "x" } : { ok: false, error: "mailbox unavailable", acceptance: "NOT_ACCEPTED" };
  }),
}));
vi.mock("@/lib/notifications/sms", () => ({
  sendSmsDetailed: vi.fn(async (to: string, body: string) => {
    m.sms.push({ to, body });
    return { ok: true, status: "sent", provider: "twilio" };
  }),
}));
vi.mock("@/lib/workforce/service", () => ({
  autoAssignCleanerLearning: vi.fn(async () => undefined),
  ensureDefaultLearningPaths: vi.fn(async () => undefined),
  prepareHiredStaffAccount: vi.fn(async () => undefined),
  getHiringApplicationDetail: vi.fn(async () => null),
}));

import { createAccountWithInvitation, AccountCreateError } from "@/lib/accounts/create-account";
import type { ResolvedAccountCreator } from "@/lib/accounts/account-creator";
import { hireApplicant, HiringError, loadHirePreview, moveApplicationStage } from "@/lib/hiring/hire";
import { createClientWithLogin, findSimilarClients } from "@/lib/clients/create-client";
import { getOpsPolicy } from "@/lib/rbac/ops-access";
import { resolveOpsLevels } from "@/lib/rbac/ops-policy";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `hire-${randomUUID().slice(0, 8)}`;
const ids = { admin: randomUUID(), ops: randomUUID(), position: randomUUID(), opsPosition: randomUUID(), client: randomUUID() };
const adminActor = { id: ids.admin, role: "ADMIN" as const };
const adminCreator: ResolvedAccountCreator = { id: ids.admin, heldRoles: ["ADMIN"], impersonating: false, hiringLevel: null, actorRole: "ADMIN" };
const opsCreator: ResolvedAccountCreator = { id: ids.ops, heldRoles: ["OPS_MANAGER"], impersonating: false, hiringLevel: "manage", actorRole: "OPS_MANAGER" };
const email = (name: string) => `${tag}-${name}@example.invalid`;

async function application(name: string, status: string, positionId = ids.position, offerDetails?: Record<string, string>) {
  return m.client.hiringApplication.create({ data: { positionId, fullName: `${name} Test`, email: email(name), phone: "0421660302", status, offerDetails } });
}

function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/accept-invite\//);
  expect(text.toLowerCase()).not.toContain("password\":");
  expect(text.toLowerCase()).not.toContain("temppassword");
}

describe.skipIf(!url)("account creation, hiring and add client (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [
      { id: ids.admin, email: email("admin"), role: Role.ADMIN },
      { id: ids.ops, email: email("ops"), role: Role.OPS_MANAGER },
      { email: email("gone"), role: Role.CLEANER, isActive: false, name: "Gone" },
    ] });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} Harbour View Stays`, email: email("harbour") } });
    await m.client.user.create({ data: { email: email("clientlogin"), role: Role.CLIENT, clientId: ids.client } });
    await m.client.hiringPosition.createMany({ data: [
      { id: ids.position, title: "Estate Cleaner", slug: `${tag}-cleaner`, description: "x", applicationSchema: {}, createdById: ids.admin, hireAccountRole: Role.CLEANER },
      { id: ids.opsPosition, title: "Ops coordinator", slug: `${tag}-ops`, description: "x", applicationSchema: {}, createdById: ids.admin, hireAccountRole: Role.OPS_MANAGER },
    ] });
  });

  beforeEach(() => {
    m.emails.length = 0;
    m.sms.length = 0;
    m.emailOk = true;
  });

  afterAll(async () => {
    if (!m.client) return;
    const users = await m.client.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await m.client.hiringApplication.deleteMany({ where: { positionId: { in: [ids.position, ids.opsPosition] } } });
    await m.client.hiringPosition.deleteMany({ where: { id: { in: [ids.position, ids.opsPosition] } } });
    await m.client.user.deleteMany({ where: { id: { in: userIds } } });
    await m.client.client.deleteMany({ where: { name: { startsWith: tag } } });
    await m.client.$disconnect();
  });

  it("Invite person creates the explicit role with a single-use invitation link, never a password", async () => {
    const outcome = await createAccountWithInvitation({
      actor: adminActor, origin: "INVITE_PERSON", idempotencyKey: `${tag.replace(/-/g, "")}a1`,
      input: { name: "Rosa Martinez", email: email("rosa"), phone: "0438112905", role: Role.CLEANER, signIn: "INVITATION", sendSms: false },
    });
    const user = await m.client.user.findUniqueOrThrow({ where: { email: email("rosa") }, include: { invitation: true } });
    expect(user.role).toBe(Role.CLEANER);
    expect(user.emailVerified).toBeNull();
    expect(user.invitation?.acceptedAt).toBeNull();
    expect(user.invitation!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(outcome.email.state).toBe("ACCEPTED");
    expect(outcome.sms.state).toBe("NOT_REQUESTED");
    expect(m.sms).toHaveLength(0);
    expect(m.emails).toHaveLength(1);
    expect(m.emails[0].html).toContain(`https://app.example.invalid/accept-invite/${user.invitation!.token}`);
    expect(m.emails[0].html.toLowerCase()).not.toContain("temporary password");
    noSecrets(outcome);
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { action: "CREATE_USER", entityId: user.id } });
    expect(audit.userId).toBe(ids.admin);
    expect(JSON.stringify(audit.after)).not.toContain(user.invitation!.token);
  });

  it("a double submit with the same key creates one account and sends one email", async () => {
    const key = `${tag.replace(/-/g, "")}dbl`;
    const run = () => createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", idempotencyKey: key, input: { name: "Twice", email: email("twice"), role: Role.LAUNDRY, signIn: "INVITATION", sendSms: false } });
    const [first, second] = await Promise.all([run(), run()]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.user.id).toBe(second.user.id);
    expect(await m.client.user.count({ where: { email: email("twice") } })).toBe(1);
    expect(m.emails).toHaveLength(1);
  });

  it("SMS goes only when ticked, as its own explicit transport with the link", async () => {
    const outcome = await createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", input: { name: "Sms", email: email("sms"), phone: "0438000111", role: Role.CLEANER, signIn: "INVITATION", sendSms: true } });
    expect(outcome.sms.state).toBe("ACCEPTED");
    expect(m.sms).toHaveLength(1);
    expect(m.sms[0].body).toMatch(/\/accept-invite\//);
    noSecrets(outcome);
  });

  it("refuses a used email with the reason and creates nothing", async () => {
    await expect(createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", input: { name: "x", email: email("gone"), role: Role.CLEANER, signIn: "INVITATION", sendSms: false } }))
      .rejects.toMatchObject({ code: "EMAIL_IN_USE", message: expect.stringMatching(/deactivated\)\. Open that account to reactivate it instead\./) });
    await expect(createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", input: { name: "x", email: email("clientlogin"), role: Role.CLEANER, signIn: "INVITATION", sendSms: false } }))
      .rejects.toMatchObject({ code: "EMAIL_IN_USE", message: expect.stringMatching(/client login .* cannot become staff/) });
    expect(m.emails).toHaveLength(0);
  });

  it("an ops manager starts with exactly the ticked packs, nothing else", async () => {
    const outcome = await createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", input: { name: "Office", email: email("office"), role: Role.OPS_MANAGER, signIn: "INVITATION", sendSms: false, opsPacks: ["jobs", "calendar"] } });
    const levels = resolveOpsLevels(await getOpsPolicy(), outcome.user.id);
    expect(levels.jobs).toBe("manage");
    expect(levels.calendar).toBe("manage");
    expect(levels.finance).toBe("off");
    expect(levels.accounts).toBe("off");
  });

  it("an email failure keeps the account and its link, and says not delivered", async () => {
    m.emailOk = false;
    const outcome = await createAccountWithInvitation({ actor: adminActor, origin: "INVITE_PERSON", input: { name: "Fail", email: email("fail"), role: Role.CLEANER, signIn: "INVITATION", sendSms: false } });
    expect(outcome.email.state).toBe("NOT_ACCEPTED");
    expect(await m.client.userInvitation.count({ where: { userId: outcome.user.id } })).toBe(1);
  });

  it("Hired creates the role's explicit account through the same flow, once", async () => {
    const app = await application("leila", "OFFER");
    const result = await hireApplicant({ applicationId: app.id, creator: opsCreator, sendSms: false, idempotencyKey: `${tag.replace(/-/g, "")}h1` });
    expect(result.outcome.user.role).toBe(Role.CLEANER);
    noSecrets(result);
    const after = await m.client.hiringApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("HIRED");
    expect(after.hiredUserId).toBe(result.outcome.user.id);
    expect(m.emails).toHaveLength(1);
    expect(m.sms).toHaveLength(0);
    const again = await hireApplicant({ applicationId: app.id, creator: opsCreator, sendSms: true });
    expect(again.outcome.replayed).toBe(true);
    expect(m.emails).toHaveLength(1);
    expect(m.sms).toHaveLength(0);
  });

  it("enforces the operations-manager limit, testing-as and the explicit role on the server", async () => {
    const office = await application("officehire", "OFFER", ids.opsPosition);
    await expect(hireApplicant({ applicationId: office.id, creator: opsCreator, sendSms: false })).rejects.toMatchObject({ status: 403 });
    await expect(hireApplicant({ applicationId: office.id, creator: { ...adminCreator, impersonating: true }, sendSms: false })).rejects.toMatchObject({ status: 403 });
    await expect(hireApplicant({ applicationId: office.id, creator: { ...opsCreator, hiringLevel: "read" }, accountKind: "CLEANER", sendSms: false })).rejects.toMatchObject({ status: 403 });
    expect(await m.client.user.count({ where: { email: email("officehire") } })).toBe(0);

    const unset = await m.client.hiringPosition.create({ data: { title: "Unset", slug: `${tag}-unset`, description: "x", applicationSchema: {}, createdById: ids.admin } });
    const noRole = await m.client.hiringApplication.create({ data: { positionId: unset.id, fullName: "No Role", email: email("norole"), status: "OFFER" } });
    await expect(hireApplicant({ applicationId: noRole.id, creator: adminCreator, sendSms: false })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/no longer guesses/) });
    await m.client.hiringApplication.delete({ where: { id: noRole.id } });
    await m.client.hiringPosition.delete({ where: { id: unset.id } });

    const early = await application("early", "INTERVIEW");
    await expect(hireApplicant({ applicationId: early.id, creator: adminCreator, sendSms: false })).rejects.toMatchObject({ status: 409 });

    const clash = await m.client.hiringApplication.create({ data: { positionId: ids.position, fullName: "Clash", email: email("clientlogin"), status: "OFFER" } });
    const preview = await loadHirePreview(clash.id, adminCreator);
    expect(preview.emailInUse).toMatch(/client login/);
    expect(preview.refusal).toBeTruthy();
    await expect(hireApplicant({ applicationId: clash.id, creator: adminCreator, sendSms: false })).rejects.toBeInstanceOf(HiringError);
    expect((await m.client.hiringApplication.findUniqueOrThrow({ where: { id: clash.id } })).status).toBe("OFFER");
    expect(m.emails).toHaveLength(0);
  });

  it("a stage move never sends an email and refuses a stale or Hired move", async () => {
    const app = await application("mover", "SCREENING");
    await moveApplicationStage({ applicationId: app.id, actorId: ids.ops, to: "INTERVIEW", expectedFrom: "SCREENING" });
    expect(m.emails).toHaveLength(0);
    const event = await m.client.hiringApplicationEvent.findFirstOrThrow({ where: { applicationId: app.id, type: "STATUS_CHANGE" } });
    expect(event.data).toMatchObject({ from: "SCREENING", to: "INTERVIEW", emailSentByMove: false });
    await expect(moveApplicationStage({ applicationId: app.id, actorId: ids.ops, to: "OFFER", expectedFrom: "SCREENING" })).rejects.toMatchObject({ status: 409 });
    await expect(moveApplicationStage({ applicationId: app.id, actorId: ids.ops, to: "HIRED" })).rejects.toMatchObject({ status: 409 });
    await expect(moveApplicationStage({ applicationId: app.id, actorId: ids.ops, to: "REJECTED" })).rejects.toMatchObject({ status: 400 });
  });

  it("Add client creates the client, its preferences and an invitation-link login, once", async () => {
    const key = `${tag.replace(/-/g, "")}cl`;
    const input = {
      name: `${tag} Seaside Hosting`, email: email("seaside"), phone: "0412778230", portalLogin: true, paymentTermsDays: 14,
      notifications: { jobUpdates: true, enRoute: false, startFinish: true, liveLocation: true },
    };
    const actor = { id: ids.admin, role: "ADMIN", heldRoles: ["ADMIN"] };
    const [first, second] = await Promise.all([createClientWithLogin(input, actor, key), createClientWithLogin(input, actor, key)]);
    expect(first.client.id).toBe(second.client.id);
    expect(await m.client.client.count({ where: { name: input.name } })).toBe(1);
    const client = await m.client.client.findUniqueOrThrow({ where: { id: first.client.id }, include: { notificationPref: true, users: { include: { invitation: true } } } });
    expect(client.paymentTermsDays).toBe(14);
    expect(client.showCleanerLiveLocation).toBe(true);
    expect(client.notificationPref).toMatchObject({ notificationsEnabled: true, notifyOnEnRoute: false, notifyOnJobStart: true, notifyOnJobComplete: true, preferredChannel: "EMAIL" });
    expect(client.users).toHaveLength(1);
    expect(client.users[0].role).toBe(Role.CLIENT);
    expect(client.users[0].invitation).not.toBeNull();
    expect(m.emails).toHaveLength(1);
    expect(m.emails[0].html.toLowerCase()).not.toContain("temporary password");
    noSecrets(first);
  });

  it("warns about a similar client without blocking", async () => {
    const matches = await findSimilarClients({ name: "Harbour View Holdings", email: "someone@gmail.com" });
    expect(matches.some((match) => match.id === ids.client)).toBe(true);
    const created = await createClientWithLogin({ name: `${tag} Harbour View Holdings`, portalLogin: false }, { id: ids.admin, role: "ADMIN", heldRoles: ["ADMIN"] }, null);
    expect(created.client.id).toBeTruthy();
  });

  it("a portal login without an email is refused before anything is created", async () => {
    await expect(createClientWithLogin({ name: `${tag} No Email`, portalLogin: true }, { id: ids.admin, role: "ADMIN", heldRoles: ["ADMIN"] }, null)).rejects.toMatchObject({ status: 400, field: "email" });
    expect(await m.client.client.count({ where: { name: `${tag} No Email` } })).toBe(0);
    expect(AccountCreateError).toBeDefined();
  });
});
