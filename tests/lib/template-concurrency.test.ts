import { describe, it, expect } from "vitest";
import { isStaleTemplateWrite } from "@/lib/forms/template-concurrency";

/**
 * The data loss this guards: a form template's schema is replaced wholesale on
 * save. A back-navigation re-mounts the builder from Next's cached PRE-EDIT
 * payload, so the owner sees their work missing, redoes it, saves — and the
 * good schema is overwritten. A duplicated template reverting "to the one it
 * was copied from" is this bug: a fresh copy's pre-edit state IS its source.
 */
describe("isStaleTemplateWrite", () => {
  const stored = new Date("2026-08-21T12:34:56.789Z");

  it("accepts a save based on the current version", () => {
    expect(isStaleTemplateWrite(stored, "2026-08-21T12:34:56.789Z")).toBe(false);
  });

  it("refuses a save based on an older version", () => {
    expect(isStaleTemplateWrite(stored, "2026-08-21T12:00:00.000Z")).toBe(true);
  });

  it("does not block clients that send no version", () => {
    // Treating "didn't tell me" as a conflict would trade silent data loss for
    // a portal nobody can save in.
    expect(isStaleTemplateWrite(stored, undefined)).toBe(false);
    expect(isStaleTemplateWrite(stored, null)).toBe(false);
    expect(isStaleTemplateWrite(stored, "")).toBe(false);
  });

  it("refuses a version it cannot read", () => {
    // The client believes it sent a version. If we cannot read it we cannot
    // confirm they are current, so the safe answer is to refuse.
    expect(isStaleTemplateWrite(stored, "not-a-date")).toBe(true);
  });

  it("compares instants, not strings", () => {
    // A Sydney client and a UTC client must not disagree about whether they
    // are up to date. 12:34:56.789Z is 22:34:56.789+10:00 on the same day.
    expect(isStaleTemplateWrite(stored, "2026-08-21T22:34:56.789+10:00")).toBe(false);
  });

  it("catches a version that differs by a single millisecond", () => {
    // Two saves a millisecond apart are still two saves.
    expect(isStaleTemplateWrite(stored, "2026-08-21T12:34:56.788Z")).toBe(true);
  });
});
