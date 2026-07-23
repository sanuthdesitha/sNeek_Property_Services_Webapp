import { describe, it, expect } from "vitest";
import { isInternalJobTag } from "@/lib/jobs/meta";

describe("isInternalJobTag", () => {
  it("hides rework linkage tags", () => {
    expect(isInternalJobTag("rework-of:cmrx123abc")).toBe(true);
    expect(isInternalJobTag("rework-of:")).toBe(true);
  });

  it("keeps human-facing tags visible", () => {
    expect(isInternalJobTag("auto-rework")).toBe(false);
    expect(isInternalJobTag("priority")).toBe(false);
    expect(isInternalJobTag("")).toBe(false);
    // Prefix match only — a tag merely containing the prefix stays visible.
    expect(isInternalJobTag("not-rework-of:x")).toBe(false);
  });
});
