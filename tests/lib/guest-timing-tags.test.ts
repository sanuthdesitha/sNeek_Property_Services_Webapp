/**
 * Guest timing (late checkout / early check-in) on office screens and the
 * cleaner's acknowledgement of it: one derivation, worded tags, unreadable
 * times stated in words, and an acknowledgement that does not survive a
 * changed time.
 */
import { describe, expect, it } from "vitest";
import { serializeJobInternalNotes, parseJobInternalNotes } from "@/lib/jobs/meta";
import { resolveTimingBadges } from "@/lib/jobs/timing-badges";
import { timingRuleTagsFor, timingTagsFor, timingTagsSentence } from "@/lib/jobs/timing-tags";
import {
  buildStartBriefingAck,
  checkIncomingAckVersion,
  resolveStartBriefingItems,
  startBriefingHash,
  startBriefingTimingHash,
  validateStartBriefingAck,
} from "@/lib/forms/start-briefing";
import { buildTimingAckSummary, ownTimingAckStatus, timingAckSentence } from "@/lib/jobs/job-page/timing-ack";
import { buildTodayByCleaner } from "@/lib/dashboard/today-by-cleaner";
import type { LiveJobRow } from "@/lib/ops/live-board-types";

type RuleInput = { enabled: boolean; preset: "11:00" | "12:30" | "custom" | "none"; time?: string };

function notes(rules: { late?: RuleInput; early?: RuleInput; note?: string }) {
  return serializeJobInternalNotes({
    ...(rules.late ? { lateCheckout: rules.late as never } : {}),
    ...(rules.early ? { earlyCheckin: rules.early as never } : {}),
    ...(rules.note ? { internalNoteText: rules.note } : {}),
  });
}

const LATE_11 = { enabled: true, preset: "11:00" } as const;
const EARLY_13 = { enabled: true, preset: "custom", time: "13:00" } as const;

describe("timing tags (one derivation, worded)", () => {
  it("says the instruction in words, late checkout first", () => {
    const tags = timingTagsFor({ timingBadges: resolveTimingBadges(notes({ late: LATE_11, early: EARLY_13 })) });
    expect(tags.map((tag) => tag.label)).toEqual(["Late checkout · start after 11:00", "Early check-in · ready by 13:00"]);
    expect(tags.map((tag) => tag.tone)).toEqual(["danger", "warning"]);
    expect(timingTagsSentence(tags)).toBe("Late checkout · start after 11:00; Early check-in · ready by 13:00");
  });

  it("shows nothing for a job without rules", () => {
    expect(resolveTimingBadges(notes({}))).toBeNull();
    expect(timingTagsFor({ timingBadges: null })).toEqual([]);
  });

  it("states an enabled rule whose stored time cannot be read, never drops or replaces it", () => {
    const badges = resolveTimingBadges(notes({ late: { enabled: true, preset: "custom", time: "9am" }, early: { enabled: true, preset: "custom", time: "noon" } }));
    expect(badges).toEqual({ earlyInvalid: true, lateInvalid: true });
    const labels = timingTagsFor({ timingBadges: badges }).map((tag) => tag.label);
    expect(labels).toEqual(["Late checkout · time could not be read", "Early check-in · time could not be read"]);
  });

  it("never falls back to the same-day arrival time when the early check-in time is unreadable", () => {
    const tags = timingTagsFor({ timingBadges: { earlyInvalid: true }, sameDayCheckin: true, sameDayCheckinTime: "15:00" });
    expect(tags.map((tag) => tag.label)).toEqual(["Early check-in · time could not be read"]);
  });

  it("merges a same-day check-in the way the cleaner's notice does, and never invents a time", () => {
    expect(timingTagsFor({ timingBadges: null, sameDayCheckin: true, sameDayCheckinTime: "15:00" }).map((tag) => tag.label))
      .toEqual(["Same-day check-in · ready by 15:00"]);
    expect(timingTagsFor({ timingBadges: null, sameDayCheckin: true, sameDayCheckinTime: null }).map((tag) => tag.label))
      .toEqual(["Same-day check-in · arrival time not confirmed"]);
    // The early check-in time is the earlier deadline and wins.
    expect(timingTagsFor({ timingBadges: { early: "13:00" }, sameDayCheckin: true, sameDayCheckinTime: "15:00" }).map((tag) => tag.label))
      .toEqual(["Early check-in · ready by 13:00"]);
  });

  it("rule-only tags leave same-day arrival to the surfaces that show it separately", () => {
    expect(timingRuleTagsFor({ late: "12:30" }).map((tag) => tag.label)).toEqual(["Late checkout · start after 12:30"]);
  });
});

describe("Command: today by cleaner carries the rules from the live board loader", () => {
  const row = (overrides: Partial<LiveJobRow>): LiveJobRow => ({
    jobId: "j1", jobNumber: "J1", propertyName: "Harbour Loft", suburb: null, status: "ASSIGNED", state: "planned",
    startTime: "11:30", dueTime: "13:00", sameDayCheckinTime: null, cleaners: [{ id: "c1", name: "Cleaner One" }] as never,
    minutes: null, etaClock: null, distanceMeters: null, ...overrides,
  } as LiveJobRow);

  it("puts the worded rules on the segment and its accessible label", () => {
    const payload = buildTodayByCleaner([row({ timingBadges: { late: "11:00", early: "13:00" } })], 9 * 60);
    const segment = payload.rows.flatMap((r) => r.segments)[0];
    expect(segment.timingBadges).toEqual({ late: "11:00", early: "13:00" });
    expect(segment.label).toContain("Late checkout · start after 11:00; Early check-in · ready by 13:00");
  });

  it("a job without rules has none", () => {
    const segment = buildTodayByCleaner([row({})], 9 * 60).rows.flatMap((r) => r.segments)[0];
    expect(segment.timingBadges).toBeNull();
    expect(segment.label).not.toContain("checkout");
  });
});

describe("start briefing: the timing must be acknowledged as it stands now", () => {
  const meta = (late: RuleInput) => parseJobInternalNotes(notes({ late, note: "Bins out" }));

  it("lists the timing rule first and requires every item before a start", () => {
    const items = resolveStartBriefingItems({ meta: meta(LATE_11), jobTasks: [] });
    expect(items[0]).toMatchObject({ source: "TIMING_RULE", title: expect.stringContaining("11:00") });
    const partial = buildStartBriefingAck(items, [{ itemId: items[1].id }]);
    expect(validateStartBriefingAck(items, partial)).toMatchObject({ ok: false, reason: "MISSING" });
    expect(validateStartBriefingAck(items, null)).toMatchObject({ ok: false, reason: "MISSING" });
  });

  it("an acknowledgement given for 11:00 does not survive a change to 12:30", () => {
    const before = resolveStartBriefingItems({ meta: meta(LATE_11), jobTasks: [] });
    const ack = buildStartBriefingAck(before, before.map((item) => ({ itemId: item.id })));
    expect(validateStartBriefingAck(before, ack)).toEqual({ ok: true });
    const after = resolveStartBriefingItems({ meta: meta({ enabled: true, preset: "12:30" }), jobTasks: [] });
    expect(validateStartBriefingAck(after, ack)).toMatchObject({ ok: false, reason: "STALE" });
  });

  it("a dialog opened before the change cannot cover it: the shown fingerprint must match", () => {
    const before = resolveStartBriefingItems({ meta: meta(LATE_11), jobTasks: [] });
    const after = resolveStartBriefingItems({ meta: meta({ enabled: true, preset: "12:30" }), jobTasks: [] });
    expect(checkIncomingAckVersion(after, startBriefingHash(before))).toMatchObject({ ok: false, reason: "STALE" });
    expect(checkIncomingAckVersion(after, startBriefingHash(after))).toEqual({ ok: true });
    // A timing rule always needs the fingerprint; a briefing without one stays compatible.
    expect(checkIncomingAckVersion(after, undefined)).toMatchObject({ ok: false, reason: "STALE" });
    const noTiming = resolveStartBriefingItems({ meta: parseJobInternalNotes(notes({ note: "Bins out" })), jobTasks: [] });
    expect(checkIncomingAckVersion(noTiming, undefined)).toEqual({ ok: true });
  });

  it("records a timing-only fingerprint with the acknowledgement", () => {
    const items = resolveStartBriefingItems({ meta: meta(LATE_11), jobTasks: [] });
    const ack = buildStartBriefingAck(items, items.map((item) => ({ itemId: item.id })));
    expect(ack.timingHash).toBe(startBriefingTimingHash(items));
    expect(ack.timingHash).not.toBe(ack.hash);
  });
});

describe("admin job page: was the timing acknowledged?", () => {
  const TZ = "Australia/Sydney";
  const cleaners = [{ userId: "c1", name: "Cleaner One" }];
  const metaWith = (late: RuleInput, acks: Record<string, unknown> = {}, note = "Bins out") => ({
    ...parseJobInternalNotes(notes({ late, note })),
    startBriefingAcks: acks,
  });
  const ackFor = (meta: ReturnType<typeof metaWith>, at = "2026-11-20T00:10:00.000Z") => {
    const items = resolveStartBriefingItems({ meta, jobTasks: [] });
    return buildStartBriefingAck(items, items.map((item) => ({ itemId: item.id, at })));
  };

  it("says Not acknowledged yet when nothing is recorded, never acknowledged", () => {
    const summary = buildTimingAckSummary({ meta: metaWith(LATE_11), tasks: [], cleaners, names: new Map(), timeZone: TZ });
    expect(summary).toMatchObject({ kind: "rows", rows: [{ userId: "c1", state: { kind: "notAcknowledged" } }] });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(timingAckSentence(summary.rows[0])).toBe("Cleaner One: not acknowledged yet");
  });

  it("names who acknowledged and when, in the organisation timezone", () => {
    const base = metaWith(LATE_11);
    const meta = { ...base, startBriefingAcks: { c1: ackFor(base) } };
    const summary = buildTimingAckSummary({ meta, tasks: [], cleaners, names: new Map(), timeZone: TZ });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(summary.rows[0].state).toEqual({ kind: "acknowledged", atLabel: "20 Nov 2026 · 11:10" });
    expect(timingAckSentence(summary.rows[0])).toBe("Cleaner One acknowledged the current timing · 20 Nov 2026 · 11:10");
  });

  it("an acknowledgement of 11:00 is not counted after the time moves to 12:30", () => {
    const base = metaWith(LATE_11);
    const moved = { ...metaWith({ enabled: true, preset: "12:30" }), startBriefingAcks: { c1: ackFor(base) } };
    const summary = buildTimingAckSummary({ meta: moved, tasks: [], cleaners, names: new Map(), timeZone: TZ });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(summary.rows[0].state.kind).toBe("earlierVersion");
    expect(timingAckSentence(summary.rows[0])).toContain("not acknowledged for the current timing");
  });

  it("an unrelated edit (the note) does not undo a timing acknowledgement that carries the timing fingerprint", () => {
    const base = metaWith(LATE_11);
    const edited = { ...metaWith(LATE_11, {}, "Bins out and recycling too"), startBriefingAcks: { c1: ackFor(base) } };
    const summary = buildTimingAckSummary({ meta: edited, tasks: [], cleaners, names: new Map(), timeZone: TZ });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(summary.rows[0].state.kind).toBe("acknowledged");
  });

  it("an older record without the timing fingerprint counts any edit as a change", () => {
    const base = metaWith(LATE_11);
    const { timingHash: _drop, ...legacy } = ackFor(base);
    const edited = { ...metaWith(LATE_11, {}, "Bins out and recycling too"), startBriefingAcks: { c1: legacy } };
    const summary = buildTimingAckSummary({ meta: edited, tasks: [], cleaners, names: new Map(), timeZone: TZ });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(summary.rows[0].state.kind).toBe("earlierVersion");
  });

  it("says a malformed record could not be read", () => {
    const meta = metaWith(LATE_11, { c1: { items: "nope" } });
    const summary = buildTimingAckSummary({ meta, tasks: [], cleaners, names: new Map(), timeZone: TZ });
    if (summary.kind !== "rows") throw new Error("rows expected");
    expect(timingAckSentence(summary.rows[0])).toBe("Cleaner One: acknowledgement could not be read");
  });

  it("has nothing to report for a job without timing rules", () => {
    const meta = { ...parseJobInternalNotes(notes({ note: "Bins out" })), startBriefingAcks: {} };
    expect(buildTimingAckSummary({ meta, tasks: [], cleaners, names: new Map(), timeZone: TZ })).toEqual({ kind: "none" });
  });

  it("gives the cleaner's own status for their job screen", () => {
    const base = metaWith(LATE_11);
    const items = resolveStartBriefingItems({ meta: base, jobTasks: [] });
    expect(ownTimingAckStatus({ items, rawAck: undefined })).toBe("notAcknowledged");
    expect(ownTimingAckStatus({ items, rawAck: ackFor(base) })).toBe("current");
    const moved = resolveStartBriefingItems({ meta: metaWith({ enabled: true, preset: "12:30" }), jobTasks: [] });
    expect(ownTimingAckStatus({ items: moved, rawAck: ackFor(base) })).toBe("changed");
    expect(ownTimingAckStatus({ items, rawAck: "garbage" })).toBe("unreadable");
    expect(ownTimingAckStatus({ items: [], rawAck: undefined })).toBe("none");
  });
});
