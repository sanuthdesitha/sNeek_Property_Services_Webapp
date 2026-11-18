// @vitest-environment node
/**
 * Client-handled maintenance (2026-11-18): the pure rules. Hand-over refusals
 * (not client-visible, our worker or roster active, money pending or agreed),
 * the manual reminder gap, which client actions each state allows, the words
 * for each delivery outcome (queued is never "delivered"), the tradesperson
 * form, the visit plan written for the cleaner, and attention: an item with
 * the client is not "nobody assigned".
 */
import { describe, expect, it } from "vitest";
import {
  REMINDER_MIN_GAP_MS,
  clientActionDecision,
  clientHandlingPill,
  describeDeliveryOutcome,
  handoverBlockers,
  reminderDecision,
  type HandoverInput,
} from "@/lib/maintenance/client-handling-rules";
import { parseClientTradesperson, plannedWindowChanged, validateTradespersonInput, visitPlanFromTradesperson } from "@/lib/maintenance/client-tradesperson";
import { isNobodyAssigned, maintenanceAttention } from "@/lib/maintenance/attention";
import { describeVisitForCleaner, visitIsOnDay } from "@/lib/maintenance/visit-plan";
import { CLIENT_HIDDEN_ITEM_KEYS, stripForClient } from "@/lib/maintenance/client-payload";

const base: HandoverInput = {
  status: "OPEN",
  clientVisible: true,
  state: "NONE",
  hasClient: true,
  portalPeople: 1,
  assignedWorkerName: null,
  activeRoster: [],
  costApprovalStatus: null,
  quotedCost: null,
};

describe("hand-over refusals", () => {
  it("allows a plain open, client-visible item with a client login", () => {
    expect(handoverBlockers(base)).toEqual([]);
  });
  it("refuses a hidden item, a closed item, no client and no login", () => {
    expect(handoverBlockers({ ...base, clientVisible: false }).join(" ")).toMatch(/hidden from the client/);
    expect(handoverBlockers({ ...base, status: "RESOLVED" }).join(" ")).toMatch(/closed/);
    expect(handoverBlockers({ ...base, hasClient: false }).join(" ")).toMatch(/no client/);
    expect(handoverBlockers({ ...base, portalPeople: 0 }).join(" ")).toMatch(/no active portal login/);
  });
  it("refuses while our own visit worker or roster is active (removed first, never implicitly)", () => {
    expect(handoverBlockers({ ...base, assignedWorkerName: "Pat Plumber" }).join(" ")).toMatch(/Pat Plumber is on it\. Remove them first/);
    expect(handoverBlockers({ ...base, activeRoster: [{ role: "CLEANER", name: "Jane" }] }).join(" ")).toMatch(/Jane is assigned/);
  });
  it("refuses while our price waits for the client or after they approved it; a declined price may be handed over", () => {
    expect(handoverBlockers({ ...base, costApprovalStatus: "PENDING", quotedCost: 240 }).join(" ")).toMatch(/\$240\.00 is waiting/);
    expect(handoverBlockers({ ...base, costApprovalStatus: "APPROVED", quotedCost: 99.5 }).join(" ")).toMatch(/approved our price of \$99\.50/);
    expect(handoverBlockers({ ...base, costApprovalStatus: "DECLINED", quotedCost: 99.5 })).toEqual([]);
  });
  it("refuses when already with the client or done, and allows another round after a decline or take-back", () => {
    expect(handoverBlockers({ ...base, state: "HANDED_OVER" }).join(" ")).toMatch(/already with the client/);
    expect(handoverBlockers({ ...base, state: "DONE" }).join(" ")).toMatch(/already marked it done/);
    for (const state of ["DECLINED", "NOT_DONE", "TAKEN_BACK"] as const) expect(handoverBlockers({ ...base, state })).toEqual([]);
  });
});

describe("manual reminder gap", () => {
  const now = new Date("2026-11-18T03:00:00Z");
  const fmt = (date: Date) => date.toISOString().slice(11, 16);
  const input = { state: "ACCEPTED" as const, status: "OPEN", lastReminderAt: null, lastReminderTaken: null, notificationsOff: false, recipients: 1, now };

  it("allows the first reminder", () => {
    expect(reminderDecision(input, fmt)).toEqual({ blocker: null, nextAllowedAt: null });
  });
  it("refuses a second within the gap, saying when the next may go", () => {
    const last = new Date(now.getTime() - 60_000);
    const decision = reminderDecision({ ...input, lastReminderAt: last, lastReminderTaken: true }, fmt);
    expect(decision.blocker).toMatch(/A reminder was sent at 02:59\. The next one can be sent from 06:59/);
    expect(decision.nextAllowedAt?.getTime()).toBe(last.getTime() + REMINDER_MIN_GAP_MS);
  });
  it("treats a reminder still sending as taken (a double click cannot slip in)", () => {
    expect(reminderDecision({ ...input, lastReminderAt: now, lastReminderTaken: null }, fmt).blocker).not.toBeNull();
  });
  it("does not start the gap when the last reminder reached nothing", () => {
    expect(reminderDecision({ ...input, lastReminderAt: now, lastReminderTaken: false }, fmt).blocker).toBeNull();
  });
  it("allows again after the gap", () => {
    expect(reminderDecision({ ...input, lastReminderAt: new Date(now.getTime() - REMINDER_MIN_GAP_MS - 1), lastReminderTaken: true }, fmt).blocker).toBeNull();
  });
  it("refuses when notifications are off, there is no login, or the item is not with the client", () => {
    expect(reminderDecision({ ...input, notificationsOff: true }, fmt).blocker).toMatch(/switched off notifications/);
    expect(reminderDecision({ ...input, recipients: 0 }, fmt).blocker).toMatch(/no active portal login/);
    expect(reminderDecision({ ...input, state: "TAKEN_BACK" }, fmt).blocker).toMatch(/not with the client/);
    expect(reminderDecision({ ...input, status: "RESOLVED" }, fmt).blocker).toMatch(/closed/);
  });
});

describe("client actions per state", () => {
  it("accept is idempotent; done needs acceptance first", () => {
    expect(clientActionDecision("ACCEPT", "HANDED_OVER", "OPEN")).toEqual({ allowed: true, unchanged: false });
    expect(clientActionDecision("ACCEPT", "ACCEPTED", "OPEN")).toEqual({ allowed: true, unchanged: true });
    expect(clientActionDecision("MARK_DONE", "HANDED_OVER", "OPEN")).toMatchObject({ allowed: false, reason: expect.stringMatching(/Accept the item first/) });
    expect(clientActionDecision("SET_TRADESPERSON", "HANDED_OVER", "OPEN")).toEqual({ allowed: true, unchanged: false });
  });
  it("refuses after the office took it back or closed it", () => {
    expect(clientActionDecision("MARK_DONE", "TAKEN_BACK", "OPEN")).toMatchObject({ allowed: false, reason: expect.stringMatching(/taken this item back/) });
    expect(clientActionDecision("SET_TRADESPERSON", "ACCEPTED", "DISMISSED")).toMatchObject({ allowed: false, reason: expect.stringMatching(/closed/) });
    expect(clientActionDecision("MARK_DONE", "DONE", "RESOLVED")).toEqual({ allowed: true, unchanged: true });
  });
});

describe("delivery outcome words", () => {
  it("never calls queued or an inbox row delivered, and names holds and failures", () => {
    expect(describeDeliveryOutcome("queued", null)).toEqual({ tone: "sent", label: "Queued, not sent yet" });
    expect(describeDeliveryOutcome("inbox_available", null).label).toBe("In their portal inbox");
    expect(describeDeliveryOutcome("provider_accepted", null).label).toMatch(/not proof it was read/);
    expect(describeDeliveryOutcome("skipped", "safeguard_quiet_hours")).toEqual({ tone: "held", label: "Held by the sending safeguards (quiet hours)" });
    expect(describeDeliveryOutcome("skipped", "recipient_preference").tone).toBe("held");
    expect(describeDeliveryOutcome("failed", "email_rejected")).toMatchObject({ tone: "failed" });
    expect(describeDeliveryOutcome("switched_off", null).tone).toBe("held");
    expect(describeDeliveryOutcome("uncertain", "provider_outcome_unknown").tone).toBe("failed");
  });
});

describe("the client's tradesperson", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const tz = "Australia/Sydney";
  it("needs a name; phone characters are checked; a date needs a start time", () => {
    expect(validateTradespersonInput({ name: " " }, tz, now)).toEqual({ ok: false, error: "Enter the tradesperson's name." });
    expect(validateTradespersonInput({ name: "Al", phone: "call me" }, tz, now)).toMatchObject({ ok: false });
    expect(validateTradespersonInput({ name: "Al", plannedDate: "2026-11-20" }, tz, now)).toMatchObject({ ok: false, error: expect.stringMatching(/time they are expected/) });
    expect(validateTradespersonInput({ name: "Al", startTime: "09:00" }, tz, now)).toMatchObject({ ok: false });
    expect(validateTradespersonInput({ name: "Al", plannedDate: "2026-11-20", startTime: "10:00", endTime: "09:00" }, tz, now)).toMatchObject({ ok: false, error: expect.stringMatching(/after the start/) });
    expect(validateTradespersonInput({ name: "Al", plannedDate: "2026-02-31", startTime: "10:00" }, tz, now)).toMatchObject({ ok: false });
    expect(validateTradespersonInput({ name: "Al", plannedDate: "2026-11-01", startTime: "10:00" }, tz, now)).toMatchObject({ ok: false, error: expect.stringMatching(/in the past/) });
  });
  it("reads the times in the organisation timezone and keeps the calendar day", () => {
    const result = validateTradespersonInput({ name: "Al Sparks", phone: "0400 000 000", trade: "Electrician", plannedDate: "2026-11-20", startTime: "09:30", endTime: "11:00", accessMethod: "CONTRACTOR_HAS_KEY" }, tz, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plannedStart).toBe("2026-11-19T22:30:00.000Z");
    expect(result.value.plannedEnd).toBe("2026-11-20T00:00:00.000Z");
    const plan = visitPlanFromTradesperson(result.value, "Bathroom");
    expect(plan).not.toBeNull();
    expect(plan).not.toHaveProperty("cost");
    expect(visitIsOnDay(plan!, new Date("2026-11-20T01:00:00Z"))).toBe(true);
    const briefing = describeVisitForCleaner(plan!, "Light switch");
    expect(briefing.lines.join(" | ")).toMatch(/Expected between 9:30 am and 11:00 am/);
    expect(briefing.lines.join(" | ")).toMatch(/Contractor: Al Sparks · 0400 000 000/);
    expect(briefing.lines.join(" | ")).toMatch(/They have their own key/);
  });
  it("round-trips the stored blob and notices date changes", () => {
    const stored = parseClientTradesperson({ name: "Al", plannedStart: "2026-11-19T22:30:00.000Z", visitPublished: true, accessMethod: "LOCKBOX", cost: 99 });
    expect(stored).toEqual({ name: "Al", plannedStart: "2026-11-19T22:30:00.000Z", accessMethod: "LOCKBOX", visitPublished: true });
    expect(parseClientTradesperson({ phone: "1" })).toBeNull();
    expect(plannedWindowChanged(stored, { ...stored!, plannedStart: undefined })).toBe(true);
    expect(plannedWindowChanged(stored, stored)).toBe(false);
  });
});

describe("attention and nobody-assigned", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const old = new Date("2026-11-01T00:00:00Z");
  const item = { assignedWorkerId: null, activeRosterCount: 0, status: "OPEN", priority: "URGENT", costApprovalStatus: null, pricePending: false, createdAt: old };
  it("an item with the client is attended and needs nobody in the office", () => {
    expect(isNobodyAssigned({ ...item, clientHandling: "ACCEPTED" })).toBe(false);
    expect(maintenanceAttention({ ...item, clientHandling: "HANDED_OVER" }, now)).toBeNull();
    expect(clientHandlingPill("HANDED_OVER")).toBe("With the client");
  });
  it("a declined or not-done item is back with the office and says so", () => {
    expect(maintenanceAttention({ ...item, priority: "MEDIUM", clientHandling: "DECLINED" }, now)).toEqual({ tone: "attention", reason: "Client declined to arrange it" });
    expect(maintenanceAttention({ ...item, priority: "MEDIUM", clientHandling: "NOT_DONE" }, now)).toEqual({ tone: "attention", reason: "Client could not get it done" });
    expect(maintenanceAttention({ ...item, clientHandling: "TAKEN_BACK" }, now)).toEqual({ tone: "problem", reason: "Nobody assigned" });
  });
});

describe("client payload stripping on the shared routes", () => {
  it("removes our cost, worker instructions and the office's hand-over records", () => {
    const item = Object.fromEntries([...CLIENT_HIDDEN_ITEM_KEYS.map((key) => [key, "x"]), ["title", "Tap"], ["clientHandling", "ACCEPTED"]]);
    const stripped = stripForClient(item);
    for (const key of CLIENT_HIDDEN_ITEM_KEYS) expect(stripped).not.toHaveProperty(key);
    expect(stripped).toMatchObject({ title: "Tap", clientHandling: "ACCEPTED" });
  });
});
