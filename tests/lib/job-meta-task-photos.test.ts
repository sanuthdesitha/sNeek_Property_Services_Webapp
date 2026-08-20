import { describe, it, expect } from "vitest";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

/**
 * `includeTaskPhotosInReport` decides whether a cleaner's task proof appears in
 * the generated report. Every job created before the flag existed has no such
 * key, so the DEFAULT is what those jobs get on their next regeneration — and
 * defaulting to false would quietly strip evidence from historical reports the
 * moment anything rebuilt them.
 */
describe("includeTaskPhotosInReport", () => {
  it("defaults to true when the key is absent", () => {
    const meta = parseJobInternalNotes(JSON.stringify({ version: 1, tags: [] }));
    expect(meta.includeTaskPhotosInReport).toBe(true);
  });

  it("defaults to true for a job with no meta at all", () => {
    expect(parseJobInternalNotes(null).includeTaskPhotosInReport).toBe(true);
    expect(parseJobInternalNotes("").includeTaskPhotosInReport).toBe(true);
  });

  it("defaults to true for unparseable meta rather than dropping photos", () => {
    expect(parseJobInternalNotes("{not json").includeTaskPhotosInReport).toBe(true);
  });

  it("honours an explicit false", () => {
    const meta = parseJobInternalNotes(
      JSON.stringify({ version: 1, includeTaskPhotosInReport: false })
    );
    expect(meta.includeTaskPhotosInReport).toBe(false);
  });

  it("ignores a non-boolean and falls back to true", () => {
    // A hand-edited row or an older shape must not turn evidence off by accident.
    const meta = parseJobInternalNotes(
      JSON.stringify({ version: 1, includeTaskPhotosInReport: "false" })
    );
    expect(meta.includeTaskPhotosInReport).toBe(true);
  });

  it("survives a serialize/parse round trip in both states", () => {
    const base = parseJobInternalNotes(null);

    const off = parseJobInternalNotes(
      serializeJobInternalNotes({ ...base, includeTaskPhotosInReport: false })
    );
    expect(off.includeTaskPhotosInReport).toBe(false);

    const on = parseJobInternalNotes(
      serializeJobInternalNotes({ ...base, includeTaskPhotosInReport: true })
    );
    expect(on.includeTaskPhotosInReport).toBe(true);
  });

  it("does not disturb the other meta fields", () => {
    const base = parseJobInternalNotes(null);
    const round = parseJobInternalNotes(
      serializeJobInternalNotes({
        ...base,
        internalNoteText: "Gate code changed",
        tags: ["priority"],
        includeTaskPhotosInReport: false,
      })
    );
    expect(round.internalNoteText).toBe("Gate code changed");
    expect(round.tags).toEqual(["priority"]);
    expect(round.includeTaskPhotosInReport).toBe(false);
  });
});
