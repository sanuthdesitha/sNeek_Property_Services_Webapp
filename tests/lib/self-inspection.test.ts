import { describe, it, expect } from "vitest";
import { JobType } from "@prisma/client";
import { composeFormSchema, type ProfileSelections } from "@/lib/checklists/compose";
import {
  SELF_INSPECTION_MODULE,
  SELF_INSPECTION_MODULE_KEY,
} from "@/lib/checklists/catalog";
import { deriveRotationalCompletion, stripRepeatSuffix } from "@/lib/accountability/rotation";

// ── Stub library builders (mirrors tests/lib/compose-frequency.test.ts) ──────

function stubItem(o: {
  key: string;
  label?: string;
  fieldType?: string;
  required?: boolean;
  frequency?: "EVERY_CLEAN" | "CONDITIONAL" | "ROTATIONAL";
  evidenceCategory?: string | null;
  severity?: string | null;
  jobTypes?: JobType[];
}) {
  return {
    id: o.key,
    key: o.key,
    label: o.label ?? o.key,
    instructions: null,
    imageUrl: null,
    videoUrl: null,
    fieldType: o.fieldType ?? "checkbox",
    required: o.required ?? false,
    minPhotos: null,
    stampTag: null,
    defaultOn: true,
    jobTypes: (o.jobTypes ?? []) as JobType[],
    appliesWhen: null,
    sortOrder: 0,
    isActive: true,
    evidenceCategory: o.evidenceCategory ?? null,
    frequency: o.frequency ?? "EVERY_CLEAN",
    conditionKey: null,
    rotationEveryNCleans: null,
    maxPhotos: null,
    severity: o.severity ?? null,
  };
}

function stubModule(key: string, items: ReturnType<typeof stubItem>[]) {
  return {
    id: key,
    key,
    title: key,
    category: "ROOM",
    description: null,
    appliesWhen: null,
    repeatBy: null,
    sortOrder: 0,
    isActive: true,
    items,
  };
}

function selectionsFor(modules: ReturnType<typeof stubModule>[]): ProfileSelections {
  const sel: ProfileSelections = { modules: {}, customItems: [] };
  for (const m of modules) {
    const items: ProfileSelections["modules"][string]["items"] = {};
    for (const it of m.items) items[it.key] = { enabled: true };
    sel.modules[m.key] = { enabled: true, items };
  }
  return sel;
}

const JOB = "GENERAL_CLEAN" as JobType;

// A final-inspection stub module built from the real catalog definition so the
// item count / keys / required flag stay in lock-step with the seed.
const finalInspection = stubModule(
  SELF_INSPECTION_MODULE_KEY,
  SELF_INSPECTION_MODULE.items.map((it) =>
    stubItem({
      key: it.key,
      label: it.label,
      fieldType: "checkbox",
      required: true,
      frequency: "EVERY_CLEAN",
      evidenceCategory: "FINAL",
      severity: it.severity,
      jobTypes: it.jobTypes,
    })
  )
);

const kitchen = stubModule("kitchen", [
  stubItem({ key: "kitchen.wipe", label: "Wipe benchtops" }),
]);

function sectionById(schema: { sections: unknown[] }, id: string): any {
  return (schema.sections as any[]).find((s) => s.id === id);
}
function sectionIndex(schema: { sections: unknown[] }, id: string): number {
  return (schema.sections as any[]).findIndex((s) => s.id === id);
}

describe("final self-inspection module — composition", () => {
  const library = [kitchen, finalInspection];
  const selections = selectionsFor(library);

  it("composes every applicable item as a required checkbox", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const section = sectionById(schema, SELF_INSPECTION_MODULE_KEY);
    expect(section).toBeTruthy();
    const applicable = SELF_INSPECTION_MODULE.items.filter(
      (it) => it.jobTypes.length === 0 || (it.jobTypes as string[]).includes(JOB)
    );
    expect(section.fields).toHaveLength(applicable.length);
    for (const field of section.fields) {
      expect(field.type).toBe("checkbox");
      expect(field.required).toBe(true);
    }
  });

  it("has no duplicate laundry-bag confirm and keeps linen items turnover-only", () => {
    // The bag confirmation lives in the job-start gate + laundry outcome flow —
    // never a third checkbox here.
    expect(SELF_INSPECTION_MODULE.items.map((it) => it.key)).not.toContain(
      "laundry-bagged-correctly"
    );
    // Linen items exist on turnovers only.
    const general = composeFormSchema(library, selections, JOB);
    const generalKeys = (sectionById(general, SELF_INSPECTION_MODULE_KEY)?.fields ?? []).map(
      (f: any) => f.id
    );
    expect(generalKeys).not.toContain("fresh-linen-verified");
    const turnover = composeFormSchema(library, selections, "AIRBNB_TURNOVER" as JobType);
    const turnoverKeys = (sectionById(turnover, SELF_INSPECTION_MODULE_KEY)?.fields ?? []).map(
      (f: any) => f.id
    );
    expect(turnoverKeys).toContain("fresh-linen-verified");
  });

  it("renders after room sections and before the sign-off", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const kitchenIdx = sectionIndex(schema, "kitchen");
    const finalIdx = sectionIndex(schema, SELF_INSPECTION_MODULE_KEY);
    const signoffIdx = sectionIndex(schema, "sign-off");
    expect(kitchenIdx).toBeGreaterThanOrEqual(0);
    expect(finalIdx).toBeGreaterThan(kitchenIdx);
    expect(signoffIdx).toBeGreaterThan(finalIdx);
  });

  it("carries a high sortOrder so it composes last among library modules", () => {
    // Documents the ordering approach: sortOrder > every room/feature/exception
    // module (max 800) so getChecklistLibrary (ordered by sortOrder) places it last.
    expect(SELF_INSPECTION_MODULE.sortOrder).toBeGreaterThan(800);
  });
});

describe("deriveRotationalCompletion", () => {
  it("strips per-room repeat suffixes back to item keys", () => {
    expect(stripRepeatSuffix("bedroom.rot_under_beds__bed2")).toBe("bedroom.rot_under_beds");
    expect(stripRepeatSuffix("bathroom.rot_deep_detail__bath3")).toBe("bathroom.rot_deep_detail");
    expect(stripRepeatSuffix("kitchen.rot_top_cupboards")).toBe("kitchen.rot_top_cupboards");
  });

  it("returns correct completed/all keys from schema + answers + media", () => {
    const sections = [
      {
        id: "kitchen",
        fields: [
          { id: "kitchen.rot_a", type: "photo", frequency: "ROTATIONAL" },
          { id: "kitchen.rot_b", type: "photo", frequency: "ROTATIONAL" },
          { id: "kitchen.rot_check", type: "checkbox", frequency: "ROTATIONAL" },
          { id: "kitchen.wipe", type: "checkbox" }, // not rotational → ignored
        ],
      },
      {
        id: "bedrooms-1",
        fields: [{ id: "bedroom.rot_under_beds__bed1", type: "photo", frequency: "ROTATIONAL" }],
      },
      {
        id: "bedrooms-2",
        fields: [{ id: "bedroom.rot_under_beds__bed2", type: "photo", frequency: "ROTATIONAL" }],
      },
    ];
    const answers = { "kitchen.rot_check": true };
    const media = {
      "kitchen.rot_a": ["s3/a.jpg"],
      "bedroom.rot_under_beds__bed2": ["s3/b.jpg"],
    };

    const { completedItemKeys, allRotationalItemKeys } = deriveRotationalCompletion(
      sections,
      answers,
      media
    );

    // Repeated bedroom fields fold onto a single item key.
    expect(allRotationalItemKeys.sort()).toEqual(
      ["bedroom.rot_under_beds", "kitchen.rot_a", "kitchen.rot_b", "kitchen.rot_check"].sort()
    );
    // rot_a (media), rot_check (answer true) and the bed2 upload complete;
    // rot_b has neither → not complete.
    expect(completedItemKeys.sort()).toEqual(
      ["bedroom.rot_under_beds", "kitchen.rot_a", "kitchen.rot_check"].sort()
    );
    expect(completedItemKeys).not.toContain("kitchen.rot_b");
  });

  it("returns empty sets when there are no rotational fields", () => {
    const sections = [{ id: "kitchen", fields: [{ id: "kitchen.wipe", type: "checkbox" }] }];
    const { completedItemKeys, allRotationalItemKeys } = deriveRotationalCompletion(
      sections,
      {},
      {}
    );
    expect(allRotationalItemKeys).toEqual([]);
    expect(completedItemKeys).toEqual([]);
  });
});
