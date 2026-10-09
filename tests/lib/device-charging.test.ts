import { describe, expect, it } from "vitest";
import { withDeviceChargingEvidence } from "@/lib/forms/device-charging";
import { isDeviceStatusField } from "@/lib/forms/device-status";
import { isTemplateNodeVisible } from "@/lib/forms/visibility";
import type { FormSchema } from "@/lib/forms/types";
const schema = { sections: [] } as unknown as FormSchema;
const job = {
  jobType: "AIRBNB_TURNOVER",
  isRework: false,
  property: { name: "JacksonP1" },
};
describe("Jackson device charging proof", () => {
  it("adds both devices without mutating the stored form and remains idempotent", () => {
    const result = withDeviceChargingEvidence(schema, job);
    expect(schema.sections).toEqual([]);
    expect(
      result.sections[0].fields.filter((field) => field.type === "photo"),
    ).toHaveLength(2);
    expect(withDeviceChargingEvidence(result, job)).toBe(result);
    expect(isDeviceStatusField(result.sections[0].fields[0])).toBe(false);
  });
  it("requires proof for charging and an explanation for exceptions", () => {
    const [status, proof, reason] = withDeviceChargingEvidence(schema, job)
      .sections[0].fields;
    expect(proof.required).toBe(true);
    expect(
      isTemplateNodeVisible(proof, { [status.id]: "Charged / charging" }, {}),
    ).toBe(true);
    expect(
      isTemplateNodeVisible(reason, { [status.id]: "Charged / charging" }, {}),
    ).toBe(false);
    expect(
      isTemplateNodeVisible(reason, { [status.id]: "Unable to charge" }, {}),
    ).toBe(true);
  });
  it("preserves P3's Ring removal and excludes other clients, services and reworks", () => {
    expect(
      withDeviceChargingEvidence(schema, {
        ...job,
        property: { name: "JacksonP3" },
      }).sections[0].fields.every((field) => !field.label.includes("Ring")),
    ).toBe(true);
    for (const patch of [
      { property: { name: "Other property" } },
      { jobType: "DEEP_CLEAN" },
      { isRework: true },
    ])
      expect(withDeviceChargingEvidence(schema, { ...job, ...patch })).toBe(
        schema,
      );
  });
});
it("reuses an existing device check instead of asking the same question twice", () => {
  const existing = {
    sections: [
      {
        id: "checks",
        title: "Checks",
        fields: [
          { id: "ring", type: "checkbox", label: "Ring camera charged" },
        ],
      },
    ],
  } as FormSchema;
  const result = withDeviceChargingEvidence(existing, job);
  expect(result.sections[0].fields[0]).toMatchObject({
    id: "ring",
    required: true,
  });
  const fields = result.sections[1].fields;
  expect(fields.some((field) => field.id.endsWith("ring-status"))).toBe(false);
  expect(
    fields.find((field) => field.id.endsWith("ring-proof"))?.conditional,
  ).toEqual({ fieldId: "ring", operator: "equals", value: true });
});
