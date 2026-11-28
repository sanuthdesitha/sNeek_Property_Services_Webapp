// @vitest-environment node
/** Cleaner job flow v2, item 1: one arrival and one exit video per job, found by marker or standard id, never by label. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { arrivalVideoLock, findWalkthroughVideoFields, walkthroughKindOf } from "@/lib/forms/walkthrough-video";
import type { FormSchema } from "@/lib/forms/types";

const schema = (sections: unknown[]) => ({ sections }) as unknown as FormSchema;

describe("walkthrough videos", () => {
  it("finds the arrival video by the injected standard id and the exit video by the v4 id", () => {
    const found = findWalkthroughVideoFields(schema([
      { id: "arrival-evidence", title: "Arrival", fields: [{ id: "arrival-evidence.walkthrough-video", type: "video", label: "x" }] },
      { id: "kitchen", title: "Kitchen", fields: [{ id: "k1", type: "photo", label: "Bench" }] },
      { id: "sign-off", title: "Leave", fields: [{ id: "exit-walkthrough-video", type: "video", label: "y" }] },
    ]));
    expect(found).toEqual({ arrival: { fieldId: "arrival-evidence.walkthrough-video", sectionId: "arrival-evidence" }, exit: { fieldId: "exit-walkthrough-video", sectionId: "sign-off" } });
  });

  it("reads the explicit marker, including on a child question, and ignores labels", () => {
    expect(walkthroughKindOf({ id: "custom-1", type: "video", walkthroughVideo: "arrival" })).toBe("arrival");
    expect(walkthroughKindOf({ id: "custom-2", type: "video", label: "Arrival walkthrough video" } as never)).toBeNull();
    expect(walkthroughKindOf({ id: "arrival-walkthrough-video", type: "text" })).toBeNull();
    const found = findWalkthroughVideoFields(schema([{ id: "s", title: "S", fields: [{ id: "p", type: "yesno", label: "Q", children: [{ id: "c", type: "video", label: "V", walkthroughVideo: "exit" }] }] }]));
    expect(found.exit).toEqual({ fieldId: "c", sectionId: "s" });
    expect(found.arrival).toBeNull();
  });

  it("locks until the arrival video has a file; split recordings (several files) count as the one video", () => {
    const form = schema([{ id: "arrival", title: "A", fields: [{ id: "arrival-walkthrough-video", type: "video", label: "A" }] }]);
    expect(arrivalVideoLock(form, {})).toEqual({ locked: true, fieldId: "arrival-walkthrough-video", sectionId: "arrival" });
    expect(arrivalVideoLock(form, { "arrival-walkthrough-video": 0 }).locked).toBe(true);
    expect(arrivalVideoLock(form, { "arrival-walkthrough-video": 1 }).locked).toBe(false);
    expect(arrivalVideoLock(form, { "arrival-walkthrough-video": 3 }).locked).toBe(false);
  });

  it("unlocks when the office allowed the job to be submitted without the arrival video (never stuck)", () => {
    const form = schema([{ id: "arrival", title: "A", fields: [{ id: "arrival-walkthrough-video", type: "video", label: "A" }] }]);
    expect(arrivalVideoLock(form, {}, ["arrival-walkthrough-video"]).locked).toBe(false);
    expect(arrivalVideoLock(form, {}, ["other"]).locked).toBe(true);
  });

  it("never locks a form without an arrival video question (older forms keep working)", () => {
    expect(arrivalVideoLock(schema([{ id: "k", title: "K", fields: [{ id: "k1", type: "photo", label: "Bench" }] }]), {}).locked).toBe(false);
    expect(arrivalVideoLock(null, {}).locked).toBe(false);
  });

  it("the v4 form marks its arrival and exit videos explicitly, once each, outside any per-room repeat", () => {
    const file = JSON.parse(readFileSync(path.resolve(__dirname, "../../docs/forms/airbnb-turnover-v4.json"), "utf8"));
    const v4 = file.forms[0].schema as FormSchema & { sections: Array<{ id: string; repeatBy?: string; fields: Array<{ walkthroughVideo?: string }> }> };
    expect(findWalkthroughVideoFields(v4)).toEqual({
      arrival: { fieldId: "arrival-walkthrough-video", sectionId: "arrival-evidence" },
      exit: { fieldId: "exit-walkthrough-video", sectionId: "sign-off" },
    });
    const marked = v4.sections.flatMap((section) => section.fields.filter((field) => field.walkthroughVideo).map(() => section));
    expect(marked).toHaveLength(2);
    expect(marked.every((section) => !section.repeatBy)).toBe(true);
  });
});
