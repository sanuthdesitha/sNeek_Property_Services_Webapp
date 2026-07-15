import { describe, it, expect } from "vitest";
import { JobType } from "@prisma/client";
import {
  composeFormSchema,
  buildDefaultSelections,
  withStandardSections,
  type ProfileSelections,
} from "@/lib/checklists/compose";
import { REPORTED_EXCEPTIONS_FIELD_ID } from "@/lib/checklists/catalog";

// ── Stub library builders ───────────────────────────────────────────────────

function stubItem(o: {
  key: string;
  label?: string;
  fieldType?: string;
  required?: boolean;
  minPhotos?: number | null;
  maxPhotos?: number | null;
  stampTag?: string | null;
  severity?: string | null;
  evidenceCategory?: string | null;
  frequency?: "EVERY_CLEAN" | "CONDITIONAL" | "ROTATIONAL";
  conditionKey?: string | null;
  rotationEveryNCleans?: number | null;
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
    minPhotos: o.minPhotos ?? null,
    stampTag: o.stampTag ?? null,
    defaultOn: true,
    jobTypes: [] as JobType[],
    appliesWhen: null,
    sortOrder: 0,
    isActive: true,
    evidenceCategory: o.evidenceCategory ?? null,
    frequency: o.frequency ?? "EVERY_CLEAN",
    conditionKey: o.conditionKey ?? null,
    rotationEveryNCleans: o.rotationEveryNCleans ?? null,
    maxPhotos: o.maxPhotos ?? null,
    severity: o.severity ?? null,
  };
}

function stubModule(key: string, items: ReturnType<typeof stubItem>[], appliesWhen: unknown = null) {
  return {
    id: key,
    key,
    title: key,
    category: "ROOM",
    description: null,
    appliesWhen,
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

/** Depth-first search for a field id across sections + one level of children. */
function findField(schema: { sections: unknown[] }, id: string): any {
  for (const section of schema.sections as any[]) {
    for (const field of section.fields ?? []) {
      if (field.id === id) return field;
      for (const child of field.children ?? []) {
        if (child.id === id) return child;
      }
    }
  }
  return undefined;
}

const JOB = "GENERAL_CLEAN" as JobType;

// ── Fixtures ────────────────────────────────────────────────────────────────

const kitchen = stubModule("kitchen", [
  stubItem({ key: "kitchen.wipe", label: "Wipe benchtops" }),
  stubItem({
    key: "kitchen.rot",
    label: "Top of cupboards",
    fieldType: "photo",
    minPhotos: 1,
    stampTag: "after",
    severity: "medium",
    evidenceCategory: "KITCHEN",
    frequency: "ROTATIONAL",
    rotationEveryNCleans: 4,
  }),
  stubItem({
    key: "kitchen.maxp",
    label: "Detail photo",
    fieldType: "photo",
    minPhotos: 1,
    maxPhotos: 3,
  }),
]);

const exceptions = stubModule("exceptions", [
  stubItem({
    key: "exceptions.damage",
    label: "Damage — photo evidence",
    fieldType: "photo",
    minPhotos: 1,
    stampTag: "damage",
    frequency: "CONDITIONAL",
    conditionKey: "damage",
    severity: "high",
  }),
]);

const library = [kitchen, exceptions];
const selections = selectionsFor(library);

describe("composeFormSchema — ROTATIONAL frequency", () => {
  it("excludes rotational items when no due-map is passed", () => {
    const schema = composeFormSchema(library, selections, JOB);
    expect(findField(schema, "kitchen.wipe")).toBeTruthy();
    expect(findField(schema, "kitchen.rot")).toBeUndefined();
  });

  it("excludes rotational items when the due-map marks them not due", () => {
    const schema = composeFormSchema(library, selections, JOB, undefined, {
      rotationDue: { "kitchen.rot": false },
    });
    expect(findField(schema, "kitchen.rot")).toBeUndefined();
  });

  it("includes rotational items when the due-map marks them due", () => {
    const schema = composeFormSchema(library, selections, JOB, undefined, {
      rotationDue: { "kitchen.rot": true },
    });
    const field = findField(schema, "kitchen.rot");
    expect(field).toBeTruthy();
    expect(field.type).toBe("photo");
    expect(field.severity).toBe("medium");
    expect(field.evidenceCategory).toBe("KITCHEN");
  });
});

describe("composeFormSchema — CONDITIONAL frequency", () => {
  it("emits a conditional item hidden behind the reported-exceptions field", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const field = findField(schema, "exceptions.damage");
    expect(field).toBeTruthy();
    expect(field.conditional).toBeTruthy();
    expect(field.conditional.fieldId).toBe(REPORTED_EXCEPTIONS_FIELD_ID);
    expect(field.conditional.operator).toBe("oneOf");
    // not required until the exception is reported
    expect(field.required).toBeFalsy();
  });

  it("makes a QA-active exception item unconditional + required", () => {
    const schema = composeFormSchema(library, selections, JOB, undefined, {
      activeConditionKeys: ["damage"],
    });
    const field = findField(schema, "exceptions.damage");
    expect(field).toBeTruthy();
    expect(field.conditional).toBeUndefined();
    expect(field.required).toBe(true);
  });
});

describe("composeFormSchema — field metadata mapping", () => {
  it("maps maxPhotos → maxFiles", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const field = findField(schema, "kitchen.maxp");
    expect(field).toBeTruthy();
    expect(field.maxFiles).toBe(3);
  });
});

describe("composeFormSchema — standard exceptions section", () => {
  it("adds exactly one Report-an-exception section and is idempotent", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const exceptionFields = (schema.sections as any[]).filter((s) =>
      (s.fields ?? []).some((f: any) => f.id === REPORTED_EXCEPTIONS_FIELD_ID)
    );
    expect(exceptionFields).toHaveLength(1);

    // Re-wrapping must not add a second exceptions section (or a second sign-off).
    const rewrapped = withStandardSections(schema.sections);
    const again = (rewrapped as any[]).filter((s) =>
      (s.fields ?? []).some((f: any) => f.id === REPORTED_EXCEPTIONS_FIELD_ID)
    );
    expect(again).toHaveLength(1);
  });

  it("still emits arrival evidence even when a conditional before-photo exists", () => {
    const schema = composeFormSchema(library, selections, JOB);
    const hasArrival = (schema.sections as any[]).some((s) => s.id === "arrival-evidence");
    expect(hasArrival).toBe(true);
  });
});

describe("buildDefaultSelections — sofaBedCount gt rule", () => {
  const sofaModule = stubModule(
    "sofabed",
    [stubItem({ key: "sofabed.linen", label: "Sofa-bed linen" })],
    { propertyField: "sofaBedCount", operator: "gt", value: 0 }
  );

  const baseProperty = {
    hasBalcony: false,
    bedrooms: 2,
    bathrooms: 1,
    laundryEnabled: true,
    inventoryEnabled: false,
    features: {},
  };

  it("enables the sofa-bed module when sofaBedCount > 0", () => {
    const sel = buildDefaultSelections([sofaModule] as any, { ...baseProperty, sofaBedCount: 1 });
    expect(sel.modules.sofabed.enabled).toBe(true);
  });

  it("disables the sofa-bed module when sofaBedCount is 0", () => {
    const sel = buildDefaultSelections([sofaModule] as any, { ...baseProperty, sofaBedCount: 0 });
    expect(sel.modules.sofabed.enabled).toBe(false);
  });
});
