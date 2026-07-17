import { describe, it, expect } from "vitest";
import {
  sanitizePropertyFormConfig,
  getEffectiveRequired,
  isSystemFieldVisible,
  isCustomFieldVisible,
  isCustomFieldRequired,
  collectMissingRequired,
  pruneCustomValues,
  type PropertyFormConfig,
} from "@/lib/property-form/config";

function cfg(partial: Partial<PropertyFormConfig>): PropertyFormConfig {
  return { version: 1, systemFields: {}, customFields: [], ...partial };
}

// Locked core fields are always required — supply them so tests isolate the
// behaviour under test rather than tripping on blank core fields.
const CORE = { clientId: "c1", name: "Beach House", address: "1 Ocean Rd", suburb: "Bondi" };

describe("sanitizePropertyFormConfig", () => {
  it("drops unknown system fields and clamps locked fields to always-required", () => {
    const out = sanitizePropertyFormConfig({
      systemFields: {
        bogusField: { required: true },
        clientId: { hidden: true, required: false }, // locked → must be stripped
        postcode: { required: true },
      },
      customFields: [{ id: "cf1", label: "Wifi", type: "text" }],
    });
    expect(out.systemFields.bogusField).toBeUndefined();
    expect(out.systemFields.clientId.hidden).toBeUndefined();
    expect(out.systemFields.clientId.required).toBeUndefined();
    expect(out.systemFields.postcode.required).toBe(true);
    expect(out.customFields).toHaveLength(1);
  });

  it("dedupes custom field ids and defaults unknown types to text", () => {
    const out = sanitizePropertyFormConfig({
      customFields: [
        { id: "a", label: "One", type: "banana" },
        { id: "a", label: "Dup", type: "text" },
        { id: "b", label: "", type: "text" }, // no label → dropped
      ],
    });
    expect(out.customFields.map((f) => f.id)).toEqual(["a"]);
    expect(out.customFields[0].type).toBe("text");
  });
});

describe("getEffectiveRequired", () => {
  it("locked core fields are always required regardless of config", () => {
    const config = cfg({});
    expect(getEffectiveRequired("clientId", config, {})).toBe(true);
    expect(getEffectiveRequired("address", config, {})).toBe(true);
  });

  it("honours required/optional overrides for toggleable fields", () => {
    expect(getEffectiveRequired("postcode", cfg({ systemFields: { postcode: { required: true } } }), {})).toBe(true);
    expect(getEffectiveRequired("postcode", cfg({}), {})).toBe(false);
  });

  it("a required field whose condition is unmet is not required", () => {
    const config = cfg({
      systemFields: {
        postcode: { required: true, conditional: { fieldId: "hasBalcony", operator: "equals", value: true } },
      },
    });
    expect(getEffectiveRequired("postcode", config, { hasBalcony: false })).toBe(false);
    expect(getEffectiveRequired("postcode", config, { hasBalcony: true })).toBe(true);
  });

  it("a hidden field is never required", () => {
    const config = cfg({ systemFields: { postcode: { hidden: true, required: true } } });
    expect(getEffectiveRequired("postcode", config, {})).toBe(false);
  });
});

describe("isSystemFieldVisible", () => {
  it("hidden fields are invisible; locked fields cannot be hidden", () => {
    expect(isSystemFieldVisible("postcode", cfg({ systemFields: { postcode: { hidden: true } } }), {})).toBe(false);
    // locked clientId ignores a hidden flag (sanitize would strip it anyway)
    expect(isSystemFieldVisible("clientId", cfg({ systemFields: { clientId: { hidden: true } } }), {})).toBe(true);
  });

  it("evaluates show-when conditions (equals / answered / oneOf)", () => {
    const equals = cfg({ systemFields: { state: { conditional: { fieldId: "hasBalcony", operator: "equals", value: true } } } });
    expect(isSystemFieldVisible("state", equals, { hasBalcony: true })).toBe(true);
    expect(isSystemFieldVisible("state", equals, { hasBalcony: false })).toBe(false);

    const answered = cfg({ systemFields: { state: { conditional: { fieldId: "postcode", operator: "answered" } } } });
    expect(isSystemFieldVisible("state", answered, { postcode: "2000" })).toBe(true);
    expect(isSystemFieldVisible("state", answered, { postcode: "" })).toBe(false);

    const oneOf = cfg({ systemFields: { state: { conditional: { fieldId: "bedrooms", operator: "oneOf", value: ["2", "3"] } } } });
    expect(isSystemFieldVisible("state", oneOf, { bedrooms: "3" })).toBe(true);
    expect(isSystemFieldVisible("state", oneOf, { bedrooms: "1" })).toBe(false);
  });
});

describe("custom fields — yes/no reveals a follow-up", () => {
  const config = cfg({
    customFields: [
      { id: "hasPool", label: "Has pool?", type: "yesno" },
      { id: "poolNotes", label: "Pool notes", type: "text", required: true, conditional: { fieldId: "hasPool", operator: "equals", value: true } },
    ],
  });

  it("follow-up is hidden and not required until the toggle is Yes", () => {
    const notes = config.customFields[1];
    expect(isCustomFieldVisible(notes, { hasPool: false })).toBe(false);
    expect(isCustomFieldRequired(notes, { hasPool: false })).toBe(false);
    expect(isCustomFieldVisible(notes, { hasPool: true })).toBe(true);
    expect(isCustomFieldRequired(notes, { hasPool: true })).toBe(true);
  });

  it("collectMissingRequired flags the revealed follow-up only when blank + visible", () => {
    expect(collectMissingRequired(config, CORE, { hasPool: true }).map((m) => m.id)).toContain("poolNotes");
    expect(collectMissingRequired(config, CORE, { hasPool: true, poolNotes: "Skim weekly" })).toHaveLength(0);
    expect(collectMissingRequired(config, CORE, { hasPool: false })).toHaveLength(0);
  });

  it("pruneCustomValues drops values whose field is hidden by an unmet condition", () => {
    const pruned = pruneCustomValues(config, {}, { hasPool: false, poolNotes: "stale value" });
    expect(pruned.poolNotes).toBeUndefined();
    const kept = pruneCustomValues(config, {}, { hasPool: true, poolNotes: "Skim weekly" });
    expect(kept.poolNotes).toBe("Skim weekly");
    expect(kept.hasPool).toBe(true);
  });
});

describe("collectMissingRequired — system required", () => {
  it("reports a configured-required system field left blank", () => {
    const config = cfg({ systemFields: { postcode: { required: true } } });
    expect(collectMissingRequired(config, { ...CORE, postcode: "" }, {}).map((m) => m.id)).toContain("postcode");
    expect(collectMissingRequired(config, { ...CORE, postcode: "2150" }, {})).toHaveLength(0);
  });

  it("flags blank locked core fields (replaces the old hardcoded guard)", () => {
    expect(collectMissingRequired(cfg({}), { name: "X" }, {}).map((m) => m.id).sort()).toEqual(
      ["address", "clientId", "suburb"],
    );
  });
});
