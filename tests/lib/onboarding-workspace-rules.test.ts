// @vitest-environment node
/**
 * Onboarding workspace rules (2026-11-16): readiness (access and the main
 * job type's rate are required; a missing rate is never zero), per-field
 * patches, encrypted codes, client codes waiting for review, the room list
 * keeping the old bed text, and the standard stock lists.
 */
import { describe, expect, it } from "vitest";
import { computeReadiness, sectionMark, type ReadinessSnapshot } from "@/lib/onboarding/workspace/readiness";
import { accessEntryView, readWorkspace, emptyWorkspace } from "@/lib/onboarding/workspace/types";
import { applySectionPatch, sectionValues, setSkipped, type SurveyEditState } from "@/lib/onboarding/workspace/values";
import { stockStartingList, suggestedStartingList } from "@/lib/onboarding/workspace/stock-lists";
import { SECTION_PATCH_SCHEMAS, clientSaveSchema } from "@/lib/onboarding/workspace/schemas";

function snapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    clientLabel: "Harbour View Stays",
    propertyName: "Bondi Beach House",
    address: "12 Campbell Parade",
    suburb: "Bondi Beach",
    hasPin: true,
    jobTypes: ["AIRBNB_TURNOVER", "DEEP_CLEAN"],
    access: [accessEntryView({ id: "a1", kind: "LOCKBOX", where: "Side gate", codeCipher: "enc:x", photos: [], source: "ADMIN_CREATED", codeReviewedAt: "2026-11-16T00:00:00Z", codeReviewedById: "u1" })],
    legacyAccessCount: 0,
    rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 165, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: 60 }],
    bedrooms: 2,
    bathrooms: 2,
    roomCount: 3,
    laundryEnabled: true,
    laundryPartnerName: "CleanCo",
    stockRowCount: 0,
    checklistReviewed: true,
    photoTotal: 8,
    photoDone: 5,
    hasCalendarLink: true,
    houseRulesFilled: false,
    skipped: [],
    ...overrides,
  };
}

function state(): SurveyEditState {
  return {
    isNewClient: false, existingClientId: "c1", clientData: null,
    propertyName: "Bondi", propertyAddress: "12 Campbell Pde", propertySuburb: "Bondi Beach", propertyState: "NSW", propertyPostcode: "2026", propertyNotes: null,
    propertyType: "APARTMENT", floorCount: 1, sizeSqm: null, bedrooms: 2, bathrooms: 2, hasBalcony: false,
    estimatedCleanerCount: null, estimatedHours: null, icalUrl: null, icalProvider: "ICAL_OTHER", laundrySupplierId: null,
    meta: { selectedJobTypes: ["AIRBNB_TURNOVER"], scenarios: { bedConfig: "1 king, 2 singles", wifiNetwork: "Home" } },
    workspace: readWorkspace(null, "1 king, 2 singles"),
    appliances: [], specialRequests: [], laundryDetail: null,
  };
}

const ctx = (source: "ADMIN_CREATED" | "CLIENT_SUBMITTED" = "ADMIN_CREATED") => ({ source, actorUserId: source === "ADMIN_CREATED" ? "u1" : null, now: new Date("2026-11-16T03:00:00Z"), encrypt: (plain: string) => `enc:${Buffer.from(plain).toString("base64")}` });

describe("readiness", () => {
  it("is ready with client, name and address, a job type, access and the main rate", () => {
    const summary = computeReadiness(snapshot());
    expect(summary.ready).toBe(true);
    expect(summary.requiredDone).toBe(5);
    expect(summary.requiredTotal).toBe(5);
  });

  it("needs access before activation (owner default)", () => {
    const summary = computeReadiness(snapshot({ access: [], legacyAccessCount: 0 }));
    expect(summary.ready).toBe(false);
    expect(summary.missingRequired.map((item) => item.label)).toEqual(["Access"]);
    expect(summary.next?.section).toBe("access");
  });

  it("counts access saved by the earlier wizard", () => {
    expect(computeReadiness(snapshot({ access: [], legacyAccessCount: 2 })).ready).toBe(true);
  });

  it("needs a rate for the main job type; a missing rate is not zero and a zero is not a rate", () => {
    const missing = computeReadiness(snapshot({ rates: [] }));
    expect(missing.ready).toBe(false);
    expect(missing.missingRequired[0]).toMatchObject({ label: "Rate for Airbnb turnover", detail: "No rate yet" });
    const zero = computeReadiness(snapshot({ rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 0, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }] }));
    expect(zero.ready).toBe(false);
    const otherTypeOnly = computeReadiness(snapshot({ rates: [{ jobType: "DEEP_CLEAN", clientRate: 420, billingUnit: "PER_JOB", cleanerPayMode: "HOURLY", cleanerPay: 34 }] }));
    expect(otherTypeOnly.ready).toBe(false);
  });

  it("blocks activation while a code the client typed waits for review", () => {
    const entry = accessEntryView({ id: "c1", kind: "LOCKBOX", where: "", codeCipher: "enc:y", photos: [], source: "CLIENT_SUBMITTED", codeReviewedAt: null, codeReviewedById: null });
    expect(entry.codeNeedsReview).toBe(true);
    const summary = computeReadiness(snapshot({ access: [entry] }));
    expect(summary.ready).toBe(false);
    expect(summary.missingRequired[0].detail).toContain("to review");
  });

  it("weights required twice as much as recommended, and skipped recommended steps count as resolved", () => {
    const base = computeReadiness(snapshot({ rates: [] }));
    expect(base.percent).toBe(Math.round(((4 * 2 + base.recommendedDone) / 18) * 100));
    const skipped = computeReadiness(snapshot({ skipped: ["stock", "rules"] }));
    expect(skipped.items.find((item) => item.section === "stock")?.state).toBe("skipped");
    expect(skipped.recommendedDone).toBeGreaterThan(computeReadiness(snapshot()).recommendedDone);
    expect(sectionMark(skipped, "stock", false)).toBe("done");
  });

  it("marks a client-asked section with C until it is done", () => {
    const summary = computeReadiness(snapshot());
    expect(sectionMark(summary, "photos", true)).toBe("client");
    expect(sectionMark(summary, "pricing", false)).toBe("recommended");
    expect(sectionMark(computeReadiness(snapshot({ rates: [] })), "pricing", false)).toBe("required");
  });
});

describe("section patches", () => {
  it("changes only the fields sent", () => {
    const before = state();
    const result = applySectionPatch(before, "basics", { propertyName: "Bondi Beach House" }, ctx());
    expect(result.next.propertyName).toBe("Bondi Beach House");
    expect(result.next.propertyAddress).toBe(before.propertyAddress);
    expect(Object.keys(result.changes)).toEqual(["basics.propertyName"]);
  });

  it("stores codes encrypted and never puts a code value in the history", () => {
    const result = applySectionPatch(state(), "access", { entries: [{ id: "a1", kind: "LOCKBOX", where: "Side gate", photos: [], code: "4821" }] }, ctx());
    const stored = result.next.workspace.access[0];
    expect(stored.codeCipher).toBe(`enc:${Buffer.from("4821").toString("base64")}`);
    expect(stored.codeReviewedAt).not.toBeNull();
    expect(JSON.stringify(result.changes)).not.toContain("4821");
    expect(result.changes["access.code.a1"]).toEqual({ before: "[encrypted]", after: "[encrypted]" });
    expect(JSON.stringify(sectionValues(result.next).access)).not.toContain("enc:");
  });

  it("a code the client types is marked from the client and waits for the office", () => {
    const result = applySectionPatch(state(), "access", { entries: [{ id: "c-1", kind: "LOCKBOX", where: "", photos: [], code: "9911" }] }, ctx("CLIENT_SUBMITTED"));
    expect(result.next.workspace.access[0]).toMatchObject({ source: "CLIENT_SUBMITTED", codeReviewedAt: null });
    expect(accessEntryView(result.next.workspace.access[0]).codeNeedsReview).toBe(true);
  });

  it("keeps a stored code when an entry is saved without one", () => {
    const first = applySectionPatch(state(), "access", { entries: [{ id: "a1", kind: "LOCKBOX", where: "", photos: [], code: "4821" }] }, ctx());
    const second = applySectionPatch(first.next, "access", { entries: [{ id: "a1", kind: "LOCKBOX", where: "Side gate", photos: [] }] }, ctx());
    expect(second.next.workspace.access[0].codeCipher).toBe(first.next.workspace.access[0].codeCipher);
    expect(second.changes["access.code.a1"]).toBeUndefined();
  });

  it("the room note is the old bed configuration text, kept in both places", () => {
    const before = state();
    expect(sectionValues(before).rooms.roomNote).toBe("1 king, 2 singles");
    const result = applySectionPatch(before, "rooms", { roomNote: "1 king, 2 singles, travel cot" }, ctx());
    expect((result.next.meta.scenarios as Record<string, unknown>).bedConfig).toBe("1 king, 2 singles, travel cot");
    expect(result.next.workspace.rooms.note).toBe("1 king, 2 singles, travel cot");
  });

  it("house rules map pets, bins and parking to the existing scenario fields", () => {
    const result = applySectionPatch(state(), "rules", { hasPets: true, petDetails: "One cat", binDay: "Tue", hazards: "Steep driveway" }, ctx());
    expect(result.next.meta.scenarios).toMatchObject({ hasPets: true, petDetails: "One cat", binDay: "Tue" });
    expect(result.next.workspace.houseRules.hazards).toBe("Steep driveway");
  });

  it("skipping a recommended step is recorded on the workspace", () => {
    expect(setSkipped(state(), "stock", true).workspace.skipped).toEqual(["stock"]);
  });

  it("refuses unknown fields and a zero rate", () => {
    expect(SECTION_PATCH_SCHEMAS.basics.safeParse({ adminNotes: "x" }).success).toBe(false);
    expect(SECTION_PATCH_SCHEMAS.pricing.safeParse({ rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 0, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }] }).success).toBe(false);
    expect(SECTION_PATCH_SCHEMAS.pricing.safeParse({ rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: null, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }] }).success).toBe(true);
  });

  it("the client's save schema has no pricing, laundry partner, notes or form fields", () => {
    expect(clientSaveSchema.safeParse({ section: "pricing", rates: [] }).success).toBe(false);
    expect(clientSaveSchema.safeParse({ section: "rules", values: { specialNotes: "x" } }).success).toBe(false);
    expect(clientSaveSchema.safeParse({ section: "linen", values: { laundrySupplierId: "s1" } }).success).toBe(false);
    expect(clientSaveSchema.safeParse({ section: "linen", values: { linenSets: 3 } }).success).toBe(true);
  });
});

describe("rooms migration and stock lists", () => {
  it("carries old bed text into the room note when the workspace has none, without discarding it", () => {
    expect(readWorkspace(null, "2x Queen, 1x King").rooms.note).toBe("2x Queen, 1x King");
    expect(readWorkspace({ rooms: { list: [], note: "Edited note" } }, "Old text").rooms.note).toBe("Edited note");
    expect(readWorkspace(null, null).rooms.note).toBeNull();
  });

  it("never turns a missing number into zero", () => {
    const workspace = readWorkspace({ rates: [{ jobType: "DEEP_CLEAN", billingUnit: "PER_JOB" }], stock: { rows: [{ sku: "DEF-TP" }] }, clockInRadiusM: 0 });
    expect(workspace.rates[0].clientRate).toBeNull();
    expect(workspace.stock.rows[0].parLevel).toBeNull();
    expect(workspace.clockInRadiusM).toBeNull();
    expect(emptyWorkspace().rooms.sofaBeds).toBeNull();
  });

  it("offers one standard list for 1, 2 and 3+ bedrooms", () => {
    expect(suggestedStartingList(1)).toBe("ONE_BED");
    expect(suggestedStartingList(2)).toBe("TWO_BED");
    expect(suggestedStartingList(5)).toBe("THREE_PLUS");
    expect(suggestedStartingList(null)).toBe("ONE_BED");
    const one = stockStartingList("ONE_BED");
    const three = stockStartingList("THREE_PLUS");
    expect(one.map((row) => row.sku)).toEqual(three.map((row) => row.sku));
    expect(three.find((row) => row.sku === "DEF-TP")!.parLevel).toBeGreaterThan(one.find((row) => row.sku === "DEF-TP")!.parLevel!);
    expect(one.every((row) => typeof row.parLevel === "number" && typeof row.reorderAt === "number" && row.reorderAt <= row.parLevel!)).toBe(true);
  });
});
