// @vitest-environment node
/**
 * Deep-clean scheduling (board "Deep clean", 2026-11-16): the queue reads the
 * plan the rule wrote without changing the rule; the due reminder is one
 * inbox notice to administrators per proposal; only an administrator verifies
 * or chooses the day.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { receipts, send, plans, session } = vi.hoisted(() => ({
  receipts: new Set<string>(),
  send: vi.fn(async (_input: unknown) => [{ userId: "a1", name: "Admin", transport: "INBOX", path: "pipeline", state: "inbox_available" }]),
  plans: { value: [] as unknown[] },
  session: { role: "ADMIN" as string },
}));

vi.mock("@/lib/db", () => ({
  db: {
    appSetting: {
      create: vi.fn(async ({ data }: { data: { key: string } }) => {
        if (receipts.has(data.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        receipts.add(data.key);
        return {};
      }),
      update: vi.fn(async () => ({})),
    },
    user: { findMany: vi.fn(async () => [{ id: "a1", role: "ADMIN", name: "Admin", email: "admin@example.com" }]) },
    property: { findMany: vi.fn(async () => [{ id: "p1", name: "Coogee Terrace" }]) },
  },
}));
vi.mock("@/lib/properties/deep-clean-planning", () => ({
  listStoredDeepCleanPlans: vi.fn(async () => plans.value),
  DeepCleanPlanningError: class extends Error {},
  readDeepCleanPlan: vi.fn(),
  scheduleDeepCleanProposal: vi.fn(async () => ({ jobId: "j1" })),
  verifyDeepCleanBaseline: vi.fn(),
}));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: vi.fn(async () => ({ disabledTransports: {} })) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async (roles: string[]) => {
    if (!roles.includes(session.role)) throw new Error("FORBIDDEN");
    return { user: { id: "u1", role: session.role, heldRoles: [session.role] } };
  }),
}));

import { dueBand, dueWords, queueStateFor, queueTiles, sortQueue, type PlanSnapshot, type QueueRow } from "@/lib/properties/deep-clean-queue-model";
import { DEEP_CLEAN_DUE_TRANSPORTS, remindDueDeepCleanProposals } from "@/lib/properties/deep-clean-reminder";
import { catalogEntry } from "@/lib/notifications/catalog";
import { DEEP_CLEAN_CADENCE_MONTHS } from "@/lib/scheduling-rules/constants";

const baseline = { jobId: "j0", completedDay: "2026-08-09", dueDay: "2026-11-09", verifiedBy: "u1", verifiedAt: "2026-08-10T00:00:00.000Z" };
function plan(proposal: PlanSnapshot["proposal"], base: PlanSnapshot["baseline"] = baseline): PlanSnapshot {
  return { revision: 2, baseline: base, proposal, history: [] };
}
const proposal = (status: NonNullable<PlanSnapshot["proposal"]>["status"]) => ({ id: "p1:j0", status, dueDay: "2026-11-09", jobId: status === "SCHEDULED" ? "j9" : null, scheduledDay: status === "SCHEDULED" ? "2026-11-26" : null, scheduledBy: null, createdAt: "2026-11-09T00:00:00.000Z" });

beforeEach(() => {
  receipts.clear();
  send.mockClear();
  session.role = "ADMIN";
});

describe("queue rows from the stored plan (rule unchanged)", () => {
  it("maps plan states to queue states", () => {
    const today = "2026-11-14";
    expect(queueStateFor(plan(proposal("NEEDS_SCHEDULING")), true, today)).toBe("needs_date");
    expect(queueStateFor(plan(proposal("NEEDS_SCHEDULING")), false, today)).toBe("evidence_changed");
    expect(queueStateFor(plan(proposal("SCHEDULED")), true, today)).toBe("draft_created");
    expect(queueStateFor(plan(null, { ...baseline, dueDay: "2026-12-07" }), true, today)).toBe("due_later");
    expect(queueStateFor(plan(null), true, today)).toBe("awaiting_check");
    expect(queueStateFor(plan(null, null), false, today)).toBeNull();
    expect(queueStateFor(null, false, today)).toBe("needs_review");
  });

  it("bands overdue and due-today rows and writes the reason", () => {
    expect(dueBand("needs_date", "2026-11-09", "2026-11-14")).toBe("overdue");
    expect(dueBand("needs_date", "2026-11-14", "2026-11-14")).toBe("today");
    expect(dueBand("due_later", "2026-12-07", "2026-11-14")).toBeNull();
    expect(dueWords("2026-11-09", "2026-11-14")).toBe("Due 5 days ago");
    expect(dueWords("2026-11-14", "2026-11-14")).toBe("Due today");
  });

  it("sorts rows that need someone first, oldest due first, and counts the tiles", () => {
    const row = (propertyId: string, state: QueueRow["state"], dueDay: string, assigned: boolean | null = null): QueueRow => ({
      propertyId, propertyName: propertyId, clientName: null, suburb: "", bedrooms: null, state, dueDay, revision: 1, baseline: null,
      proposal: state === "draft_created" ? { id: "x", status: "SCHEDULED", scheduledDay: "2026-11-26", jobId: "j", jobNumber: "J-1", assigned } : null, changeReason: null,
    });
    const rows = sortQueue([row("later", "due_later", "2026-12-07"), row("draft", "draft_created", "2026-11-03", false), row("b", "needs_date", "2026-11-14"), row("a", "needs_date", "2026-11-09"), row("glebe", "evidence_changed", "2026-11-05")]);
    expect(rows.map((entry) => entry.propertyId)).toEqual(["glebe", "a", "b", "draft", "later"]);
    expect(queueTiles(rows, 9)).toEqual({ needsDate: 2, oldestDue: "2026-11-09", evidenceChanged: 1, dueLater: 1, nextDue: "2026-12-07", draftCreated: 1, draftUnassigned: 1, noBaseline: 9 });
  });

  it("keeps three months and leaves the rule files untouched by the queue", () => {
    expect(DEEP_CLEAN_CADENCE_MONTHS).toBe(3);
    const queue = readFileSync("lib/properties/deep-clean-queue.ts", "utf8");
    expect(queue).not.toMatch(/appSetting\.(upsert|update|create)|\$transaction/);
  });
});

describe("due reminder", () => {
  it("is one inbox notice to administrators per proposal, never email, SMS or push", async () => {
    plans.value = [{ propertyId: "p1", invalid: false, plan: { ...plan(proposal("NEEDS_SCHEDULING")), propertyId: "p1", version: 1 } }];
    const now = new Date("2026-11-14T00:00:00.000Z");
    const first = await remindDueDeepCleanProposals({ now });
    const second = await remindDueDeepCleanProposals({ now });
    expect(first).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(second).toEqual({ due: 1, sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0] as { transports: string[]; eventId: string; recipients: Array<{ role: string }>; subject: string; url: string };
    expect(input.transports).toEqual(["INBOX"]);
    expect(DEEP_CLEAN_DUE_TRANSPORTS).toEqual(["INBOX"]);
    expect(input.eventId).toBe("deep-clean-due:p1:j0");
    expect(input.recipients.every((recipient) => recipient.role === "ADMIN")).toBe(true);
    expect(input.subject).toBe("Deep clean due: Coogee Terrace");
    expect(input.url).toBe("/v2/admin/deep-clean-planning?property=p1");
  });

  it("does not remind about a proposal that is scheduled, deferred or not yet due", async () => {
    plans.value = [
      { propertyId: "p1", invalid: false, plan: { ...plan(proposal("SCHEDULED")), propertyId: "p1", version: 1 } },
      { propertyId: "p1", invalid: false, plan: { ...plan({ ...proposal("NEEDS_SCHEDULING"), dueDay: "2026-12-01" }), propertyId: "p1", version: 1 } },
    ];
    expect(await remindDueDeepCleanProposals({ now: new Date("2026-11-14T00:00:00.000Z") })).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("has a catalog entry: inbox only, pipeline, with its wording", async () => {
    expect(catalogEntry("property.deep_clean_due")).toMatchObject({ transports: ["INBOX"], defaultTransports: ["INBOX"], path: "PIPELINE", producers: ["lib/properties/deep-clean-reminder.ts"] });
    const { OFFICE_WORDING } = await import("@/lib/notifications/wording/definitions/office");
    expect(OFFICE_WORDING.some((definition) => definition.typeKey === "property.deep_clean_due")).toBe(true);
  });

  it("the daily check sends the reminders after planning", () => {
    const boss = readFileSync("workers/boss.ts", "utf8");
    const handler = boss.slice(boss.indexOf('jobEnabled("deep-clean-planning")'), boss.indexOf('jobEnabled("daily-invoice-generation")'));
    expect(handler).toContain("planDueDeepCleanDrafts");
    expect(handler).toContain("remindDueDeepCleanProposals");
  });
});

describe("only an administrator verifies or chooses the day", () => {
  it("refuses an operations manager on the planning POST and lets them read the queue", async () => {
    session.role = "OPS_MANAGER";
    const planning = await import("@/app/api/admin/properties/[id]/deep-clean-planning/route");
    const request = new Request("http://x", { method: "POST", body: JSON.stringify({ action: "schedule", proposalId: "p1:j0", revision: 2, date: "2026-11-24" }) });
    const response = await planning.POST(request as never, { params: { id: "p1" } });
    expect(response.status).toBe(403);
    session.role = "ADMIN";
    const ok = await planning.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action: "schedule", proposalId: "p1:j0", revision: 2, date: "2026-11-24" }) }) as never, { params: { id: "p1" } });
    expect(ok.status).toBe(200);
  });

  it("the queue route reads for both roles and says only an administrator manages", async () => {
    vi.doMock("@/lib/properties/deep-clean-queue", () => ({ buildDeepCleanQueue: vi.fn(async (canManage: boolean) => ({ canManage, rows: [] })) }));
    const queue = await import("@/app/api/admin/deep-clean-planning/queue/route");
    session.role = "OPS_MANAGER";
    expect(await (await queue.GET()).json()).toMatchObject({ canManage: false });
    session.role = "ADMIN";
    expect(await (await queue.GET()).json()).toMatchObject({ canManage: true });
    session.role = "CLEANER";
    expect((await queue.GET()).status).toBe(403);
  });
});
