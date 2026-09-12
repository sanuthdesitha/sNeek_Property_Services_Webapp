// @vitest-environment node
import { describe, expect, it } from "vitest";
import { jobFormRevision } from "@/lib/forms/job-form-revision";

function input() {
  return { template: { id: "template", schema: { sections: [{ id: "room", fields: [
    { id: "proof", type: "photo", required: true, conditional: { propertyField: "bedrooms", value: 2 } },
  ] }] } }, job: { jobType: "GENERAL_CLEAN", isRework: false,
    property: { hasBalcony: false, bedrooms: 2, createdAt: new Date(), client: { name: "Private" } } },
  settings: { accountability: { requiredChecklistTicksBlockSubmit: false } },
  canUseNoPhoto: false, finalCheckupItems: [] };
}
describe("job form revision projection", () => {
  it("excludes unrelated raw database values while binding visibility property values", () => {
    const value = input(); const revision = jobFormRevision(value);
    value.job.property.createdAt = new Date(0); value.job.property.client.name = "Other";
    expect(jobFormRevision(value)).toBe(revision);
    value.job.property.bedrooms = 3;
    expect(jobFormRevision(value)).not.toBe(revision);
  });
  it("binds current permission and server gate settings", () => {
    const value = input(); const revision = jobFormRevision(value);
    value.canUseNoPhoto = true;
    expect(jobFormRevision(value)).not.toBe(revision);
    value.canUseNoPhoto = false;
    value.settings.accountability.requiredChecklistTicksBlockSubmit = true;
    expect(jobFormRevision(value)).not.toBe(revision);
  });
});
