/**
 * Laundry team answers to office requests (2026-11-12): which answers fit
 * which request, the reply service's scope, recipient, idempotency and
 * refusal rules, the inbox states (open / answered / done), the transports
 * of a team request and the "after sending" receipt lines.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  audit: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  reply: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  scope: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", laundryOperations: { maxOutdoorDays: 3 }, laundryPortalVisibility: { requireDropoffPhoto: true } }) }));
vi.mock("@/lib/laundry/teams", () => ({ laundryTaskScope: m.scope }));
vi.mock("@/lib/db", () => ({
  db: {
    auditLog: m.audit,
    laundryTeamRequestReply: m.reply,
    laundryTask: m.task,
    user: m.user,
    $transaction: async (run: (tx: unknown) => unknown) => run({ laundryTeamRequestReply: m.reply, auditLog: m.audit }),
  },
}));

import { TeamReplyError, recordTeamRequestReply } from "@/lib/laundry/team-request-replies";
import { ANSWERS_BY_KIND, describeTeamReply, teamReplyProblem } from "@/lib/laundry/team-request-reply-rules";
import { listOfficeRequestsForLaundryUser } from "@/lib/laundry/office-requests";
import { teamRequestReceiptLines } from "@/lib/laundry/team-request-receipt";

const TODAY = "2026-11-12";
const tom = { id: "tom", role: Role.LAUNDRY, name: "Tom" };
const requestRow = { id: "req1", entityId: "task1", after: { kind: "TEAM_RETURN_ETA", recipientIds: ["tom"] } };
const storedReply = (patch: Record<string, unknown> = {}) => ({ id: "r1", laundryTaskId: "task1", requestAuditId: "req1", requestKind: "TEAM_RETURN_ETA", answer: "RETURN_AT", answerTime: "14:00", answerDate: new Date("2026-11-13T00:00:00Z"), note: null, repliedById: "tom", repliedByName: "Tom", idempotencyKey: "reply-key-0001", createdAt: new Date("2026-11-12T02:00:00Z"), ...patch });
const body = (patch: Record<string, unknown> = {}) => ({ answer: "RETURN_AT", date: "2026-11-13", time: "14:00", idempotencyKey: "reply-key-0001", ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  m.scope.mockResolvedValue({ propertyId: { in: ["p1"] } });
  m.audit.findFirst.mockResolvedValue(requestRow);
  m.reply.findUnique.mockResolvedValue(null);
  m.task.findFirst.mockResolvedValue({ id: "task1", supplierId: "l1" });
  m.user.findUnique.mockResolvedValue({ name: "Tom", laundrySupplierId: "l1", isActive: true });
  m.reply.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => storedReply({ ...data, id: "r1", createdAt: new Date("2026-11-12T02:00:00Z") }));
  m.audit.create.mockResolvedValue({});
});

describe("answers per request kind", () => {
  it("accepts only the answers a request can take, with the required details", () => {
    expect(ANSWERS_BY_KIND.TEAM_RETURN_ETA).toEqual(["RETURN_AT", "MESSAGE"]);
    expect(teamReplyProblem("TEAM_RETURN_ETA", { answer: "CONFIRMED" }, TODAY)).toMatch(/does not fit/);
    expect(teamReplyProblem("TEAM_RETURN_ETA", { answer: "RETURN_AT" }, TODAY)).toMatch(/which day/);
    expect(teamReplyProblem("TEAM_RETURN_ETA", { answer: "RETURN_AT", date: "2026-11-11" }, TODAY)).toMatch(/past/);
    expect(teamReplyProblem("TEAM_RETURN_ETA", { answer: "RETURN_AT", date: "2026-11-13", time: "25:00" }, TODAY)).toMatch(/HH:mm/);
    expect(teamReplyProblem("TEAM_RETURN_ETA", { answer: "RETURN_AT", date: "2026-11-13", time: "14:00" }, TODAY)).toBeNull();
    expect(teamReplyProblem("TEAM_CONFIRM_PICKUP", { answer: "CANNOT", note: "no" }, TODAY)).toMatch(/why not/);
    expect(teamReplyProblem("TEAM_MOVE_PICKUP", { answer: "CONFIRMED", time: "15:30" }, TODAY)).toBeNull();
    expect(teamReplyProblem("TEAM_PHOTO", { answer: "CONFIRMED" }, TODAY)).toMatch(/does not fit/);
  });

  it("describes a reply from stored values only", () => {
    expect(describeTeamReply({ answer: "RETURN_AT", date: "2026-11-13", time: "14:00", note: "Dryer broke" }, () => "Fri 13 Nov")).toBe("Back by Fri 13 Nov 14:00: Dryer broke");
    expect(describeTeamReply({ answer: "CONFIRMED", date: null, time: "15:30", note: null }, (k) => k)).toBe("Yes, 15:30");
  });
});

describe("recording a reply", () => {
  it("stores the answer and an audit row for an asked, in-scope team member", async () => {
    const result = await recordTeamRequestReply(tom, "req1", body(), new Date("2026-11-12T01:00:00Z"));
    expect(result.replayed).toBe(false);
    expect(result.reply).toMatchObject({ answer: "RETURN_AT", date: "2026-11-13", time: "14:00", byName: "Tom" });
    expect(m.reply.create.mock.calls[0][0].data).toMatchObject({ laundryTaskId: "task1", requestAuditId: "req1", requestKind: "TEAM_RETURN_ETA", answerDate: new Date("2026-11-13T00:00:00.000Z"), repliedById: "tom" });
    expect(m.task.findFirst).toHaveBeenCalledWith({ where: { propertyId: { in: ["p1"] }, id: "task1" }, select: { id: true, supplierId: true } });
    expect(m.audit.create.mock.calls[0][0].data).toMatchObject({ action: "LAUNDRY_TEAM_REQUEST_REPLIED", entity: "LaundryTask", entityId: "task1" });
  });

  it("replays the same key and refuses the same key for a different answer", async () => {
    m.reply.findUnique.mockResolvedValue(storedReply());
    await expect(recordTeamRequestReply(tom, "req1", body())).resolves.toMatchObject({ replayed: true });
    expect(m.reply.create).not.toHaveBeenCalled();
    await expect(recordTeamRequestReply(tom, "req1", body({ answer: "MESSAGE", note: "hello" }))).rejects.toMatchObject({ status: 409 });
  });

  it("lets the unique key decide a double tap", async () => {
    m.reply.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }));
    m.reply.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(storedReply());
    await expect(recordTeamRequestReply(tom, "req1", body())).resolves.toMatchObject({ replayed: true });
  });

  it("refuses office accounts, runs out of scope, other teams and wrong answers", async () => {
    await expect(recordTeamRequestReply({ id: "a", role: Role.ADMIN }, "req1", body())).rejects.toMatchObject({ status: 403 });
    m.task.findFirst.mockResolvedValueOnce(null);
    await expect(recordTeamRequestReply(tom, "req1", body())).rejects.toMatchObject({ status: 404 });
    m.user.findUnique.mockResolvedValueOnce({ name: "Ana", laundrySupplierId: "other", isActive: true });
    await expect(recordTeamRequestReply({ id: "ana", role: Role.LAUNDRY }, "req1", body())).rejects.toMatchObject({ status: 403, message: "This request was for another laundry team." });
    await expect(recordTeamRequestReply(tom, "req1", body({ answer: "CONFIRMED" }))).rejects.toBeInstanceOf(TeamReplyError);
    m.audit.findFirst.mockResolvedValueOnce(null);
    await expect(recordTeamRequestReply(tom, "missing", body())).rejects.toMatchObject({ status: 404 });
  });

  it("accepts a current team member who was not among the recipients", async () => {
    m.user.findUnique.mockResolvedValueOnce({ name: "Mia", laundrySupplierId: "l1", isActive: true });
    await expect(recordTeamRequestReply({ id: "mia", role: Role.LAUNDRY }, "req1", body({ idempotencyKey: "reply-key-0002" }))).resolves.toMatchObject({ replayed: false });
  });
});

describe("the From the office inbox", () => {
  const taskRow = (patch: Record<string, unknown> = {}) => ({ id: "task1", jobId: "j1", status: "PICKED_UP", pickupDate: new Date("2026-11-09T00:00:00Z"), dropoffDate: new Date("2026-11-11T00:00:00Z"), pickedUpAt: new Date("2026-11-09T01:00:00Z"), flagReason: null, pickupTime: null, dropoffTime: "09:00", supplier: { avgTurnaround: 48 }, property: { name: "Glebe House", suburb: "Glebe" }, job: { status: "COMPLETED" }, confirmations: [], ...patch });

  it("is open while the run calls for it, answered after a settling reply, done when the run moved on", async () => {
    const now = new Date("2026-11-12T01:00:00Z");
    m.audit.findMany.mockResolvedValue([
      { id: "req2", entityId: "task1", createdAt: new Date("2026-11-12T00:30:00Z"), after: { kind: "TEAM_RETURN_ETA", recipientIds: ["tom"] } },
      { id: "req1", entityId: "task1", createdAt: new Date("2026-11-11T23:00:00Z"), after: { kind: "TEAM_RETURN_ETA", recipientIds: ["tom"], note: "Guest Fri" } },
      { id: "req0", entityId: "task2", createdAt: new Date("2026-11-11T22:00:00Z"), after: { kind: "TEAM_CONFIRM_PICKUP", recipientIds: ["tom"], proposedTime: "15:30" } },
    ]);
    m.task.findMany.mockResolvedValue([taskRow(), taskRow({ id: "task2", status: "DROPPED" })]);
    m.reply.findMany.mockResolvedValue([storedReply({ requestAuditId: "req1" })]);
    const list = await listOfficeRequestsForLaundryUser(tom, now);
    expect(list.map((request) => [request.id, request.state, request.reminderNumber])).toEqual([["req2", "open", 2], ["req1", "answered", 1], ["req0", "done", 1]]);
    expect(list[0]).toMatchObject({ badge: "Chase", title: "Glebe House set, when back?", stopKind: "DROP", plannedTime: "09:00", answers: ["RETURN_AT", "MESSAGE"] });
    expect(list[1].replies[0]).toMatchObject({ answer: "RETURN_AT", date: "2026-11-13" });
    expect(m.task.findMany.mock.calls[0][0].where).toMatchObject({ propertyId: { in: ["p1"] }, id: { in: ["task1", "task2"] } });
  });

  it("returns nothing for office accounts", async () => {
    await expect(listOfficeRequestsForLaundryUser({ id: "a", role: Role.ADMIN })).resolves.toEqual([]);
    expect(m.audit.findMany).not.toHaveBeenCalled();
  });
});

describe("the receipt after sending", () => {
  it("counts each person once per transport group and names who was not reached and why", () => {
    expect(teamRequestReceiptLines([
      { userId: "t", name: "Tom", transport: "INBOX", state: "inbox_available" },
      { userId: "m", name: "Mia", transport: "INBOX", state: "inbox_available" },
      { userId: "t", name: "Tom", transport: "MOBILE_PUSH", state: "requested" },
      { userId: "t", name: "Tom", transport: "WEB_PUSH", state: "requested" },
      { userId: "d", name: "Dev", transport: "MOBILE_PUSH", state: "skipped", errorCode: "NO_DEVICE" },
      { userId: "d", name: "Dev", transport: "INBOX", state: "inbox_available" },
    ])).toEqual(["Inbox: in the inbox of 3", "Push: sent to 1 · Dev: no device"]);
  });
});
