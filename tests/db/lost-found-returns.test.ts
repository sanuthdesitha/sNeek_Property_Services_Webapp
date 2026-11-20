// @vitest-environment node
/**
 * Lost and found guest links and return requests (2026-11-20) on a real,
 * disposable PostgreSQL (127.0.0.1:55439, run with --no-file-parallelism).
 *
 * Covered: the token opens one item only (another item's token, a made-up
 * token, a revoked or expired link are refused); the guest's page carries no
 * office data; submit is idempotent; a change supersedes, a stale change and
 * a stale withdraw are refused; the acknowledgement's exact text is recorded;
 * approval at a clean creates exactly one JobTask and one guest message even
 * when retried, moves the item through the transition table and keeps the
 * guest's contact out of the task unless shared; "email to guests switched
 * off" is recorded as not sent with the text; the cleaner's completion
 * returns the item; a cancelled clean surfaces as needing a new arrangement;
 * client scope (another client's request is 404), recommend, and approval
 * refused while the setting is off; decline.
 *
 * Providers are replaced: the guest message action and the external send
 * record what they were asked; the office pipeline send is a spy.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "lost-found-returns-test-secret-0123456789";
  process.env.APP_URL = "https://app.example.test";
  return {
    client: null as unknown as PrismaClient,
    guestSends: [] as Array<{ actorId: string; input: Record<string, unknown>; email: { subject: string; html: string } | undefined }>,
    guestState: "provider_accepted" as "provider_accepted" | "skipped" | "failed",
    externalSends: [] as Array<Record<string, unknown>>,
    officeSends: [] as Array<Record<string, unknown>>,
  };
});
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
vi.mock("@/lib/notifications/guest-message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/guest-message")>();
  const seen = new Set<string>();
  return {
    ...actual,
    sendGuestMessage: async (actorId: string, input: Record<string, unknown>, _now: Date, _role: unknown, email?: { subject: string; html: string }) => {
      const key = String(input.idempotencyKey);
      if (seen.has(key)) return { state: "already_requested", errorCode: null };
      seen.add(key);
      m.guestSends.push({ actorId, input, email });
      return { state: m.guestState, errorCode: m.guestState === "skipped" ? "email_suppressed_or_disabled" : null };
    },
  };
});
vi.mock("@/lib/notifications/external-recipient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/external-recipient")>();
  return {
    ...actual,
    sendExternalRecipientMessage: async (input: Record<string, unknown>) => {
      m.externalSends.push(input);
      return { state: "provider_accepted", errorCode: null, requestId: "ack" };
    },
  };
});
vi.mock("@/lib/notifications/office-sends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/office-sends")>();
  return {
    ...actual,
    sendOfficeNotification: async (input: Record<string, unknown>) => {
      m.officeSends.push(input);
      return [];
    },
  };
});

import { ensureGuestLink, guestLinkToken, resolveGuestLink, revokeGuestLink } from "@/lib/lost-found/guest-link";
import { guestPageView, submitGuestRequest, withdrawGuestRequest, ReturnRequestError } from "@/lib/lost-found/return-requests";
import { approveReturnRequest, completeReturnRequest, declineReturnRequest, officeRequestViews, reviewReturnArrangementsForJob } from "@/lib/lost-found/return-decisions";
import { clientReviewReturnRequest, listClientLostFound } from "@/lib/lost-found/return-client";
import { applyCleanerJobTaskUpdates } from "@/lib/job-tasks/service";
import { cancelJob } from "@/lib/jobs/cancel";
import { LOST_FOUND_SETTINGS_KEY, readLostFoundSettings, saveLostFoundSettings } from "@/lib/lost-found/settings";
import type { ClientPortalContext } from "@/lib/auth/client-portal";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `lfr-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const admin = { id: id("admin"), role: "ADMIN" as const, name: "Ada Admin" };
const allowed = { allowed: true, reason: null };

function portal(overrides: Partial<ClientPortalContext> & { userId: string; clientId: string }): ClientPortalContext {
  return { actor: "CLIENT", userName: "Client", team: null, permissions: {} as never, propertyIds: null, visibility: {} as never, settings: {} as never, actorLabel: "Client", ...overrides };
}

function dayFromNow(days: number): Date {
  const today = new Date().toISOString().slice(0, 10);
  return new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000);
}

async function openLink(itemId: string) {
  const summary = await ensureGuestLink(itemId, admin.id, "ensure");
  const token = summary.url.split("/").pop()!;
  const resolved = await resolveGuestLink(token);
  if (resolved.state !== "open") throw new Error(`link not open: ${resolved.state}`);
  return { token, resolved };
}

function submitBody(overrides: Record<string, unknown> = {}) {
  return { action: "submit", submissionKey: `key-${randomUUID()}`, method: "PICKUP_AT_CLEAN", requestedJobId: id("job1"), contactName: "Gina Guest", contactEmail: "gina@example.test", contactPhone: "0412 345 678", understood: true, ...overrides };
}

let savedSettings: unknown = undefined;

describe.skipIf(!url)("lost and found return requests (explicit local DB)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    savedSettings = (await m.client.appSetting.findUnique({ where: { key: LOST_FOUND_SETTINGS_KEY } }))?.value;
    await m.client.appSetting.deleteMany({ where: { key: LOST_FOUND_SETTINGS_KEY } });
    await m.client.user.createMany({
      data: [
        { id: id("admin"), email: `${id("admin")}@test.local`, role: "ADMIN", name: "Ada Admin" },
        { id: id("cleaner"), email: `${id("cleaner")}@test.local`, role: "CLEANER", name: "Cleo Cleaner" },
        { id: id("cleaner2"), email: `${id("cleaner2")}@test.local`, role: "CLEANER", name: "Cam Cleaner" },
      ],
    });
    await m.client.client.createMany({ data: [{ id: id("ca"), name: `${tag} A` }, { id: id("cb"), name: `${tag} B` }] });
    await m.client.user.createMany({
      data: [
        { id: id("ua"), email: `${id("ua")}@test.local`, role: "CLIENT", name: "Ann Owner", clientId: id("ca") },
        { id: id("ub"), email: `${id("ub")}@test.local`, role: "CLIENT", name: "Bob Other", clientId: id("cb") },
      ],
    });
    await m.client.property.createMany({
      data: [
        { id: id("pa"), clientId: id("ca"), name: `${tag} Bondi`, address: "1 Secret St", suburb: "Bondi", accessCode: "4411" },
        { id: id("pb"), clientId: id("cb"), name: `${tag} Coogee`, address: "3 St", suburb: "Coogee" },
      ],
    });
    await m.client.job.createMany({
      data: [
        { id: id("job1"), jobNumber: `${tag}-J1`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: dayFromNow(5), startTime: "10:00" },
        { id: id("job2"), jobNumber: `${tag}-J2`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: dayFromNow(9), startTime: "14:00" },
      ],
    });
    await m.client.jobAssignment.createMany({ data: [{ jobId: id("job1"), userId: id("cleaner"), isPrimary: true }, { jobId: id("job2"), userId: id("cleaner2"), isPrimary: true }] });
    await m.client.reservation.create({ data: { id: id("stay"), propertyId: id("pa"), uid: id("stay"), startDate: new Date("2026-11-09T04:00:00.000Z"), endDate: new Date("2026-11-11T23:00:00.000Z"), guestName: "Gina Guest" } });
    const photos = [{ key: "lost-found/u/phone.jpg", url: "https://files.example.test/lost-found/u/phone.jpg" }];
    await m.client.lostFoundItem.createMany({
      data: [
        { id: id("item"), propertyId: id("pa"), reservationId: id("stay"), jobId: id("job1"), reportedByUserId: id("cleaner"), itemName: "Black phone charger", description: "SECRET-DESCRIPTION cleaner note", foundLocation: "Bedside drawer", photos, status: "IN_STORAGE", guestName: "Gina Guest", guestContact: "0499 000 111", estimatedValue: 45, storageLocation: "SHELF-B2" },
        { id: id("other"), propertyId: id("pb"), itemName: "Blue hat", photos: [{ key: "lost-found/u/hat.jpg", url: "https://files.example.test/hat.jpg" }], status: "IN_STORAGE" },
        { id: id("item3"), propertyId: id("pa"), itemName: "Sunglasses", photos: [], status: "IN_STORAGE", storageLocation: "Office" },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!m.client) return;
    const itemIds = ["item", "other", "item3"].map(id);
    await m.client.lostFoundItem.deleteMany({ where: { id: { in: itemIds } } });
    await m.client.jobTask.deleteMany({ where: { jobId: { in: [id("job1"), id("job2")] } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ jobId: { in: [id("job1"), id("job2")] } }, { userId: { in: [id("admin"), id("ua"), id("ub")] } }] } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { in: [id("job1"), id("job2")] } } });
    await m.client.job.deleteMany({ where: { id: { in: [id("job1"), id("job2")] } } });
    await m.client.reservation.deleteMany({ where: { id: id("stay") } });
    await m.client.property.deleteMany({ where: { id: { in: [id("pa"), id("pb")] } } });
    await m.client.user.deleteMany({ where: { id: { in: ["admin", "cleaner", "cleaner2", "ua", "ub"].map(id) } } });
    await m.client.client.deleteMany({ where: { id: { in: [id("ca"), id("cb")] } } });
    if (savedSettings !== undefined) await m.client.appSetting.upsert({ where: { key: LOST_FOUND_SETTINGS_KEY }, create: { key: LOST_FOUND_SETTINGS_KEY, value: savedSettings as object }, update: { value: savedSettings as object } });
    else await m.client.appSetting.deleteMany({ where: { key: LOST_FOUND_SETTINGS_KEY } });
    await m.client.$disconnect();
  });

  beforeEach(() => {
    m.guestSends.length = 0;
    m.externalSends.length = 0;
    m.officeSends.length = 0;
    m.guestState = "provider_accepted";
  });

  it("settings save merges into what is stored (a holding-days-only save keeps the fees) and is administrator only", async () => {
    await saveLostFoundSettings({ id: admin.id, role: "ADMIN" as never }, { postFee: { text: "Tracked post", cents: 1250 } });
    await saveLostFoundSettings({ id: admin.id, role: "ADMIN" as never }, { holdingDays: 14 });
    const settings = await readLostFoundSettings();
    expect(settings.postFee).toEqual({ text: "Tracked post", cents: 1250 });
    expect(settings.dropOffFee).toEqual({ text: null, cents: null });
    await expect(saveLostFoundSettings({ id: admin.id, role: "OPS_MANAGER" as never }, { holdingDays: 3 })).rejects.toThrow("FORBIDDEN");
    await saveLostFoundSettings({ id: admin.id, role: "ADMIN" as never }, { postFee: { text: null, cents: null } });
  });

  it("a token opens its own item only; made-up, revoked and expired links are refused", async () => {
    const { token, resolved } = await openLink(id("item"));
    expect(resolved.item.id).toBe(id("item"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await m.client.lostFoundGuestLink.findFirstOrThrow({ where: { itemId: id("item"), revokedAt: null } });
    expect(stored.tokenHash).not.toContain(token);
    expect(guestLinkToken(stored)).toBe(token);
    // Asking again returns the same open link, never a second one.
    expect((await ensureGuestLink(id("item"), admin.id, "ensure")).id).toBe(stored.id);

    const other = await openLink(id("other"));
    expect(other.resolved.item.id).toBe(id("other"));
    expect(other.token).not.toBe(token);
    expect((await resolveGuestLink("A".repeat(43))).state).toBe("invalid");
    expect((await resolveGuestLink("short")).state).toBe("invalid");

    await revokeGuestLink(id("other"), admin.id);
    expect((await resolveGuestLink(other.token)).state).toBe("revoked");

    const third = await openLink(id("item3"));
    await m.client.lostFoundGuestLink.updateMany({ where: { itemId: id("item3") }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resolveGuestLink(third.token)).state).toBe("expired");
  });

  it("the guest's page carries no office data and offers the upcoming cleans as dates only", async () => {
    const { resolved } = await openLink(id("item"));
    const view = await guestPageView(resolved);
    const text = JSON.stringify(view);
    for (const secret of ["SHELF-B2", "SECRET-DESCRIPTION", "Cleo", "0499 000 111", "4411", id("cleaner"), "45"]) expect(text).not.toContain(secret);
    // The guest is told which stay it is: their name, the stay dates (organisation calendar), the property and its address.
    expect(view.item.stay).toEqual({ guestName: "Gina Guest", propertyName: `${tag} Bondi`, propertyAddress: "1 Secret St, Bondi, NSW", checkIn: "2026-11-09", checkOut: "2026-11-12" });
    const noBooking = await guestPageView((await openLink(id("item3"))).resolved);
    expect(noBooking.item.stay).toMatchObject({ guestName: null, checkIn: null, checkOut: null, propertyAddress: "1 Secret St, Bondi, NSW" });
    expect(view.item).toMatchObject({ name: "Black phone charger", foundWhere: "Bedside drawer", propertyLabel: `${tag} Bondi, Bondi` });
    expect(view.item.photoUrls[0]).toMatch(/^\/api\/public\/lost-found\/[A-Za-z0-9_-]{43}\/photo$/);
    expect(view.options.upcomingCleans.map((option) => option.jobId)).toEqual([id("job1"), id("job2")]);
    expect(view.options.upcomingCleans[0]).toEqual({ jobId: id("job1"), date: dayFromNow(5).toISOString().slice(0, 10), window: "Morning" });
    expect(view.options.postFee).toBeNull();
    expect(view.item.heldUntil).not.toBeNull();
  });

  it("submit is idempotent, records the acknowledgement's exact text, and a change supersedes (stale changes refused)", async () => {
    const { resolved } = await openLink(id("item"));
    const body = submitBody();
    const first = await submitGuestRequest(resolved, body);
    const again = await submitGuestRequest(resolved, body);
    expect(again.replayed).toBe(true);
    expect(again.request.id).toBe(first.request.id);
    expect(await m.client.lostFoundReturnRequest.count({ where: { itemId: id("item") } })).toBe(1);
    expect(first.request.requestedDate).toBe(dayFromNow(5).toISOString().slice(0, 10));

    expect(m.externalSends).toHaveLength(1);
    const ack = m.externalSends[0];
    expect(ack).toMatchObject({ kind: "lostfound.return_ack", transport: "EMAIL", to: "gina@example.test", actorId: admin.id });
    expect(String(ack.body)).toContain("Hi Gina");
    expect(String(ack.body)).toContain("/lost-found/");
    expect(String(ack.body)).toContain("not confirmed yet");
    expect(String(ack.body)).toContain(`Your stay\nGuest: Gina Guest\nStay: 9 November 2026 to 12 November 2026\nProperty: ${tag} Bondi, 1 Secret St, Bondi, NSW`);
    const ackEvent = await m.client.lostFoundEvent.findFirstOrThrow({ where: { itemId: id("item"), action: "RETURN_ACK_SENT" } });
    expect(ackEvent.note).toContain(String(ack.body));
    expect(m.officeSends.some((send) => send.typeKey === "lostfound.return_request" && send.scopeType === "LOST_ITEM_OFFICE")).toBe(true);

    await expect(submitGuestRequest(resolved, submitBody({ method: "POST", requestedJobId: null, address: { line1: "9 Home Rd", suburb: "Perth", state: "WA", postcode: "6000" } }))).rejects.toMatchObject({ status: 409, code: "STALE" });
    const changed = await submitGuestRequest(resolved, submitBody({ replacesRequestId: first.request.id, replacesVersion: first.request.version, requestedJobId: id("job2") }));
    const old = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: first.request.id } });
    expect(old.status).toBe("SUPERSEDED");
    expect(old.requestedJobId).toBe(id("job1"));
    const fresh = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: changed.request.id } });
    expect(fresh).toMatchObject({ status: "PENDING", supersedesId: first.request.id, requestedJobId: id("job2") });

    // Withdraw with a stale version is refused; with the current one it works; then a new request is allowed.
    await expect(withdrawGuestRequest(resolved, { action: "withdraw", requestId: fresh.id, version: fresh.version + 5 })).rejects.toBeInstanceOf(ReturnRequestError);
    const withdrawn = await withdrawGuestRequest(resolved, { action: "withdraw", requestId: fresh.id, version: fresh.version });
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(await m.client.lostFoundEvent.count({ where: { itemId: id("item"), action: "RETURN_REQUEST_WITHDRAWN" } })).toBe(1);
  });

  it("approval at a clean creates exactly one JobTask and one guest message, even when retried", async () => {
    const { resolved } = await openLink(id("item"));
    const { request } = await submitGuestRequest(resolved, submitBody());
    const decision = {
      action: "approve", version: request.version, decisionKey: `dec-${randomUUID()}`, method: "PICKUP_AT_CLEAN", jobId: id("job1"), time: "between 11 and 12",
      feeState: "NOT_SET", note: null, shareContactWithCleaner: false, cleanerTransports: ["INBOX"],
      message: { send: "EMAIL", subject: "Your Black phone charger: return confirmed", body: "Hi Gina, collect it on the day. https://app.example.test/lost-found/x" },
    };
    const first = await approveReturnRequest(id("item"), request.id, decision, admin, allowed);
    const retry = await approveReturnRequest(id("item"), request.id, decision, admin, allowed);
    expect(retry.replayed).toBe(true);
    const tasks = await m.client.jobTask.findMany({ where: { jobId: id("job1"), title: { contains: "Lost property handover" }, executionStatus: { not: "CANCELLED" } } });
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task).toMatchObject({ visibleToCleaner: true, requiresPhoto: true, source: "ADMIN" });
    expect((task.metadata as Record<string, unknown>).kind).toBe("LOST_FOUND_RETURN");
    expect(task.description).toContain("SHELF-B2");
    expect(task.description).toContain("Gina");
    expect(task.description).not.toContain("gina@example.test");
    expect(task.description).not.toContain("0412");
    expect(m.guestSends).toHaveLength(1);
    expect(m.guestSends[0].input).toMatchObject({ transport: "EMAIL", to: "gina@example.test", body: decision.message.body });
    expect(first.guestMessage).toMatchObject({ state: "provider_accepted", body: decision.message.body });
    const item = await m.client.lostFoundItem.findUniqueOrThrow({ where: { id: id("item") } });
    expect(item.status).toBe("RETURN_OFFERED");
    const row = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ status: "APPROVED", jobTaskId: task.id, confirmedDate: dayFromNow(5).toISOString().slice(0, 10), feeState: "NOT_SET", feeCents: null, taskCleanerIds: [id("cleaner")] });
    const sentEvent = await m.client.lostFoundEvent.findFirstOrThrow({ where: { itemId: id("item"), action: "RETURN_GUEST_MESSAGE" } });
    expect(sentEvent.note).toContain(decision.message.body);
    expect(m.officeSends.some((send) => send.typeKey === "lostfound.return_task" && send.scopeType === "JOB_ASSIGNED_CLEANER")).toBe(true);

    // The cleaner completes the task with a photo: the request is completed and the item returned.
    await applyCleanerJobTaskUpdates({ jobId: id("job1"), propertyId: id("pa"), clientId: id("ca"), cleanerId: id("cleaner"), taskUpdates: [{ id: task.id, decision: "COMPLETED", proofKeys: ["jobs/job1/handover.jpg"] }] });
    expect((await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("COMPLETED");
    expect((await m.client.lostFoundItem.findUniqueOrThrow({ where: { id: id("item") } })).status).toBe("RETURNED");
    const views = await officeRequestViews(id("item"));
    expect(views.find((view) => view.id === request.id)?.evidence.map((photo) => photo.key)).toEqual(["jobs/job1/handover.jpg"]);
    // No carry-forward copy was made for the next clean.
    expect(await m.client.jobTask.count({ where: { source: "CARRY_FORWARD", parentTaskId: task.id } })).toBe(0);
  });

  it("a cancelled clean puts the handover back to the office as needing a new arrangement", async () => {
    await m.client.lostFoundItem.update({ where: { id: id("item3") }, data: { status: "IN_STORAGE" } });
    await m.client.lostFoundGuestLink.updateMany({ where: { itemId: id("item3") }, data: { revokedAt: new Date() } });
    const { resolved } = await openLink(id("item3"));
    const { request } = await submitGuestRequest(resolved, submitBody({ requestedJobId: id("job2"), contactEmail: null }));
    await approveReturnRequest(id("item3"), request.id, {
      action: "approve", version: request.version, decisionKey: `dec-${randomUUID()}`, method: "PICKUP_AT_CLEAN", jobId: id("job2"), feeState: "NO_FEE",
      shareContactWithCleaner: true, cleanerTransports: ["INBOX"], message: { send: "NONE", subject: "s", body: "b" },
    }, admin, allowed);
    const task = await m.client.jobTask.findFirstOrThrow({ where: { jobId: id("job2"), title: { contains: "Sunglasses" } } });
    expect(task.description).toContain("0412 345 678");
    await cancelJob(id("job2"), { reason: "Owner cancelled the booking" }, { id: admin.id, isAdmin: true });
    expect(await reviewReturnArrangementsForJob(id("job2"))).toBe(1);
    expect(await reviewReturnArrangementsForJob(id("job2"))).toBe(0);
    const row = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.attentionReason).toBe("job_cancelled");
    expect(await m.client.lostFoundEvent.count({ where: { itemId: id("item3"), action: "RETURN_NEEDS_REARRANGING" } })).toBe(1);
    expect((await officeRequestViews(id("item3")))[0].attention).toBe("job_cancelled");
    expect(m.officeSends.some((send) => send.typeKey === "lostfound.return_request")).toBe(true);
  });

  it("email to guests switched off is recorded as not sent, with the message kept to copy; decline needs a reason", async () => {
    await m.client.lostFoundItem.update({ where: { id: id("other") }, data: { status: "IN_STORAGE" } });
    const { resolved } = await openLink(id("other"));
    const { request } = await submitGuestRequest(resolved, submitBody({ method: "OTHER", requestedJobId: null, otherDetails: "My friend will collect it" }));
    m.guestState = "skipped";
    const result = await declineReturnRequest(id("other"), request.id, {
      action: "decline", version: request.version, decisionKey: `dec-${randomUUID()}`, note: "We cannot hand items to third parties",
      message: { send: "EMAIL", subject: "About returning your Blue hat", body: "Sorry, we cannot hand it to a friend." },
    }, admin, allowed);
    expect(result.guestMessage).toMatchObject({ state: "skipped" });
    expect(result.guestMessage?.note).toMatch(/not sent/i);
    const event = await m.client.lostFoundEvent.findFirstOrThrow({ where: { itemId: id("other"), action: "MESSAGE_NOT_SENT", meta: { path: ["requestId"], equals: request.id } } });
    expect(event.note).toContain("Sorry, we cannot hand it to a friend.");
    await expect(declineReturnRequest(id("other"), request.id, { action: "decline", version: 99, decisionKey: `dec-${randomUUID()}`, note: "x", message: { send: "NONE", subject: "s", body: "b" } }, admin, allowed)).rejects.toBeTruthy();
  });

  it("clients see only their own properties' items; another client's request is 404; approval is refused while the setting is off", async () => {
    await m.client.lostFoundItem.update({ where: { id: id("item") }, data: { status: "IN_STORAGE" } });
    const { resolved } = await openLink(id("item"));
    const { request } = await submitGuestRequest(resolved, submitBody({ method: "PICKUP_OTHER_TIME", requestedJobId: null, proposedTime: "Saturday after 2 pm" }));
    const clientA = portal({ userId: id("ua"), clientId: id("ca"), userName: "Ann Owner" });
    const clientB = portal({ userId: id("ub"), clientId: id("cb"), userName: "Bob Other" });

    const listA = await listClientLostFound(clientA);
    const listB = await listClientLostFound(clientB);
    expect(listA.items.map((item) => item.id)).toContain(id("item"));
    expect(listA.items.map((item) => item.id)).not.toContain(id("other"));
    expect(listB.items.map((item) => item.id)).not.toContain(id("item"));
    const text = JSON.stringify(listA);
    for (const secret of ["SHELF-B2", "SECRET-DESCRIPTION", "gina@example.test", "0412 345 678", "Cleo"]) expect(text).not.toContain(secret);

    await expect(clientReviewReturnRequest(clientB, request.id, { verdict: "recommend", version: request.version })).rejects.toMatchObject({ status: 404 });
    await expect(clientReviewReturnRequest(clientA, request.id, { verdict: "approve", version: request.version, decisionKey: `cl-${randomUUID()}` })).rejects.toMatchObject({ status: 403 });
    const reviewed = await clientReviewReturnRequest(clientA, request.id, { verdict: "recommend", version: request.version, note: "Fine by me" });
    expect(reviewed.verdict).toBe("RECOMMENDED");
    const row = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ status: "PENDING", clientReview: "RECOMMENDED", clientReviewNote: "Fine by me", clientReviewedById: id("ua") });
    expect(m.guestSends).toHaveLength(0);
    expect(await m.client.jobTask.count({ where: { title: { contains: "Black phone charger" }, executionStatus: "OPEN" } })).toBe(0);
    expect(m.officeSends.some((send) => send.typeKey === "lostfound.return_request")).toBe(true);
  });

  it("manual completion for post records the tracking reference and returns the item", async () => {
    await m.client.lostFoundItem.update({ where: { id: id("item") }, data: { status: "IN_STORAGE" } });
    const live = await m.client.lostFoundReturnRequest.findFirstOrThrow({ where: { itemId: id("item"), status: "PENDING" } });
    const approved = await approveReturnRequest(id("item"), live.id, {
      action: "approve", version: live.version, decisionKey: `dec-${randomUUID()}`, method: "POST", feeState: "QUOTED", feeAmount: "12.50", feeNote: "Express Post",
      shareContactWithCleaner: false, cleanerTransports: ["INBOX"], message: { send: "NONE", subject: "s", body: "b" },
    }, admin, allowed);
    expect(approved.request).toMatchObject({ feeState: "QUOTED", feeCents: 1250, jobTaskId: null });
    await expect(approveReturnRequest(id("item"), live.id, { action: "approve", version: live.version + 1, decisionKey: `dec-${randomUUID()}`, method: "POST", feeState: "QUOTED", feeAmount: "abc", message: { send: "NONE", subject: "s", body: "b" } }, admin, allowed)).rejects.toMatchObject({ status: 400 });
    const current = await m.client.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: live.id } });
    const done = await completeReturnRequest(id("item"), live.id, { action: "complete", version: current.version, note: "Posted at Bondi PO", trackingReference: "AP123" }, admin);
    expect(done).toMatchObject({ status: "COMPLETED", trackingReference: "AP123" });
    expect((await m.client.lostFoundItem.findUniqueOrThrow({ where: { id: id("item") } })).status).toBe("RETURNED");
  });
});
