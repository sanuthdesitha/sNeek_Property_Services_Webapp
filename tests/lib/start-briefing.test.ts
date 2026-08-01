import { describe, it, expect } from "vitest";
import {
  EARLY_CHECKIN_ITEM_ID,
  LATE_CHECKOUT_ITEM_ID,
  SPECIAL_NOTE_ITEM_ID,
  adminTaskBriefingItemId,
  buildStartBriefingAck,
  clientTaskBriefingItemId,
  resolveStartBriefingItems,
  startBriefingHash,
  validateStartBriefingAck,
} from "@/lib/forms/start-briefing";

/** Minimal meta shape — only the fields the resolver reads. */
function meta(over: Record<string, unknown> = {}) {
  return {
    earlyCheckin: { enabled: false, preset: "none" },
    lateCheckout: { enabled: false, preset: "none" },
    internalNoteText: "",
    specialRequestTasks: [],
    ...over,
  } as any;
}

const RULE = (time: string) => ({ enabled: true, preset: "custom", time });

describe("resolveStartBriefingItems", () => {
  it("returns nothing for a job with no notable instructions", () => {
    // A dialog that fires on every job is a dialog people dismiss unread.
    expect(resolveStartBriefingItems({ meta: meta() })).toEqual([]);
  });

  it("puts timing rules first and names the time", () => {
    const items = resolveStartBriefingItems({
      meta: meta({
        lateCheckout: RULE("12:30"),
        earlyCheckin: RULE("11:00"),
        internalNoteText: "hi",
      }),
    });
    expect(items[0].id).toBe(LATE_CHECKOUT_ITEM_ID);
    expect(items[0].title).toContain("12:30");
    expect(items[0].source).toBe("TIMING_RULE");
    expect(items[1].id).toBe(EARLY_CHECKIN_ITEM_ID);
    expect(items[1].title).toContain("11:00");
    // The free-form note is context, so it comes last.
    expect(items[items.length - 1].id).toBe(SPECIAL_NOTE_ITEM_ID);
  });

  it("includes admin special-request tasks from the meta", () => {
    const items = resolveStartBriefingItems({
      meta: meta({
        specialRequestTasks: [{ id: "t1", title: "Water the plants", description: "Balcony only" }],
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(adminTaskBriefingItemId("t1"));
    expect(items[0].detail).toBe("Balcony only");
    expect(items[0].source).toBe("ADMIN_TASK");
  });

  it("includes admin job tasks and APPROVED client requests only", () => {
    const items = resolveStartBriefingItems({
      meta: meta(),
      jobTasks: [
        { id: "a1", title: "Admin task", source: "ADMIN" },
        { id: "c1", title: "Approved client task", source: "CLIENT", approvalStatus: "APPROVED" },
        { id: "c2", title: "Pending client task", source: "CLIENT", approvalStatus: "PENDING" },
        { id: "c3", title: "Rejected client task", source: "CLIENT", approvalStatus: "REJECTED" },
        { id: "z1", title: "Carry forward", source: "CARRY_FORWARD" },
      ],
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(adminTaskBriefingItemId("a1"));
    expect(ids).toContain(clientTaskBriefingItemId("c1"));
    // An unapproved request is not yet work.
    expect(ids).not.toContain(clientTaskBriefingItemId("c2"));
    expect(ids).not.toContain(clientTaskBriefingItemId("c3"));
    expect(ids).toHaveLength(2);
  });

  it("does not ask the cleaner to read the same instruction twice", () => {
    // A meta special-request task and its materialised JobTask row are one
    // instruction, and they share an id.
    const items = resolveStartBriefingItems({
      meta: meta({ specialRequestTasks: [{ id: "t1", title: "Water the plants" }] }),
      jobTasks: [{ id: "t1", title: "Water the plants", source: "ADMIN" }],
    });
    expect(items).toHaveLength(1);
  });

  it("skips empty titles", () => {
    const items = resolveStartBriefingItems({
      meta: meta({ specialRequestTasks: [{ id: "t1", title: "   " }] }),
      jobTasks: [{ id: "a1", title: "", source: "ADMIN" }],
    });
    expect(items).toEqual([]);
  });
});

describe("validateStartBriefingAck", () => {
  const items = resolveStartBriefingItems({
    meta: meta({ lateCheckout: RULE("12:30"), internalNoteText: "Bins go out Tuesday" }),
  });

  it("passes when there is nothing to read", () => {
    expect(validateStartBriefingAck([], null)).toEqual({ ok: true });
    expect(validateStartBriefingAck([], undefined)).toEqual({ ok: true });
  });

  it("fails with MISSING when nothing was acknowledged", () => {
    const result = validateStartBriefingAck(items, null);
    expect(result).toMatchObject({ ok: false, reason: "MISSING" });
    expect((result as any).missingIds).toHaveLength(items.length);
  });

  it("fails with MISSING when only some items were acknowledged", () => {
    const partial = buildStartBriefingAck(items, [{ itemId: items[0].id }]);
    const result = validateStartBriefingAck(items, partial);
    expect(result).toMatchObject({ ok: false, reason: "MISSING" });
    expect((result as any).missingIds).toEqual([items[1].id]);
  });

  it("passes when every item was acknowledged against this exact version", () => {
    const ack = buildStartBriefingAck(
      items,
      items.map((i) => ({ itemId: i.id }))
    );
    expect(validateStartBriefingAck(items, ack)).toEqual({ ok: true });
  });

  it("is idempotent — a stored ack satisfies a retried clock-in", () => {
    // The cleaner acked, the POST failed for an unrelated reason, they tap
    // again: they must not be made to read it a second time.
    const ack = buildStartBriefingAck(
      items,
      items.map((i) => ({ itemId: i.id }))
    );
    expect(validateStartBriefingAck(items, ack)).toEqual({ ok: true });
    expect(validateStartBriefingAck(items, ack)).toEqual({ ok: true });
  });

  it("fails with STALE when the instruction TEXT changed", () => {
    // Same ids, new time — acknowledging "start after 12:30" must not cover
    // "start after 14:00".
    const ack = buildStartBriefingAck(
      items,
      items.map((i) => ({ itemId: i.id }))
    );
    const changed = resolveStartBriefingItems({
      meta: meta({ lateCheckout: RULE("14:00"), internalNoteText: "Bins go out Tuesday" }),
    });
    expect(validateStartBriefingAck(changed, ack)).toMatchObject({ ok: false, reason: "STALE" });
  });

  it("fails with MISSING when a NEW item was added", () => {
    const ack = buildStartBriefingAck(
      items,
      items.map((i) => ({ itemId: i.id }))
    );
    const extended = resolveStartBriefingItems({
      meta: meta({
        lateCheckout: RULE("12:30"),
        internalNoteText: "Bins go out Tuesday",
        specialRequestTasks: [{ id: "t9", title: "New task nobody has read" }],
      }),
    });
    const result = validateStartBriefingAck(extended, ack);
    expect(result).toMatchObject({ ok: false, reason: "MISSING" });
    expect((result as any).missingIds).toEqual([adminTaskBriefingItemId("t9")]);
  });

  it("ignores malformed ack records rather than trusting them", () => {
    for (const junk of [42, "yes", { hash: "x" }, { items: "nope" }, { items: [{}] }]) {
      expect(validateStartBriefingAck(items, junk)).toMatchObject({ ok: false });
    }
  });
});

describe("startBriefingHash", () => {
  it("is order-independent", () => {
    const a = [
      { id: "1", title: "A", detail: "x" },
      { id: "2", title: "B" },
    ];
    expect(startBriefingHash(a)).toBe(startBriefingHash([...a].reverse()));
  });

  it("changes when any text changes", () => {
    const base = [{ id: "1", title: "A", detail: "x" }];
    expect(startBriefingHash(base)).not.toBe(
      startBriefingHash([{ id: "1", title: "A", detail: "y" }])
    );
    expect(startBriefingHash(base)).not.toBe(
      startBriefingHash([{ id: "1", title: "B", detail: "x" }])
    );
    expect(startBriefingHash(base)).not.toBe(
      startBriefingHash([{ id: "2", title: "A", detail: "x" }])
    );
  });
});
