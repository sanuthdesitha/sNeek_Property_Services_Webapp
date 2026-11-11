import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { redactItemForReporter, redactItemWithEventsForReporter } from "@/lib/lost-found/service";

const row = {
  id: "i1",
  itemName: "Watch",
  guestName: "Alex Guest",
  guestContact: "alex@example.com",
  estimatedValue: 900,
  resolution: null,
} as any;

describe("lost-found detail for the reporting cleaner", () => {
  it("removes guest details and valuation", () => {
    expect(redactItemForReporter(row)).toMatchObject({ itemName: "Watch", guestName: null, guestContact: null, estimatedValue: null });
  });

  it("keeps comments and the cleaner's own entries, blanks office workflow notes", () => {
    const events = [
      { id: "e1", userId: "cleaner" },
      { id: "e2", userId: "office" },
      { id: "e3", userId: "office" },
    ] as any;
    const detail = {
      ...row,
      events: [
        { id: "e1", action: "REPORTED", note: "Found under bed", meta: { a: 1 }, actorName: "Sam", createdAt: "t1" },
        { id: "e2", action: "GUEST_CONTACTED", note: "Called 0400 000 000", meta: { phone: "0400" }, actorName: "Office", createdAt: "t2" },
        { id: "e3", action: "COMMENT", note: "Please drop it at the office", meta: null, actorName: "Office", createdAt: "t3" },
      ],
    } as any;
    const result = redactItemWithEventsForReporter(detail, events, "cleaner");
    expect(result.guestContact).toBeNull();
    expect(result.events[0]).toMatchObject({ note: "Found under bed", meta: { a: 1 } });
    expect(result.events[1]).toMatchObject({ action: "GUEST_CONTACTED", note: null, meta: null, createdAt: "t2" });
    expect(result.events[2]).toMatchObject({ note: "Please drop it at the office" });
  });
});
