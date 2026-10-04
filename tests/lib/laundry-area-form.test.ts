import { describe, expect, it } from "vitest";
import { LAUNDRY_AREA_OPTIONS as options, LAUNDRY_AREA_PHOTO as photo, LAUNDRY_AREA_STATUS as status, LAUNDRY_AREA_REASON as reason, markNewJobLaundryArea, withLaundryAreaEvidence } from "@/lib/forms/laundry-area";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
const schema = { sections: [{ id: "property-kitchen", title: "Property kitchen", fields: [{ id: "existing-photo", type: "photo" as const, label: "Kitchen" }] }] };
const job = markNewJobLaundryArea({ jobType: "AIRBNB_TURNOVER", isRework: false, internalNotes: "Keep instructions" });
const form = withLaundryAreaEvidence(schema, job);
describe("versioned laundry-area evidence", () => {
  it.each(["AIRBNB_TURNOVER", "GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "MOVE_IN_CLEAN"])("adds the section for a newly created %s", jobType => {
    expect(withLaundryAreaEvidence(schema, markNewJobLaundryArea({ ...job, jobType })).sections).toHaveLength(2);
  });
  it("preserves existing jobs/drafts, reworks, nonresidential types and template-owned fields", () => {
    for (const input of [{ ...job, internalNotes: "Existing job" }, { ...job, isRework: true }, { ...job, jobType: "COMMERCIAL_RECURRING" }]) expect(withLaundryAreaEvidence(schema, input)).toBe(schema);
    expect(withLaundryAreaEvidence(form, job)).toBe(form);
    expect(schema.sections).toHaveLength(1);
    expect(form.sections[0]).toBe(schema.sections[0]);
    expect(form.sections[1].fields.map(field => field.id)).not.toContain("laundry_photo");
  });
  it("keeps structured metadata and the version through subsequent normal note edits", () => {
    const marked = markNewJobLaundryArea({ ...job, internalNotes: JSON.stringify({ version: 1, internalNoteText: "Note", tags: ["urgent"], unknownFutureKey: "keep" }) });
    expect(JSON.parse(marked.internalNotes!)).toMatchObject({ unknownFutureKey: "keep", tags: ["urgent"] });
    const edited = serializeJobInternalNotes({ ...parseJobInternalNotes(marked.internalNotes), internalNoteText: "Edited note" });
    expect(parseJobInternalNotes(edited)).toMatchObject({ laundryAreaEvidenceVersion: 1, internalNoteText: "Edited note" });
    expect(parseJobInternalNotes(job.internalNotes).internalNoteText).toBe("Keep instructions");
  });
  it("requires the chosen photo, but never substitutes the bag photo", () => {
    expect(collectFormErrors(form, {}, {}, {})).toEqual(expect.arrayContaining([expect.objectContaining({ fieldId: status })]));
    expect(collectFormErrors(form, { [status]: options[0] }, { laundry_photo: 1 }, {})).toEqual(expect.arrayContaining([expect.objectContaining({ fieldId: photo })]));
    expect(collectFormErrors(form, { [status]: options[0] }, { [photo]: 1 }, {})).toEqual([]);
  });
  it("allows truthful missing-photo evidence with a reason and not-applicable properties without a fake photo", () => {
    expect(collectFormErrors(form, { [status]: options[1] }, {}, {})).toEqual(expect.arrayContaining([expect.objectContaining({ fieldId: reason })]));
    expect(collectFormErrors(form, { [status]: options[1], [reason]: "Forgot before leaving" }, {}, {})).toEqual([]);
    expect(collectFormErrors(form, { [status]: options[2] }, {}, {})).toEqual([]);
  });
});
