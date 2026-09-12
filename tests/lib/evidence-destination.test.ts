import { describe, expect, it } from "vitest";
import { destinationMedia, evidenceSubmissionChanged, reconcileEvidenceState, setDestinationMedia, type EvidenceDestination } from "@/lib/cleaner/evidence-destination";

const destinations: EvidenceDestination[] = [{ type: "formField", fieldId: "photo" }, { type: "bulkPool" }, { type: "jobTask", taskId: "task" }, { type: "laundry" }, { type: "carryForwardNew" }];
describe("typed evidence destinations", () => {
  it.each(destinations)("preserves acknowledged $type through stale autosave and strips copies from every other location", destination => {
    const media = { key: "owned", url: "/owned" };
    const receipt = { key: media.key, fieldId: "legacy", destination };
    const previous = setDestinationMedia({}, destination, [media]);
    let stale = {};
    for (const target of destinations) stale = setDestinationMedia(stale, target, [media, { key: "unbound" }]);
    const result = reconcileEvidenceState(stale, previous, { capture: receipt });
    for (const target of destinations) expect(destinationMedia(result, target).filter(item => item.key === "owned")).toHaveLength(JSON.stringify(target) === JSON.stringify(destination) ? 1 : 0);
    const cleared = reconcileEvidenceState({}, previous, { capture: receipt });
    expect(destinationMedia(cleared, destination)).toEqual([media]);
    const detached = reconcileEvidenceState(stale, previous, { capture: { ...receipt, detached: true } });
    for (const target of destinations) expect(destinationMedia(detached, target).some(item => item.key === "owned")).toBe(false);
  });
  it("matches each final payload destination and blocks unassigned, missing, moved or detached evidence", () => {
    const receipts = Object.fromEntries(destinations.map((destination, index) => [index, { fieldId: "legacy", destination, key: String(index) }]));
    const uploads = { photo: ["0"], laundry_photo: ["3"] }; const tasks = [{ id: "task", proofKeys: ["2"] }]; const carry = { __carryForwardNew: ["4"] };
    expect(evidenceSubmissionChanged(receipts, uploads, tasks, carry)).toBe(true);
    delete receipts[1];
    expect(evidenceSubmissionChanged(receipts, uploads, tasks, carry)).toBe(false);
    expect(evidenceSubmissionChanged(receipts, { ...uploads, misplaced: ["2"] }, tasks, carry)).toBe(true);
    expect(evidenceSubmissionChanged(receipts, uploads, [], carry)).toBe(true);
    expect(evidenceSubmissionChanged({ legacy: { key: "0", fieldId: "photo" } }, uploads, [], {})).toBe(false);
    expect(evidenceSubmissionChanged({ capture: { ...receipts[2], detached: true } }, uploads, tasks, carry)).toBe(true);
  });
});
