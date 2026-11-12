/**
 * Quote builder arithmetic and request bodies after the split into
 * `components/v2/admin/quotes/builder/*`: totals, coupon amounts, META, the
 * create / edit bodies and the edit seed must equal what the old 2,300-line
 * builder produced for the same input. `oldTotals` is the old component's
 * inline code, copied verbatim.
 */
import { describe, expect, it } from "vitest";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { builderTotals, buildCreatePayload, buildEditPatch, buildQuoteMeta, couponAmount, discountRequestBody, type BuilderPayloadInput } from "@/components/v2/admin/quotes/builder/payload";
import { buildEditSeed } from "@/components/v2/admin/quotes/builder/model";
import { editSeedFromSnapshot, notesMetaBlock, notesProse, snapshotFromRecord } from "@/lib/quotes/quote-record";

type Line = { label: string; unitPrice: number; qty: number; total: number };

function oldTotals(allLines: Line[], gstEnabled: boolean, staged: number) {
  const sum = allLines.reduce((acc, li) => acc + (Number(li.total) || 0), 0);
  const { subtotal, gstAmount, totalAmount } = calculateGstBreakdown(Math.max(0, Number(sum.toFixed(2))), { gstEnabled });
  const discountAmount = Math.min(subtotal, Math.max(0, staged ?? 0));
  const netAfterDiscount = calculateGstBreakdown(Math.max(0, Number((subtotal - discountAmount).toFixed(2))), { gstEnabled });
  return { subtotal, gstAmount, totalAmount, discountAmount, shownGst: discountAmount > 0 ? netAfterDiscount.gstAmount : gstAmount, shownTotal: discountAmount > 0 ? netAfterDiscount.totalAmount : totalAmount };
}

const line = (total: number, label = "Line"): Line => ({ label, unitPrice: total, qty: 1, total });

describe("totals are unchanged", () => {
  const cases: Array<[string, Line[], boolean, number]> = [
    ["rate card plus extras, GST on", [line(320), line(65), line(95)], true, 0],
    ["staged discount", [line(320), line(65.55), line(95.1)], true, 48],
    ["discount larger than the subtotal is clamped", [line(50)], true, 80],
    ["GST off", [line(199.99), line(0.015)], false, 10],
    ["negative adjustment line", [line(300), line(-25)], true, 0],
    ["no lines", [], true, 0],
  ];
  it.each(cases)("%s", (_name, lines, gst, staged) => {
    const now = builderTotals(lines, gst, staged);
    const before = oldTotals(lines, gst, staged);
    expect({ subtotal: now.subtotal, gstAmount: now.gstAmount, totalAmount: now.totalAmount, discountAmount: now.discountAmount }).toEqual({ subtotal: before.subtotal, gstAmount: before.gstAmount, totalAmount: before.totalAmount, discountAmount: before.discountAmount });
    const shown = now.discountAmount > 0 ? now.net : now;
    expect([shown.gstAmount, shown.totalAmount]).toEqual([before.shownGst, before.shownTotal]);
  });

  it("stages coupons as before (fixed clamped, percent of the subtotal)", () => {
    expect(couponAmount({ code: "A", title: "A", discountType: "FIXED", discountValue: 500 }, 120)).toBe(120);
    expect(couponAmount({ code: "B", title: "B", discountType: "PERCENT", discountValue: 10 }, 480)).toBe(48);
    expect(couponAmount({ code: "C", title: "C", discountType: "PERCENT", discountValue: 150 }, 100)).toBe(100);
  });
});

function input(overrides: Partial<BuilderPayloadInput> = {}): BuilderPayloadInput {
  const lines = [line(320, "Deep clean"), line(65, "Oven")];
  return {
    meta: { extras: [] },
    notes: "Deep clean for your property.",
    serviceContext: {},
    refImages: [],
    showAddOnPrices: false,
    recipientMode: "client",
    clientId: "c1",
    leadId: "l1",
    newLead: { name: " Olivia ", email: " o@x.com ", phone: "", suburb: "" },
    serviceType: "DEEP_CLEAN",
    frequency: "one_off",
    serviceAddress: " 8 Arden St ",
    serviceSuburb: "Coogee",
    lines,
    totals: builderTotals(lines, true, 0),
    validUntilDate: "2026-11-23",
    ...overrides,
  };
}

describe("request bodies", () => {
  it("creates for the chosen recipient only (client, lead or new lead) and carries the case", () => {
    expect(buildCreatePayload(input())).toMatchObject({ clientId: "c1", leadId: undefined, newLead: undefined, subtotal: 385, gstAmount: 38.5, totalAmount: 423.5, serviceAddress: "8 Arden St" });
    expect(buildCreatePayload(input({ recipientMode: "lead" }))).toMatchObject({ clientId: undefined, leadId: "l1" });
    expect(buildCreatePayload(input({ recipientMode: "new", fromCaseId: "case1" }))).toMatchObject({ newLead: { name: "Olivia", email: "o@x.com" }, fromCaseId: "case1" });
    expect(buildCreatePayload(input()).notes).toBe('Deep clean for your property.\n[[META:{"extras":[]}]]');
    expect(buildCreatePayload(input()).validUntil).toBe(new Date("2026-11-23T23:59:59").toISOString());
  });

  it("edits as before: a lead-mode save unassigns the client and sends no lead", () => {
    const patch = buildEditPatch(input({ recipientMode: "lead" }));
    expect(patch.clientId).toBeNull();
    expect(patch).not.toHaveProperty("leadId");
    expect(buildEditPatch(input({ validUntilDate: "" })).validUntil).toBeNull();
  });

  it("writes META overrides only when set, and records where the pricing came from", () => {
    const meta = buildQuoteMeta({ model: "ROOMS", bedrooms: "2", bathrooms: "1", sqm: "0", extras: [{ id: "oven", label: "Oven (per oven)", price: 65, instructions: "" }], extraQty: () => 2, checklistTouched: false, editChecklist: null, quoteHeading: " Oven clean ", emailSubject: "", emailMessage: "", pricingSource: "rate-card" });
    expect(meta).toEqual({ bedrooms: 2, bathrooms: 1, extras: [{ id: "oven", label: "Oven (per oven)", instructions: "", qty: 2 }], quoteHeading: "Oven clean", pricingSource: "rate-card" });
    const unknown = buildQuoteMeta({ model: "HOURLY", bedrooms: "", bathrooms: "", sqm: "", extras: [], extraQty: () => 1, checklistTouched: false, editChecklist: null, quoteHeading: "", emailSubject: "", emailMessage: "", pricingSource: "unknown" });
    expect(unknown).toEqual({ extras: [] });
  });

  it("asks the discount route for the staged discount, or to clear a removed one", () => {
    expect(discountRequestBody({ code: "WELCOME10", label: "Discount · Welcome (WELCOME10)", amount: 10 }, false)).toEqual({ code: "WELCOME10" });
    expect(discountRequestBody({ code: null, label: "Discount", amount: 25 }, false)).toEqual({ amount: 25, label: "Discount" });
    expect(discountRequestBody(null, true)).toEqual({ clear: true });
    expect(discountRequestBody(null, false)).toBeNull();
  });
});

describe("seed from a stored quote", () => {
  const record = {
    id: "q1",
    status: "SENT",
    serviceType: "DEEP_CLEAN",
    subtotal: 435,
    gstAmount: 43.5,
    totalAmount: 478.5,
    notes: 'Scope text\n[[META:{"bedrooms":3,"extras":[{"id":"custom:fridge","label":"Fridge","instructions":"Inside"}],"pricingSource":"rate-card-edited"}]]',
    validUntil: new Date("2026-11-23T12:59:59Z"),
    createdAt: new Date("2026-11-09T03:00:00Z"),
    clientId: "c1",
    client: { id: "c1", name: "Harbour View Stays", email: null },
    lineItems: [line(400, "Deep clean"), line(80, "Fridge"), line(-45, "Discount · Welcome (WELCOME10)")],
    discountCode: "WELCOME10",
    requestedAddOns: [{ id: "r1", label: "Fridge clean", price: "45", requestedAt: "2026-11-10T08:12:00Z" }, { nope: true }],
  };

  it("normalises the record and splits extras and the discount back out", () => {
    const snapshot = snapshotFromRecord(record);
    expect(snapshot.client).toEqual({ id: "c1", name: "Harbour View Stays", email: "", address: null, suburb: null });
    expect(snapshot.requestedAddOns).toEqual([{ id: "r1", label: "Fridge clean", price: 45, note: undefined, requestedAt: "2026-11-10T08:12:00Z" }]);
    const seed = buildEditSeed(editSeedFromSnapshot(snapshot), []);
    expect(seed.lineItems.map((l) => l.label)).toEqual(["Deep clean"]);
    expect(seed.customExtras).toEqual([{ id: "custom:fridge", label: "Fridge", price: 80, instructions: "Inside" }]);
    expect(seed.seededDiscount).toEqual({ code: "WELCOME10", label: "Discount · Welcome (WELCOME10)", amount: 45 });
    expect(seed.bedrooms).toBe("3");
    expect(seed.notes).toBe("Scope text");
    expect(seed.pricingSource).toBe("rate-card-edited");
  });

  it("keeps notes prose and the META block apart for a locked save", () => {
    expect(notesProse(record.notes)).toBe("Scope text");
    expect(notesMetaBlock(record.notes)).toMatch(/^\[\[META:\{.*\}\]\]$/);
    expect(notesMetaBlock("plain")).toBe("");
  });
});
