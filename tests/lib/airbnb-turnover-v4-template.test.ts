// @vitest-environment node
// "Airbnb Turnover v4 — Hotel standard" (docs/forms/airbnb-turnover-v4.json,
// 2026-11-28): the file the Forms library imports as a draft. Runs it through
// the app's own import parser, strict save check, library Checks and lint,
// then the cleaner-side rules ("Test as cleaner") on sample properties (1-bed,
// 3-bed/2-bath, with and without live plants), and the authoring rules the
// form relies on (unique keys, live conditions, minimum media, a required
// proof in every section, device questions the device check recognises).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "@/lib/forms/template-transfer";
import { validateFormSchemaForSave, isSupportedPropertyConditionKey } from "@/lib/forms/template-schema";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import { lintTemplateSchema } from "@/lib/forms/lint-template";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { expandRepeatedSections } from "@/lib/forms/repeat-sections";
import { runFormTest } from "@/lib/forms/test-run";
import { isDeviceStatusField, withDeviceApplicability } from "@/lib/forms/device-status";
import { withDeviceChargingEvidence } from "@/lib/forms/device-charging";
import { isBalconyLikeTemplateNode } from "@/lib/forms/visibility";
import { SELF_INSPECTION_SECTION_ID } from "@/lib/forms/self-inspection";
import { isUploadFieldType, isReadOnlyFieldType } from "@/lib/forms/field-types";
import { bindStockCountItemsBySku } from "@/lib/forms/stock-item-binding";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";

const FILE = path.resolve(__dirname, "../../docs/forms/airbnb-turnover-v4.json");
const text = readFileSync(FILE, "utf8");
const file = JSON.parse(text) as { forms: Array<{ name: string; serviceType: string; schema: FormSchema }> };
const form = file.forms[0];
const schema = form.schema;

type Answers = Record<string, unknown>;
type FieldVisit = { field: FormField; section: FormSection; isChild: boolean };

function eachField(target: FormSchema): FieldVisit[] {
  return target.sections.flatMap((section) =>
    section.fields.flatMap((field) => [
      { field, section, isChild: false },
      ...(field.children ?? []).map((child) => ({ field: child, section, isChild: true })),
    ]),
  );
}

const ALL = eachField(schema);
const ALL_IDS = new Set(ALL.map((entry) => entry.field.id));

/** Yes / No questions where "Yes" reports a problem; an honest clean answers No. */
const PROBLEM_QUESTIONS = new Set([
  "start-guest-present",
  "start-unused",
  "start-pool-spa",
  "arrival-damage",
  "arrival-left-items",
  "kitchen-food-left",
  "bath-leaks",
  "bed-protector-stain",
  "bed-items-found",
  "balcony-butts-bottles",
  "utility-dirty-left",
  "supplies-low",
  "final-mismatch",
  "exit-maintenance",
  "exit-office-note",
]);

const baseId = (id: string) => id.replace(/__(?:bed|bath)\d+$/, "");

/** Answers an honest cleaner gives on a clean with no problems. */
function honestAnswers(checked: FormSchema): { answers: Answers; uploadCounts: Record<string, number> } {
  const answers: Answers = {};
  const uploadCounts: Record<string, number> = {};
  for (const { field } of eachField(checked)) {
    if (isUploadFieldType(field.type)) {
      uploadCounts[field.id] = Math.max(1, field.minPhotos ?? 1);
      continue;
    }
    switch (field.type) {
      case "yesno":
        answers[field.id] = !PROBLEM_QUESTIONS.has(baseId(field.id));
        break;
      case "select":
        answers[field.id] = field.options?.[0];
        break;
      case "multiselect":
        if (field.id === "arrival-signs") answers[field.id] = ["None of these"];
        break;
      case "checkbox":
        answers[field.id] = true;
        break;
      case "number":
        answers[field.id] = 3;
        break;
      case "stock_count":
        answers[field.id] = { itemId: field.stockItemId, count: 20 };
        break;
      case "signature":
        answers[field.id] = "data:image/png;base64,iVBORw0KGgo=";
        break;
      default:
        break;
    }
  }
  return { answers, uploadCounts };
}

/** Stated in docs/forms/airbnb-turnover-v4.md. */
const STANDARD_TWO_BED_PHOTOS = 59;
const PHOTOS_PER_BEDROOM = 6;
const PHOTOS_PER_BATHROOM = 11;

const TWO_BED = { bedrooms: 2, bathrooms: 1, hasBalcony: true, inventoryEnabled: true, laundryEnabled: true, sofaBedCount: 0, features: { livePlants: false } };

function checked(property: Record<string, unknown>): FormSchema {
  return expandRepeatedSections(normalizeFormSchema(schema), property) as FormSchema;
}

function testRun(property: Record<string, unknown>, answers: Answers, uploadCounts: Record<string, number>) {
  return runFormTest({ schema, answers, uploadCounts, property, requiredChecklistTicksBlockSubmit: false });
}

describe("Airbnb Turnover v4 — the app's own import and validators", () => {
  it("is one AIRBNB_TURNOVER form the Forms library import accepts as a draft", () => {
    expect(file.forms).toHaveLength(1);
    expect(form.name).toBe("Airbnb Turnover v4 — Hotel standard");
    const parsed = parseImportFile(text, ["AIRBNB_TURNOVER"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.forms[0].refused).toBeNull();
    expect(parsed.forms[0].renamedIds).toBe(0);
    expect(parsed.forms[0].checks.errors).toBe(0);
  });

  it("passes the strict save check, the library Checks and lint with no errors", () => {
    expect(validateFormSchemaForSave(schema)).toEqual({ ok: true, issues: [] });
    const checks = checkTemplateSchema(schema);
    expect(checks.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(lintTemplateSchema(schema).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("owns its standard sections, so nothing is injected or doubled at read time", () => {
    expect(schema.standardSections).toBe(false);
    expect(normalizeFormSchema(schema).sections.map((section: FormSection) => section.id)).toEqual(schema.sections.map((section) => section.id));
    const arrival = schema.sections.find((section) => section.id === "arrival-evidence");
    expect(arrival?.fields.some((field) => field.type === "video" && field.required && !field.conditional)).toBe(true);
    expect(ALL.some(({ field }) => field.type === "signature" && field.required)).toBe(true);
  });
});

describe("Airbnb Turnover v4 — authoring rules", () => {
  it("has unique keys, before and after per-room expansion", () => {
    expect(ALL_IDS.size).toBe(ALL.length);
    expect(new Set(schema.sections.map((section) => section.id)).size).toBe(schema.sections.length);
    const big = eachField(checked({ ...TWO_BED, bedrooms: 4, bathrooms: 3 }));
    expect(new Set(big.map((entry) => entry.field.id)).size).toBe(big.length);
  });

  it("points every condition at an existing key or a supported property fact", () => {
    const conditions = [
      ...schema.sections.map((section) => ({ owner: section.id, condition: section.conditional })),
      ...ALL.map(({ field }) => ({ owner: field.id, condition: field.conditional })),
    ].filter((entry) => entry.condition);
    expect(conditions.length).toBeGreaterThan(20);
    for (const { owner, condition } of conditions) {
      if (condition && "propertyField" in condition) {
        expect(isSupportedPropertyConditionKey(condition.propertyField), owner).toBe(true);
      } else if (condition && "fieldId" in condition) {
        expect(ALL_IDS.has(condition.fieldId), `${owner} → ${condition.fieldId}`).toBe(true);
        expect(condition.fieldId, owner).not.toBe(owner);
        // Rules on a "laundry" key fall back to the laundry outcome when unanswered.
        expect(condition.fieldId, owner).not.toMatch(/laundry/i);
      }
    }
  });

  it("gives every required upload a minimum and every required photo a stamp tag", () => {
    for (const { field } of ALL) {
      if (!isUploadFieldType(field.type) || !field.required) continue;
      if (field.type === "photo") {
        expect(field.minPhotos ?? 0, field.id).toBeGreaterThanOrEqual(1);
        expect(field.stampTag, field.id).toBeTruthy();
      } else {
        expect(field.type, field.id).toBe("video");
      }
    }
  });

  it("gives every section at least one required proof that is always shown inside it", () => {
    for (const section of schema.sections) {
      const proof = section.fields.filter((field) => field.required && !field.conditional && !isReadOnlyFieldType(field.type) && !field.frequency);
      expect(proof.length, section.id).toBeGreaterThan(0);
    }
  });

  it("has no orphan sections: each has fields and any answer rule watches an earlier section", () => {
    schema.sections.forEach((section, index) => {
      expect(section.fields.length, section.id).toBeGreaterThan(0);
      const rule = section.conditional;
      if (rule && "fieldId" in rule) {
        const owner = schema.sections.findIndex((candidate) => eachField({ sections: [candidate] }).some(({ field }) => field.id === rule.fieldId));
        expect(owner, section.id).toBeGreaterThanOrEqual(0);
        expect(owner, section.id).toBeLessThan(index);
      }
    });
  });

  it("keeps per-room answer rules inside their room and never watches a per-room key from outside", () => {
    const roomKeys = new Set(schema.sections.filter((section) => section.repeatBy).flatMap((section) => eachField({ sections: [section] }).map(({ field }) => field.id)));
    for (const section of schema.sections) {
      for (const { field } of eachField({ sections: [section] })) {
        const rule = field.conditional;
        if (rule && "fieldId" in rule && roomKeys.has(rule.fieldId)) {
          expect(section.repeatBy, field.id).toBeTruthy();
        }
      }
    }
  });

  it("avoids the read-time traps: balcony wording, device detection, the self-inspection id", () => {
    for (const { field, section } of ALL) {
      if (isBalconyLikeTemplateNode(field)) {
        const gated = section.conditional ?? field.conditional;
        expect(gated && "propertyField" in gated && gated.propertyField, field.id).toBe("hasBalcony");
      }
      if (isDeviceStatusField(field)) expect(field.deviceStatus, field.id).toBe(true);
    }
    expect(schema.sections.map((section) => section.id)).not.toContain(SELF_INSPECTION_SECTION_ID);
  });

  it("writes plain AI acceptance criteria on the key photos and keeps them within the 1000-character limit", () => {
    const photos = ALL.filter(({ field }) => field.type === "photo");
    for (const { field } of photos) {
      if (field.severity === "high") expect(field.aiCriteria, field.id).toBeTruthy();
      if (field.aiCriteria) expect(field.aiCriteria.length, field.id).toBeLessThanOrEqual(1000);
    }
    expect(photos.filter(({ field }) => field.aiCriteria).length).toBeGreaterThanOrEqual(45);
  });

  it("names stock items by SKU so they can be bound to each database's items", () => {
    const counts = ALL.filter(({ field }) => field.type === "stock_count").map(({ field }) => field);
    expect(counts.length).toBe(9);
    for (const field of counts) {
      expect(field.stockItemId, field.id).toMatch(/^DEF-[A-Z-]+$/);
      expect(field.stockItemName, field.id).toContain("pick item");
      expect(field.effects?.[0]).toMatchObject({ kind: "urgent-stock-below" });
    }
  });
});

const PLANTS_TWO_BED = { ...TWO_BED, features: { livePlants: true } };

function blockingIds(property: Record<string, unknown>, answers: Answers, uploadCounts: Record<string, number>): string[] {
  return testRun(property, answers, uploadCounts).problems.filter((problem) => problem.level === "blocking").map((problem) => problem.fieldId);
}

/** Every-clean photos for a property when nothing is wrong (rotating close-ups and videos apart). */
function everyCleanPhotos(property: Record<string, unknown>): { photos: number; rotating: number; videos: string[] } {
  const view = checked(property);
  const { answers, uploadCounts } = honestAnswers(view);
  const rotating = new Set(eachField(view).filter(({ field }) => field.frequency === "ROTATIONAL").map(({ field }) => field.id));
  const visibleUploads = runFormTest({ schema, answers, uploadCounts: {}, property, requiredChecklistTicksBlockSubmit: false })
    .problems.filter((problem) => problem.rule === "upload" || problem.rule === "minimum").map((problem) => problem.fieldId);
  const everyClean = visibleUploads.filter((id) => !rotating.has(id));
  return {
    photos: everyClean.filter((id) => !id.includes("video")).reduce((sum, id) => sum + (uploadCounts[id] ?? 0), 0),
    rotating: rotating.size,
    videos: everyClean.filter((id) => id.includes("video")),
  };
}

describe("Airbnb Turnover v4 — as a cleaner meets it", () => {
  it("lets an honest clean of a standard 2-bed submit, and blocks an empty form", () => {
    for (const property of [TWO_BED, PLANTS_TWO_BED]) {
      const view = checked(property);
      const { answers, uploadCounts } = honestAnswers(view);
      expect(blockingIds(property, answers, uploadCounts)).toEqual([]);
    }
    expect(blockingIds(TWO_BED, {}, {})).toEqual(expect.arrayContaining([
      "arrival-walkthrough-video", "exit-walkthrough-video", "bed-protector__bed1", "bed-protector__bed2", "bed-made__bed1",
      "bath-toilet", "bath-seal", "kitchen-drain-tap", "devices-ring", "devices-minut", "supplies-toilet-paper", "final-walked", "exit-signature",
    ]));
  });

  it("scales the room proofs with the property and hides what does not apply", () => {
    const ids = (property: Record<string, unknown>) => new Set(eachField(checked(property)).map(({ field }) => field.id));
    const oneBed = ids({ bedrooms: 1, bathrooms: 1 });
    const large = ids({ bedrooms: 3, bathrooms: 2 });
    expect(["bed-protector", "bed-made", "bath-toilet", "bath-seal"].every((id) => oneBed.has(id))).toBe(true);
    expect(oneBed.has("bed-protector__bed2")).toBe(false);
    expect(["bed-protector__bed1", "bed-protector__bed2", "bed-protector__bed3", "bath-toilet__bath1", "bath-toilet__bath2", "bath-seal__bath2"].every((id) => large.has(id))).toBe(true);
    // A property without a balcony, stock tracking, pool or live plants never asks about them.
    const bare = testRun({ bedrooms: 1, bathrooms: 1, hasBalcony: false, inventoryEnabled: false, laundryEnabled: false, features: {} }, {}, {});
    const asked = new Set(bare.problems.map((problem) => problem.fieldId));
    for (const id of ["balcony-area", "lockup-balcony-door", "stock-toilet-paper", "pool-area", "plants-soil", "plants-photo"]) expect(asked.has(id), id).toBe(false);
    // Low supplies and the toilet paper proof are asked on every clean, stock tracked or not.
    expect(asked.has("supplies-low")).toBe(true);
    expect(asked.has("supplies-toilet-paper")).toBe(true);
  });

  it("asks the plant questions only at properties marked with live plants, and never when that is unknown", () => {
    const asked = (property: Record<string, unknown>) => new Set(testRun(property, {}, {}).problems.map((problem) => problem.fieldId));
    for (const property of [{ bedrooms: 1, bathrooms: 1, features: { livePlants: true } }, { bedrooms: 3, bathrooms: 2, features: { livePlants: true } }, { bedrooms: 1, bathrooms: 1, hasLivePlants: true }]) {
      const ids = asked(property);
      expect(ids.has("plants-soil")).toBe(true);
      expect(ids.has("plants-photo")).toBe(true);
    }
    for (const property of [{ bedrooms: 1, bathrooms: 1, features: { livePlants: false } }, { bedrooms: 3, bathrooms: 2 }]) {
      const ids = asked(property);
      expect(ids.has("plants-soil")).toBe(false);
      expect(ids.has("plants-photo")).toBe(false);
    }
  });

  it("asks for evidence only when the answer needs it", () => {
    const view = checked(PLANTS_TWO_BED);
    const { answers, uploadCounts } = honestAnswers(view);
    const conditionalUploads = ["start-unused-photos", "arrival-mess-photos", "arrival-signs-photos", "bath-mould-photo", "plants-unwell-photo", "pool-area"];
    const counts = Object.fromEntries(Object.entries(uploadCounts).filter(([id]) => !conditionalUploads.includes(id)));
    const messy = {
      ...answers,
      "start-unused": true,
      "start-unused-answer": undefined,
      "arrival-mess-level": "Excessive",
      "arrival-signs": ["Smoke or vape smell"],
      "bath-mould-gone": false,
      "bath-leaks": true,
      "plants-soil": "Plant looks unwell",
      "supplies-low": true,
      "exit-maintenance": true,
      "start-pool-spa": true,
      "pool-gate-latch": undefined,
    };
    expect(blockingIds(PLANTS_TWO_BED, messy, counts)).toEqual(expect.arrayContaining([
      "start-unused-photos", "start-unused-answer", "start-unused-who", "arrival-mess-photos", "arrival-signs-photos",
      "bath-mould-photo", "bath-mould-detail", "bath-leaks-detail", "plants-unwell-photo", "plants-unwell-note",
      "supplies-low-which", "exit-maintenance-detail", "pool-area", "pool-gate-latch",
    ]));
    // Changing "looks unused" back to No drops its follow-ups, even with an answer left behind.
    expect(blockingIds(PLANTS_TWO_BED, { ...answers, "start-unused": false, "start-unused-answer": "Clean as normal" }, uploadCounts)).toEqual([]);
    // Arrival damage hands over to the existing damage report instead of collecting it here.
    expect(testRun(TWO_BED, { ...answers, "arrival-damage": true }, uploadCounts).wouldHappen.join(" ")).toMatch(/damage report/i);
  });

  it("keeps follow-up rules on their own parent, so a stale sibling answer never shows a question", () => {
    for (const section of schema.sections) {
      for (const parent of section.fields) {
        for (const child of parent.children ?? []) {
          const rule = child.conditional;
          if (rule && "fieldId" in rule) expect(rule.fieldId, child.id).toBe(parent.id);
        }
      }
    }
  });

  it("states the photo load for the owner's guide: a 2-bed, 1-bath with a balcony", () => {
    const standard = everyCleanPhotos(TWO_BED);
    expect(standard.videos).toEqual(["arrival-walkthrough-video", "exit-walkthrough-video"]);
    expect(standard.photos).toBe(STANDARD_TWO_BED_PHOTOS);
    expect(standard.rotating).toBe(6);
    expect(everyCleanPhotos(PLANTS_TWO_BED).photos).toBe(STANDARD_TWO_BED_PHOTOS + 1);
    expect(everyCleanPhotos({ ...TWO_BED, bedrooms: 3 }).photos - standard.photos).toBe(PHOTOS_PER_BEDROOM);
    expect(everyCleanPhotos({ ...TWO_BED, bathrooms: 2 }).photos - standard.photos).toBe(PHOTOS_PER_BATHROOM);
  });
});

describe("Airbnb Turnover v4 — devices", () => {
  const devices = ALL.filter(({ field }) => isDeviceStatusField(field)).map(({ field }) => field.id);

  it("asks Ring and Minut on every clean as device checks the device check recognises", () => {
    expect(devices).toEqual(expect.arrayContaining(["devices-ring", "devices-minut", "lockup-smoke-alarm", "lockup-appliances-off"]));
    const section = schema.sections.find((candidate) => candidate.id === "v4-devices");
    expect(section?.conditional).toBeUndefined();
    for (const id of ["devices-ring", "devices-minut"]) {
      const field = section?.fields.find((candidate) => candidate.id === id);
      expect(field, id).toMatchObject({ type: "yesno", required: true, deviceStatus: true });
      expect(field?.conditional, id).toBeUndefined();
    }
  });

  it("is reused by the Jackson charging rule (proof photo on Yes) instead of a second outcome question", () => {
    const withCharging = withDeviceChargingEvidence(schema, { jobType: "AIRBNB_TURNOVER", isRework: false, property: { name: "Jackson P1" } });
    const added = withCharging.sections.find((section) => section.id === "jackson-device-charging-v1");
    expect(added?.fields.map((field) => field.id)).toEqual(["jackson-device-charging-v1-ring-proof", "jackson-device-charging-v1-minut-proof"]);
    expect(added?.fields.map((field) => field.conditional)).toEqual([
      { fieldId: "devices-ring", operator: "equals", value: true },
      { fieldId: "devices-minut", operator: "equals", value: true },
    ]);
    // Other properties are untouched by the Jackson rule.
    expect(withDeviceChargingEvidence(schema, { jobType: "AIRBNB_TURNOVER", isRework: false, property: { name: "Harbour View" } })).toBe(schema);
    // Property 3's removed Ring camera is taken out at read time, Minut stays.
    const p3 = withDeviceApplicability(schema, { name: "Jackson P3" });
    const p3Ids = eachField(p3 as FormSchema).map(({ field }) => field.id);
    expect(p3Ids).not.toContain("devices-ring");
    expect(p3Ids).toContain("devices-minut");
  });
});

describe("Airbnb Turnover v4 — stock items by SKU", () => {
  it("binds every SKU in the v4 file when the default items exist", () => {
    const skus = ALL.filter(({ field }) => field.type === "stock_count").map(({ field }) => String(field.stockItemId));
    const catalogue = skus.map((sku, index) => ({ id: `id-${index}`, sku, name: sku, unit: null, isActive: true }));
    const result = bindStockCountItemsBySku(schema, catalogue);
    expect(result.missing).toEqual([]);
    expect(result.bound).toHaveLength(skus.length);
    expect(validateFormSchemaForSave(result.schema).ok).toBe(true);
  });
});
