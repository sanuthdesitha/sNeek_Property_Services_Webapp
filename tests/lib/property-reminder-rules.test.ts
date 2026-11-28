// @vitest-environment node
/** Automatic reminder rules (item 9, slice B): off by default, deterministic, facts stated, preview numbers. */
import { describe, expect, it } from "vitest";
import {
  allRulesOff,
  cleanerRepeatReminders,
  describePreview,
  deviceChargingReminders,
  enabledRules,
  issueRoomReminders,
  openMaintenanceReminders,
  parseRuleState,
  previewOf,
  repeatIssueRoomReminders,
  stockNotDeliveredReminders,
  type IssueFact,
  type RuleContext,
} from "@/lib/properties/reminders/rules";
import { reminderApplies } from "@/lib/properties/reminders/model";

const now = new Date("2026-11-28T00:00:00Z");
const context: RuleContext = { now, formatDay: (value) => value.toISOString().slice(0, 10), categoryLabel: (key) => ({ kitchen_reset: "Kitchen reset", dusting: "Dusting" })[key] ?? key };
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
const issue = (id: string, extra: Partial<IssueFact> = {}): IssueFact => ({ id, propertyId: "p1", cleanerId: "c1", category: "kitchen_reset", createdAt: day(-5), updatedAt: day(-5), open: true, ...extra });

describe("rule switches", () => {
  it("every rule is off by default; an unreadable value is all off; one bad rule is off on its own", () => {
    expect(enabledRules(parseRuleState(null))).toEqual([]);
    expect(enabledRules(parseRuleState("garbage"))).toEqual([]);
    expect(parseRuleState("garbage").readable).toBe(false);
    expect(enabledRules(parseRuleState({ "device-charging": { enabled: true }, "issue-room": { enabled: "yes" } }))).toEqual(["device-charging"]);
    expect(enabledRules({ ...allRulesOff(false), rules: { ...allRulesOff(true).rules, "issue-room": { enabled: true, changedAt: null, changedById: null } } })).toEqual([]);
  });
});

describe("facts → reminders (deterministic, every reminder states its facts)", () => {
  it("device needs charging: before start with the battery and reading day; not on the job carrying its charge task", () => {
    const [entry] = deviceChargingReminders([{ id: "d1", propertyId: "p1", name: "Front door", kindLabel: "Ring camera", lastBatteryPercent: 12, lastReadingAt: day(-1), conditionOpenedAt: day(-1), chargeTaskJobId: "job-9" }], context);
    expect(entry.candidate).toMatchObject({ key: "rule:device-charging:d1", moment: "BEFORE_START", why: "Device needs charging: battery 12% (reading 2026-11-27)." });
    expect(reminderApplies(entry.candidate, { jobId: "job-9", userId: "c1", todayKey: "2026-11-28" })).toBe(false);
    expect(reminderApplies(entry.candidate, { jobId: "job-1", userId: "c1", todayKey: "2026-11-28" })).toBe(true);
    const unknown = deviceChargingReminders([{ id: "d2", propertyId: "p1", name: "Sensor", kindLabel: "Minut", lastBatteryPercent: null, lastReadingAt: null, conditionOpenedAt: null, chargeTaskJobId: null }], context)[0];
    expect(unknown.candidate.why).toBe("Device needs charging: battery not known.");
  });

  it("open issue → its room every job; closed within 14 days → next job; older or roomless → none", () => {
    const out = issueRoomReminders([issue("open"), issue("closed", { open: false, updatedAt: day(-3) }), issue("old", { open: false, updatedAt: day(-20) }), issue("dust", { category: "dusting" })], context);
    expect(out.map((entry) => [entry.candidate.key, entry.candidate.roomKey, entry.candidate.lifetime, entry.candidate.jobsCount])).toEqual([
      ["rule:issue-room:open", "kitchen", "EVERY_JOB", null],
      ["rule:issue-room:closed", "kitchen", "NEXT_JOBS", 1],
    ]);
    expect(out[0].candidate.why).toContain("is still open");
  });

  it("repeat at a property: 2+ in 60 days, shown until 30 days pass with no new one", () => {
    const pair = [issue("a", { createdAt: day(-10) }), issue("b", { createdAt: day(-40) })];
    const [entry] = repeatIssueRoomReminders(pair, context);
    expect(entry.candidate).toMatchObject({ moment: "ROOM", roomKey: "kitchen", lifetime: "EVERY_JOB", rank: 4 });
    expect(entry.candidate.why).toBe('QA issue "Kitchen reset" raised 2 times here in 60 days (2026-10-19, 2026-11-18).');
    expect(repeatIssueRoomReminders([issue("a", { createdAt: day(-31) }), issue("b", { createdAt: day(-40) })], context)).toEqual([]);
    expect(repeatIssueRoomReminders([issue("a", { createdAt: day(-10) }), issue("b", { createdAt: day(-80) })], context)).toEqual([]);
  });

  it("same cleaner, same category at 2+ properties → that cleaner's next 3 jobs, anywhere", () => {
    const [entry] = cleanerRepeatReminders([issue("a", { propertyId: "p1" }), issue("b", { propertyId: "p2", createdAt: day(-7) })], context);
    expect(entry.propertyId).toBeNull();
    expect(entry.candidate).toMatchObject({ cleanerId: "c1", lifetime: "NEXT_JOBS", jobsCount: 3, moment: "ROOM" });
    expect(reminderApplies(entry.candidate, { jobId: "j", userId: "c2", todayKey: "2026-11-28" })).toBe(false);
    expect(cleanerRepeatReminders([issue("a"), issue("b")], context)).toEqual([]);
  });

  it("stock reported and not delivered → before leaving; delivered or confirmed → none; a missing count is said", () => {
    const out = stockNotDeliveredReminders([
      { id: "s1", propertyId: "p1", itemName: "Toilet paper", stage: "ORDERED", observedCount: null, unit: "rolls", createdAt: day(-2) },
      { id: "s2", propertyId: "p1", itemName: "Soap", stage: "DELIVERED", observedCount: 0, unit: "bottles", createdAt: day(-2) },
    ], context);
    expect(out).toHaveLength(1);
    expect(out[0].candidate).toMatchObject({ moment: "BEFORE_LEAVING" });
    expect(out[0].candidate.why).toContain("count not recorded");
  });

  it("open maintenance → before-start note; resolved → none", () => {
    const out = openMaintenanceReminders([
      { id: "m1", propertyId: "p1", title: "Oven door hinge loose", area: "Kitchen", priority: "HIGH", status: "IN_PROGRESS", createdAt: day(-4) },
      { id: "m2", propertyId: "p1", title: "Tap", area: null, priority: "LOW", status: "RESOLVED", createdAt: day(-4) },
    ], context);
    expect(out.map((entry) => entry.candidate.text)).toEqual(["Open maintenance: Oven door hinge loose (Kitchen). Work around it and report anything new."]);
    expect(out[0].candidate.rank).toBe(3);
  });

  it("the same facts give the same keys (no randomness)", () => {
    const facts = [issue("open")];
    expect(issueRoomReminders(facts, context)).toEqual(issueRoomReminders(facts, context));
  });
});

describe("preview", () => {
  it("counts reminders, properties and cleaners for one rule", () => {
    const reminders = [
      ...issueRoomReminders([issue("x1", { propertyId: "p1" }), issue("x2", { propertyId: "p2" }), issue("x3", { propertyId: "p2" })], context),
      ...cleanerRepeatReminders([issue("a", { propertyId: "p1" }), issue("b", { propertyId: "p2" })], context),
    ];
    const preview = previewOf("issue-room", reminders);
    expect(preview).toMatchObject({ reminders: 3, properties: 2, cleaners: 0 });
    expect(describePreview(preview)).toBe("Would currently create 3 reminders at 2 properties");
    expect(describePreview(previewOf("cleaner-repeat", reminders))).toBe("Would currently create 1 reminder for 1 cleaner");
  });
});
