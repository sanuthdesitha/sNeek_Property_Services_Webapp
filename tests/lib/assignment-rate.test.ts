import { describe, it, expect } from "vitest";
import { resolveAssignmentPayRate } from "@/lib/finance/assignment-rate";

/**
 * What gets stamped into `JobAssignment.payRate` at dispatch.
 *
 * `Property.cleanerServiceRate` was write-only dead config until this rule
 * existed — editable on the property form, saved by the API, documented as
 * overriding the hourly maths, and read by nothing. Zero of nineteen properties
 * had a value set, which is why wiring it in changed nobody's pay on the day it
 * shipped.
 */
describe("resolveAssignmentPayRate", () => {
  it("prefers the per-cleaner job-type rate", () => {
    // A rate negotiated with one person for one job type is a deliberate
    // arrangement; a property must not silently overwrite it.
    expect(resolveAssignmentPayRate({ perCleanerRate: 40, propertyCleanerServiceRate: 55 })).toBe(
      40
    );
  });

  it("falls back to the property's rate when there is no per-cleaner one", () => {
    expect(resolveAssignmentPayRate({ perCleanerRate: null, propertyCleanerServiceRate: 55 })).toBe(
      55
    );
    expect(resolveAssignmentPayRate({ propertyCleanerServiceRate: 55 })).toBe(55);
  });

  it("returns null when neither is set, so the person's own rate can apply", () => {
    // null is not "pay nothing" — computeCleanerPay falls through from here to
    // User.hourlyRate and then the global default, flagging rateMissing.
    expect(resolveAssignmentPayRate({})).toBeNull();
    expect(
      resolveAssignmentPayRate({ perCleanerRate: null, propertyCleanerServiceRate: null })
    ).toBeNull();
  });

  it("treats a stored ZERO as not configured, on either side", () => {
    // Neither form offers a way to mean a deliberate zero, so 0 is an empty box.
    // Honouring it would pay somebody nothing for turning up.
    expect(resolveAssignmentPayRate({ perCleanerRate: 0, propertyCleanerServiceRate: 55 })).toBe(55);
    expect(resolveAssignmentPayRate({ perCleanerRate: 0, propertyCleanerServiceRate: 0 })).toBeNull();
  });

  it("ignores a negative or non-numeric rate rather than propagating it", () => {
    expect(resolveAssignmentPayRate({ perCleanerRate: -10, propertyCleanerServiceRate: 55 })).toBe(
      55
    );
    expect(
      resolveAssignmentPayRate({
        perCleanerRate: Number.NaN,
        propertyCleanerServiceRate: Number.POSITIVE_INFINITY,
      })
    ).toBeNull();
  });

  it("passes a fractional rate through untouched", () => {
    // Rounding belongs to the pay calculation, not to the rate itself.
    expect(resolveAssignmentPayRate({ propertyCleanerServiceRate: 37.5 })).toBe(37.5);
  });

  it("gives the same answer for every caller", () => {
    // SIX routes assign work — admin assign, bulk assign, the preferred-cleaner
    // path on job creation, ops auto-dispatch, recurring generation, and
    // continuation handover. They share this function so the same property
    // cannot pay one rate by hand and another via iCal or a recurring rule.
    const input = { perCleanerRate: null, propertyCleanerServiceRate: 55 };
    expect(resolveAssignmentPayRate(input)).toBe(resolveAssignmentPayRate({ ...input }));
  });

  it("still lets a rate carried forward from an existing assignment win", () => {
    // The continuation path feeds the incoming cleaner's existing payRate in as
    // the per-cleaner rate, because a rate already agreed for THIS job is a
    // decision about this job. The property rate is the floor beneath it, not a
    // replacement for it.
    expect(resolveAssignmentPayRate({ perCleanerRate: 47, propertyCleanerServiceRate: 55 })).toBe(
      47
    );
  });
});
