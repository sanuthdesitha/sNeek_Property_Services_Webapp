import { describe, it, expect } from "vitest";
import {
  buildMaintenanceInvoiceLines,
  type BillableAssignmentInput,
} from "@/lib/billing/maintenance-billing";

const CLIENT = "client-1";
const DONE = new Date("2026-08-10T02:00:00.000Z");

function assignment(overrides: Partial<BillableAssignmentInput> = {}): BillableAssignmentInput {
  return {
    id: "a1",
    payType: "FIXED",
    payAmount: 400,
    payHours: null,
    payPayer: "CLIENT",
    completedAt: DONE,
    includedInClientInvoiceId: null,
    item: {
      title: "Replace bathroom tap",
      propertyId: "prop-1",
      property: { clientId: CLIENT },
    },
    ...overrides,
  };
}

function build(rows: BillableAssignmentInput[], extra: Record<string, unknown> = {}) {
  return buildMaintenanceInvoiceLines({ assignments: rows, clientId: CLIENT, ...extra });
}

describe("buildMaintenanceInvoiceLines", () => {
  it("bills a completed repair the client agreed to pay for", () => {
    const [line] = build([assignment()]);
    expect(line).toMatchObject({
      assignmentId: "a1",
      propertyId: "prop-1",
      quantity: 1,
      unitPrice: 400,
      lineTotal: 400,
      category: "MAINTENANCE",
    });
  });

  it("spells out how the figure was reached", () => {
    // A client querying a repair charge asks how it was arrived at. An invoice
    // that cannot answer that becomes a phone call.
    const [line] = build([assignment({ payType: "HOURLY", payAmount: 45, payHours: 3 })]);
    expect(line.description).toContain("Replace bathroom tap");
    expect(line.description).toContain("3 h × $45.00 = $135.00");
    expect(line.lineTotal).toBe(135);
  });

  it("NEVER bills work the company is paying for", () => {
    expect(build([assignment({ payPayer: "COMPANY" })])).toEqual([]);
    expect(build([assignment({ payPayer: null })])).toEqual([]);
  });

  it("NEVER bills work that has not been done", () => {
    // Charging for a repair that has not happened costs the client's trust in
    // every other line on the invoice, not just this one.
    expect(build([assignment({ completedAt: null })])).toEqual([]);
  });

  it("NEVER bills the same repair twice", () => {
    expect(build([assignment({ includedInClientInvoiceId: "inv-1" })])).toEqual([]);
  });

  it("never bills a repair on another client's property", () => {
    const base = assignment();
    expect(build([assignment({ item: { ...base.item, property: { clientId: "other" } } })])).toEqual(
      []
    );
    expect(build([assignment({ item: { ...base.item, property: null } })])).toEqual([]);
  });

  it("respects a per-property invoice", () => {
    const base = assignment();
    const rows = [
      assignment({ id: "a1" }),
      assignment({ id: "a2", item: { ...base.item, propertyId: "prop-2" } }),
    ];
    expect(build(rows, { propertyId: "prop-1" }).map((l) => l.assignmentId)).toEqual(["a1"]);
  });

  it("bills against the date the work was FINISHED", () => {
    const rows = [
      assignment({ id: "before", completedAt: new Date("2026-07-01T00:00:00.000Z") }),
      assignment({ id: "inside", completedAt: new Date("2026-08-10T00:00:00.000Z") }),
      assignment({ id: "after", completedAt: new Date("2026-09-01T00:00:00.000Z") }),
    ];
    const lines = build(rows, {
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T23:59:59.999Z"),
    });
    expect(lines.map((l) => l.assignmentId)).toEqual(["inside"]);
  });

  it("takes everything outstanding when the period is open-ended", () => {
    // The first run after this ships has to sweep up repairs completed back when
    // nothing could bill them.
    const rows = [
      assignment({ id: "old", completedAt: new Date("2025-01-01T00:00:00.000Z") }),
      assignment({ id: "new" }),
    ];
    expect(build(rows).map((l) => l.assignmentId)).toEqual(["old", "new"]);
  });

  it("skips an amount that does not resolve, rather than billing zero or a guess", () => {
    // An hourly rate with no hours cannot produce a total. Inventing one puts a
    // number on a client's invoice that nobody in the business ever agreed.
    expect(build([assignment({ payType: "HOURLY", payAmount: 45, payHours: null })])).toEqual([]);
    expect(build([assignment({ payAmount: 0 })])).toEqual([]);
    expect(build([assignment({ payAmount: null })])).toEqual([]);
    expect(build([assignment({ payAmount: -100 })])).toEqual([]);
  });

  it("bills what we pay, with no markup applied anywhere", () => {
    // A margin on client-funded repairs would be a pricing decision with a
    // settings field behind it — never a multiplier hidden in a billing helper.
    const [line] = build([assignment({ payAmount: 400 })]);
    expect(line.unitPrice).toBe(400);
    expect(line.lineTotal).toBe(400);
  });

  it("returns nothing for an empty roster rather than throwing", () => {
    expect(build([])).toEqual([]);
  });
});
