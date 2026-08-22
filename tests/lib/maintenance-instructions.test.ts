import { describe, it, expect } from "vitest";
import {
  parseInstructions,
  resolveAssignmentPay,
  describePay,
  mayAssignQa,
} from "@/lib/maintenance/instructions";

describe("parseInstructions", () => {
  it("keeps as many blocks as the job needs", () => {
    const out = parseInstructions([
      { id: "a", kind: "TEXT", title: "Gate code", body: "1234#" },
      { id: "b", kind: "PICKUP", title: "Key", address: "12 Bondi Rd" },
      { id: "c", kind: "CONTACT", title: "Ring", contactName: "Sam", contactPhone: "0400" },
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.kind)).toEqual(["TEXT", "PICKUP", "CONTACT"]);
  });

  it("drops a block with a title but nothing in it", () => {
    // An empty card on a phone reads as information that failed to load, which
    // is worse than information nobody entered.
    expect(parseInstructions([{ id: "a", kind: "TEXT", title: "Note" }])).toEqual([]);
  });

  it("keeps a photos block that has photos but no words", () => {
    const out = parseInstructions([
      { id: "a", kind: "PHOTOS", title: "Which meter", photoKeys: ["m/1.jpg", "m/2.jpg"] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].photoKeys).toEqual(["m/1.jpg", "m/2.jpg"]);
  });

  it("falls back to TEXT for an unrecognised kind rather than dropping content", () => {
    const out = parseInstructions([{ id: "a", kind: "HOLOGRAM", title: "x", body: "still useful" }]);
    expect(out[0].kind).toBe("TEXT");
  });

  it("gives an untitled block a sensible heading", () => {
    const out = parseInstructions([{ id: "a", kind: "PICKUP", address: "12 Bondi Rd" }]);
    expect(out[0].title).toBe("Pickup location");
  });

  it("treats anything that is not a list as no instructions", () => {
    expect(parseInstructions(null)).toEqual([]);
    expect(parseInstructions("gate code 1234")).toEqual([]);
    expect(parseInstructions({ kind: "TEXT" })).toEqual([]);
  });
});

describe("resolveAssignmentPay", () => {
  it("reads a fixed fee", () => {
    const pay = resolveAssignmentPay({ payType: "FIXED", payAmount: 120 });
    expect(pay?.total).toBe(120);
    expect(pay?.payer).toBe("COMPANY");
  });

  it("multiplies an hourly rate by the hours", () => {
    const pay = resolveAssignmentPay({ payType: "HOURLY", payAmount: 45, payHours: 2.5 });
    expect(pay?.total).toBe(112.5);
  });

  it("refuses an hourly rate with no hours instead of inventing one", () => {
    // Defaulting to one hour would put a figure on an invoice that nobody agreed.
    expect(resolveAssignmentPay({ payType: "HOURLY", payAmount: 45 })).toBeNull();
    expect(resolveAssignmentPay({ payType: "HOURLY", payAmount: 45, payHours: 0 })).toBeNull();
  });

  it("says nothing rather than zero when no pay was set", () => {
    // "No pay recorded" and "this pays nothing" are different statements, and
    // only one of them should put a line on an invoice.
    expect(resolveAssignmentPay({})).toBeNull();
    expect(resolveAssignmentPay({ payType: "FIXED", payAmount: 0 })).toBeNull();
    expect(resolveAssignmentPay({ payType: "FIXED", payAmount: -50 })).toBeNull();
  });

  it("records the client as payer when they agreed to cover it", () => {
    const pay = resolveAssignmentPay({ payType: "FIXED", payAmount: 80, payPayer: "CLIENT" });
    expect(pay?.payer).toBe("CLIENT");
  });

  it("rounds to cents so the invoice total cannot disagree", () => {
    const pay = resolveAssignmentPay({ payType: "HOURLY", payAmount: 33.33, payHours: 3 });
    expect(pay?.total).toBe(99.99);
  });
});

describe("describePay", () => {
  it("shows the working for an hourly job", () => {
    const pay = resolveAssignmentPay({ payType: "HOURLY", payAmount: 45, payHours: 2 })!;
    expect(describePay(pay)).toBe("2 h × $45.00 = $90.00");
  });

  it("states a fixed fee plainly", () => {
    const pay = resolveAssignmentPay({ payType: "FIXED", payAmount: 120 })!;
    expect(describePay(pay)).toBe("$120.00 fixed");
  });
});

describe("mayAssignQa", () => {
  it("refuses to let someone inspect their own clean", () => {
    // The failsafe. Self-review is not review, and it would corrupt every
    // quality figure downstream while the scores still looked fine.
    expect(mayAssignQa({ candidateUserId: "u1", jobCleanerUserIds: ["u1"] })).toBe(false);
    expect(mayAssignQa({ candidateUserId: "u1", jobCleanerUserIds: ["u2", "u1"] })).toBe(false);
  });

  it("allows anyone who did not work that clean", () => {
    expect(mayAssignQa({ candidateUserId: "u3", jobCleanerUserIds: ["u1", "u2"] })).toBe(true);
    expect(mayAssignQa({ candidateUserId: "u1", jobCleanerUserIds: [] })).toBe(true);
  });
});
