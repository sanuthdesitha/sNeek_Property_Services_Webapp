// @vitest-environment node
/**
 * Live plants (2026-11-28): the property flag (Property.features.livePlants)
 * becomes the form fact `hasLivePlants` and an automatic start-briefing
 * reminder. The fact fails closed (unknown is never false or true), the raw
 * amenity JSON never reaches the cleaner payload, and the reminder is part of
 * the acknowledged briefing on every job at a property with live plants.
 */
import { describe, expect, it } from "vitest";
import {
  deriveJobFormPropertyFacts,
  isJobFormPropertyKey,
  jobFormProperty,
  jobFormPropertySelect,
  UnsupportedFormPropertyConditionError,
  withJobFormPropertyFacts,
} from "@/lib/forms/job-form-property";
import { PROPERTY_CONDITION_KEYS } from "@/lib/forms/property-conditions";
import { isSupportedPropertyConditionKey, validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { runFormTest, sampleProperty } from "@/lib/forms/test-run";
import {
  LIVE_PLANTS_REMINDER_ID,
  LIVE_PLANTS_REMINDER_TEXT,
  isPropertyReminderId,
  resolvePropertyReminders,
} from "@/lib/properties/property-reminders";
import {
  buildStartBriefingAck,
  resolveStartBriefingItems,
  startBriefingHash,
  validateStartBriefingAck,
} from "@/lib/forms/start-briefing";
import { describeUnresolvedItemId } from "@/lib/jobs/job-page/briefing";
import { buildReadFirstItems } from "@/components/v2/cleaner/read-first-block";
import { FEATURE_DEFS } from "@/lib/checklists/features";
import type { FormSchema } from "@/lib/forms/types";

const PLANTS = { features: { livePlants: true } };
const NO_PLANTS = { features: { livePlants: false, dishwasher: true } };

const meta = () => ({ earlyCheckin: { enabled: false, preset: "none" }, lateCheckout: { enabled: false, preset: "none" }, internalNoteText: "", specialRequestTasks: [] }) as never;

const plantSchema: FormSchema = {
  standardSections: false,
  sections: [
    {
      id: "s",
      title: "Plants",
      fields: [
        { id: "always", type: "yesno", label: "Always asked", required: true },
        {
          id: "plants-photo",
          type: "photo",
          label: "Plant and soil photo",
          required: true,
          minPhotos: 1,
          stampTag: "after",
          conditional: { propertyField: "hasLivePlants", operator: "equals", value: true },
        },
      ],
    },
  ],
};

describe("hasLivePlants — a derived property fact for form rules", () => {
  it("is a supported condition key, offered in the builder, and not a stored column", () => {
    expect(isJobFormPropertyKey("hasLivePlants")).toBe(true);
    expect(isSupportedPropertyConditionKey("hasLivePlants")).toBe(true);
    expect(PROPERTY_CONDITION_KEYS.find((entry) => entry.key === "hasLivePlants")).toMatchObject({ kind: "boolean", label: "Has live plants" });
    expect(Object.hasOwn(jobFormPropertySelect, "hasLivePlants")).toBe(false);
    // The raw amenity JSON is selected to derive the fact, but a rule may not read it.
    expect(Object.hasOwn(jobFormPropertySelect, "features")).toBe(true);
    expect(isJobFormPropertyKey("features")).toBe(false);
    expect(validateFormSchemaForSave(plantSchema).ok).toBe(true);
  });

  it("is true only for livePlants === true, false for any other stored value, and unknown without features", () => {
    expect(deriveJobFormPropertyFacts(PLANTS)).toEqual({ hasLivePlants: true });
    expect(deriveJobFormPropertyFacts(NO_PLANTS)).toEqual({ hasLivePlants: false });
    expect(deriveJobFormPropertyFacts({ features: { livePlants: "true" } })).toEqual({ hasLivePlants: false });
    expect(deriveJobFormPropertyFacts({ features: null })).toEqual({ hasLivePlants: false });
    expect(deriveJobFormPropertyFacts({ features: [] })).toEqual({ hasLivePlants: false });
    // Loaded without its features: unknown, so no fact at all (fail closed).
    expect(deriveJobFormPropertyFacts({ bedrooms: 2 })).toEqual({});
    expect(deriveJobFormPropertyFacts(null)).toEqual({});
    // An already-projected cleaner payload carries the fact itself.
    expect(deriveJobFormPropertyFacts({ hasLivePlants: true })).toEqual({ hasLivePlants: true });
  });

  it("replaces the amenity JSON with the fact in the cleaner payload", () => {
    const projected = withJobFormPropertyFacts({ name: "Unit 4", bedrooms: 2, features: { livePlants: true, dishwasher: true } });
    expect(projected).toEqual({ name: "Unit 4", bedrooms: 2, hasLivePlants: true });
    expect(Object.hasOwn(projected, "features")).toBe(false);
  });

  it("is in the projection the submit route evaluates, and an unknown key still fails closed", () => {
    expect(jobFormProperty(plantSchema, { bedrooms: 1, features: { livePlants: true } })).toMatchObject({ bedrooms: 1, hasLivePlants: true });
    const bad: FormSchema = { sections: [{ id: "s", title: "S", fields: [{ id: "x", type: "yesno", label: "X", conditional: { propertyField: "features", operator: "equals", value: true } }] }] };
    expect(() => jobFormProperty(bad, { features: {} })).toThrow(UnsupportedFormPropertyConditionError);
  });

  it("shows plant questions only at properties with live plants (Test as cleaner)", () => {
    const visible = (property: Record<string, unknown>) =>
      runFormTest({ schema: plantSchema, answers: {}, uploadCounts: {}, property, requiredChecklistTicksBlockSubmit: false })
        .problems.map((problem) => problem.fieldId);
    expect(visible({ features: { livePlants: true } })).toContain("plants-photo");
    expect(visible({ hasLivePlants: true })).toContain("plants-photo");
    expect(visible({ features: { livePlants: false } })).not.toContain("plants-photo");
    // Not known: hidden, never assumed.
    expect(visible({ bedrooms: 2 })).not.toContain("plants-photo");
    expect(sampleProperty({ features: { livePlants: true }, clientId: "secret" })).toEqual({ hasLivePlants: true });
  });

  it("labels the amenity switch plainly and says what it does", () => {
    const flag = FEATURE_DEFS.find((def) => def.key === "livePlants");
    expect(flag).toMatchObject({ label: "Live plants at this property" });
    expect(flag?.hint).toMatch(/reminder/i);
  });
});

describe("Live plants — the automatic start-briefing reminder", () => {
  it("yields one reminder with a stable id and the owner's wording, only when the flag is on", () => {
    expect(resolvePropertyReminders(PLANTS)).toEqual([{ id: LIVE_PLANTS_REMINDER_ID, title: LIVE_PLANTS_REMINDER_TEXT }]);
    expect(LIVE_PLANTS_REMINDER_TEXT).toBe("This property has live plants. Check the soil and water only if it is dry.");
    expect(resolvePropertyReminders(NO_PLANTS)).toEqual([]);
    expect(resolvePropertyReminders({ features: { livePlants: "yes" } })).toEqual([]);
    expect(resolvePropertyReminders({})).toEqual([]);
    expect(resolvePropertyReminders(null)).toEqual([]);
    expect(isPropertyReminderId(LIVE_PLANTS_REMINDER_ID)).toBe(true);
  });

  it("is in the start briefing on every job at the property, after timing and notices", () => {
    const items = resolveStartBriefingItems({
      meta: { ...(meta() as object), lateCheckout: { enabled: true, preset: "custom", time: "11:00" }, internalNoteText: "Spare key in the drawer" } as never,
      property: PLANTS,
    });
    const sources = items.map((item) => item.source);
    expect(sources).toEqual(["TIMING_RULE", "PROPERTY_REMINDER", "SPECIAL_NOTE"]);
    const plants = items.find((item) => item.source === "PROPERTY_REMINDER");
    expect(plants).toMatchObject({ id: LIVE_PLANTS_REMINDER_ID, title: LIVE_PLANTS_REMINDER_TEXT });
    // A job with nothing else to read still opens the briefing for the plants.
    expect(resolveStartBriefingItems({ meta: meta(), property: PLANTS })).toHaveLength(1);
    expect(resolveStartBriefingItems({ meta: meta(), property: NO_PLANTS })).toEqual([]);
  });

  it("must be acknowledged: an acknowledgement made before the flag was switched on is stale", () => {
    const before = resolveStartBriefingItems({ meta: { ...(meta() as object), internalNoteText: "Note" } as never, property: NO_PLANTS });
    const stored = buildStartBriefingAck(before, before.map((item) => ({ itemId: item.id })));
    const after = resolveStartBriefingItems({ meta: { ...(meta() as object), internalNoteText: "Note" } as never, property: PLANTS });
    expect(startBriefingHash(after)).not.toBe(startBriefingHash(before));
    expect(validateStartBriefingAck(after, stored)).toMatchObject({ ok: false });
    const fresh = buildStartBriefingAck(after, after.map((item) => ({ itemId: item.id })));
    expect(validateStartBriefingAck(after, fresh)).toEqual({ ok: true });
    // Leaving the plant reminder out of the acknowledgement is refused.
    const partial = buildStartBriefingAck(after, after.filter((item) => item.source !== "PROPERTY_REMINDER").map((item) => ({ itemId: item.id })));
    expect(validateStartBriefingAck(after, partial)).toMatchObject({ ok: false, missingIds: [LIVE_PLANTS_REMINDER_ID] });
  });

  it("is listed in Read first, never folded, and named in the briefing proof when later removed", () => {
    const items = buildReadFirstItems({ propertyReminders: resolvePropertyReminders(PLANTS), jobMeta: { internalNoteText: "Admin" } });
    expect(items[0]).toEqual({ source: "PROPERTY", title: LIVE_PLANTS_REMINDER_TEXT, body: null });
    expect(buildReadFirstItems({ propertyReminders: [{ id: "x", title: "  " }] })).toEqual([]);
    expect(describeUnresolvedItemId(LIVE_PLANTS_REMINDER_ID)).toBe("Property reminder (since removed)");
  });
});
