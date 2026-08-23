import { describe, it, expect } from "vitest";
import {
  groupInvoiceLines,
  shouldGroupInvoice,
  type GroupableLine,
} from "@/lib/billing/invoice-grouping";

function line(overrides: Partial<GroupableLine> = {}): GroupableLine {
  return {
    description: "Turnover clean",
    quantity: 1,
    unitPrice: 180,
    lineTotal: 180,
    category: "SERVICE",
    job: { property: { name: "Bondi Apt", suburb: "Bondi" } },
    ...overrides,
  };
}

describe("groupInvoiceLines", () => {
  it("puts each property in its own section with its own subtotal", () => {
    const groups = groupInvoiceLines([
      line({ lineTotal: 180 }),
      line({ lineTotal: 200 }),
      line({ job: { property: { name: "Manly House", suburb: "Manly" } }, lineTotal: 320 }),
    ]);

    expect(groups.map((g) => g.title)).toEqual(["Bondi Apt — Bondi", "Manly House — Manly"]);
    expect(groups[0].subtotal).toBe(380);
    expect(groups[1].subtotal).toBe(320);
  });

  it("sorts properties alphabetically so consecutive invoices read the same way", () => {
    // A section order that shuffles month to month makes this month's figure
    // impossible to compare against last month's without hunting for it.
    const groups = groupInvoiceLines([
      line({ job: { property: { name: "Zetland" } } }),
      line({ job: { property: { name: "Avalon" } } }),
      line({ job: { property: { name: "Manly" } } }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Avalon", "Manly", "Zetland"]);
  });

  it("SEPARATES extras into their own section, always last", () => {
    // Burying a repair inside a property's list of cleans is how a client finds
    // a $400 charge by accident three weeks later.
    const groups = groupInvoiceLines([
      line({ category: "MAINTENANCE", description: "Maintenance - tap", lineTotal: 400 }),
      line({ lineTotal: 180 }),
      line({ category: "SHOPPING_REIMBURSEMENT", description: "Shopping", lineTotal: 62.5 }),
    ]);

    expect(groups.map((g) => g.title)).toEqual(["Bondi Apt — Bondi", "Additional charges"]);
    const extras = groups[groups.length - 1];
    expect(extras.isExtras).toBe(true);
    expect(extras.lines).toHaveLength(2);
    expect(extras.subtotal).toBe(462.5);
  });

  it("takes the property from the JOB in preference to the manual hint", () => {
    // The job is where the work actually happened; line.property is only the
    // admin's grouping hint and must never override the truth.
    const groups = groupInvoiceLines([
      line({
        job: { property: { name: "Real Property" } },
        property: { name: "Wrong Hint" },
      }),
    ]);
    expect(groups[0].title).toBe("Real Property");
  });

  it("falls back to the manual hint when there is no job behind the line", () => {
    const groups = groupInvoiceLines([
      line({ job: null, property: { name: "Manual Property", suburb: "Newtown" } }),
    ]);
    expect(groups[0].title).toBe("Manual Property — Newtown");
  });

  it("NEVER drops a line that has no property at all", () => {
    // A charge that vanishes from an invoice is far worse than one filed oddly.
    const groups = groupInvoiceLines([
      line({ job: null, property: null, description: "Ad-hoc charge", lineTotal: 95 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Other charges");
    expect(groups[0].lines[0].description).toBe("Ad-hoc charge");
    expect(groups[0].subtotal).toBe(95);
  });

  it("treats a blank property name as no property rather than an empty heading", () => {
    const groups = groupInvoiceLines([line({ job: { property: { name: "   " } } })]);
    expect(groups[0].title).toBe("Other charges");
  });

  it("keeps 'Other charges' before the extras section", () => {
    const groups = groupInvoiceLines([
      line({ category: "MAINTENANCE", lineTotal: 400 }),
      line({ job: null, property: null, lineTotal: 95 }),
      line({ lineTotal: 180 }),
    ]);
    expect(groups.map((g) => g.title)).toEqual([
      "Bondi Apt — Bondi",
      "Other charges",
      "Additional charges",
    ]);
  });

  it("PRESERVES the order the caller supplied within a group", () => {
    // The caller has already sorted by sortOrder. Re-sorting here would discard
    // an ordering an admin dragged into place by hand.
    const groups = groupInvoiceLines([
      line({ description: "Third" }),
      line({ description: "First" }),
      line({ description: "Second" }),
    ]);
    expect(groups[0].lines.map((l) => l.description)).toEqual(["Third", "First", "Second"]);
  });

  it("rounds each subtotal so the sections visibly add up to the invoice total", () => {
    // Three lines of 0.1 sum to 0.30000000000000004. Printed raw beside a total
    // of 0.30, that reads as an error in the bill rather than in the floats.
    const groups = groupInvoiceLines([
      line({ lineTotal: 0.1 }),
      line({ lineTotal: 0.1 }),
      line({ lineTotal: 0.1 }),
    ]);
    expect(groups[0].subtotal).toBe(0.3);
  });

  it("is case-insensitive about the extras categories", () => {
    const groups = groupInvoiceLines([line({ category: "maintenance", lineTotal: 400 })]);
    expect(groups[0].isExtras).toBe(true);
  });

  it("returns nothing for an empty invoice rather than an empty section", () => {
    expect(groupInvoiceLines([])).toEqual([]);
  });
});

describe("shouldGroupInvoice", () => {
  it("does not bother with headings for one property and no extras", () => {
    const groups = groupInvoiceLines([line(), line({ lineTotal: 200 })]);
    expect(shouldGroupInvoice(groups)).toBe(false);
  });

  it("groups as soon as there is a second section", () => {
    expect(shouldGroupInvoice(groupInvoiceLines([line(), line({ category: "MAINTENANCE" })]))).toBe(
      true
    );
    expect(
      shouldGroupInvoice(groupInvoiceLines([line(), line({ job: { property: { name: "Manly" } } })]))
    ).toBe(true);
  });

  it("does not group an empty invoice", () => {
    expect(shouldGroupInvoice(groupInvoiceLines([]))).toBe(false);
  });
});
