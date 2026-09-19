import { describe, expect, it } from "vitest";
import { formNavigation } from "@/lib/forms/navigation";

const schema = (fields: any[]) => ({ sections: [{ id: "room", title: "Kitchen", fields }] });
const required = (id: string, extra = {}) => ({ id, type: "text", label: id, required: true, ...extra });
describe("adaptive form navigation", () => {
  it("distinguishes hidden conditions from unanswered fields and recomputes property and laundry context", () => {
    const form = schema([required("always"), required("balcony", { conditional: { propertyField: "hasBalcony", value: true } }),
      required("linen", { conditional: { fieldId: "laundry_ready", value: true } })]);
    const hidden = formNavigation(form, {}, {}, { hasBalcony: false }, false).rooms[0];
    expect(hidden).toMatchObject({ total: 1, done: 0, notApplicable: 2 });
    expect(hidden.remaining.map(e => e.fieldId)).toEqual(["always"]);
    expect(formNavigation(form, {}, {}, { hasBalcony: true }, true).rooms[0]).toMatchObject({ total: 3, done: 0, notApplicable: 0 });
  });
  it("honours parent visibility and hidden rooms without supplying answers", () => {
    const answers = Object.freeze({});
    const form = schema([required("parent", { conditional: { fieldId: "trigger", value: true }, children: [required("child")] })]);
    expect(formNavigation(form, answers, {}, {}).rooms[0]).toMatchObject({ total: 0, notApplicable: 2 });
    expect(formNavigation(form, { trigger: true }, {}, {}).rooms[0].remaining).toHaveLength(2);
    const hidden = { sections: [{ ...form.sections[0], conditional: { propertyField: "enabled", value: true } }] };
    expect(formNavigation(hidden, answers, {}, {}).rooms[0]).toMatchObject({ visible: false, total: 0, notApplicable: 2 });
    expect(answers).toEqual({});
  });
  it("uses the granted no-photo policy and file minimums", () => {
    const form = schema([required("proof", { type: "photo", minPhotos: 2 })]);
    const answers = { __noPhotoReasons: { proof: { reasonCode: "OTHER" } } };
    expect(formNavigation(form, answers, { proof: 1 }, {}, undefined, false, false).errors).toHaveLength(1);
    expect(formNavigation(form, answers, {}, {}, undefined, false, true).rooms[0]).toMatchObject({ total: 1, done: 1 });
    expect(formNavigation(form, {}, { proof: 2 }, {}).errors).toEqual([]);
  });
  it("keeps explicit N/A separate from blank and applies checklist policy and no-details errors", () => {
    const form = schema([required("check", { type: "checkbox" }), required("choice", { type: "yesno", includeNa: true, detailsWhenNo: true })]);
    expect(formNavigation(form, { check: false, choice: "na" }, {}, {}).rooms[0]).toMatchObject({ done: 2, answeredNotApplicable: 1 });
    expect(formNavigation(form, { check: false, choice: false }, {}, {}, undefined, true).errors.map(e => e.fieldId)).toEqual(["check", "choice_details"]);
    expect(formNavigation(form, { check: true }, {}, {}).rooms[0]).toMatchObject({ done: 1, answeredNotApplicable: 0 });
  });
  it("retains invalid optional answers as navigable blockers", () => {
    const room = formNavigation(schema([required("number", { type: "number", required: false, min: 2 })]), { number: 1 }, {}, {}).rooms[0];
    expect(room.total).toBe(0);
    expect(room.remaining.map(e => e.fieldId)).toEqual(["number"]);
  });
});
