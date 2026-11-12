// @vitest-environment node
// Wave E: a "Monthly" question already shown on a clean at the same property
// this month that is submitted but not yet approved is not shown again on a
// second clean; once that first clean is reset or rejected (it leaves
// SUBMITTED / QA_REVIEW) the question is due again.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";

const mocks = vi.hoisted(() => ({ templates: vi.fn(), rotation: vi.fn(), submissions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(() => { throw Error("Unexpected settings access"); }) }));

import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { monthStart, monthlyKeysShownIn } from "@/lib/accountability/monthly-pending";

const ovenField = { id: "oven", type: "yesno", label: "Oven", frequency: "MONTHLY" };
const schema = { standardSections: false, sections: [{ id: "kitchen", title: "Kitchen", fields: [{ id: "bench", type: "checkbox", label: "Bench" }, ovenField] }] };
const database = {
  formTemplate: { findMany: mocks.templates },
  propertyRotationState: { findMany: mocks.rotation },
  formSubmission: { findMany: mocks.submissions },
};
const settings = { propertyFormTemplateOverrides: {}, timezone: "Australia/Sydney" };
const now = new Date("2026-11-20T01:00:00Z");
const jobB = { id: "job-b", jobType: JobType.AIRBNB_TURNOVER, propertyId: "property", isRework: false, internalNotes: null, property: { name: "P", bedrooms: 1, bathrooms: 1 } };
const shownOven = { data: { __templateSchema: { sections: [{ id: "kitchen", fields: [{ id: "bench", type: "checkbox" }, ovenField] }] } } };
const withoutOven = { data: { __templateSchema: { sections: [{ id: "kitchen", fields: [{ id: "bench", type: "checkbox" }] }] } } };

async function idsFor(job = jobB) {
  const result = await resolveEffectiveJobForm(job, settings, { database: database as never, now });
  return ((result.template?.schema as { sections: Array<{ fields: Array<{ id: string }> }> }).sections[0].fields).map((field) => field.id);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.templates.mockResolvedValue([{ id: "t", name: "t", isActive: true, version: 1, serviceType: JobType.AIRBNB_TURNOVER, schema }]);
  mocks.rotation.mockResolvedValue([]);
  mocks.submissions.mockResolvedValue([]);
});

describe("second clean in a month before the first is approved", () => {
  it("does not show the monthly question when a pending clean at the property already showed it", async () => {
    mocks.submissions.mockResolvedValue([shownOven]);
    expect(await idsFor()).toEqual(["bench"]);
  });

  it("asks only for that property's cleans waiting for approval, this organisation month, excluding the job itself and rework", async () => {
    await idsFor();
    const args = mocks.submissions.mock.calls[0][0];
    expect(args.where).toEqual({
      createdAt: { gte: monthStart(now, "Australia/Sydney") },
      job: { propertyId: "property", status: { in: ["SUBMITTED", "QA_REVIEW"] }, isRework: false, id: { not: "job-b" } },
    });
    expect(args.take).toBeLessThanOrEqual(25);
    expect(args.select).toEqual({ data: true });
    expect(monthStart(now, "Australia/Sydney").toISOString()).toBe("2026-10-31T13:00:00.000Z");
  });

  it("shows it again once the first clean is reset or rejected (no longer waiting for approval)", async () => {
    // The status filter leaves the reset clean out, and nothing stamped it.
    mocks.submissions.mockResolvedValue([]);
    expect(await idsFor()).toEqual(["bench", "oven"]);
  });

  it("still shows it when the pending clean did not show it (its stored form lacked the question)", async () => {
    mocks.submissions.mockResolvedValue([withoutOven]);
    expect(await idsFor()).toEqual(["bench", "oven"]);
  });

  it("hides it after the first clean was approved first (the stamp), whatever the pending list says", async () => {
    mocks.rotation.mockResolvedValue([{ itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: new Date("2026-11-05T02:00:00Z") }]);
    mocks.submissions.mockResolvedValue([]);
    expect(await idsFor()).toEqual(["bench"]);
  });

  it("is due on the first clean of the next month even with a pending clean from the previous month", async () => {
    // The month window starts on 1 December (Sydney), so November's pending clean is not read.
    mocks.submissions.mockImplementation(async (args: { where: { createdAt: { gte: Date } } }) => (args.where.createdAt.gte > new Date("2026-11-30T12:00:00Z") ? [] : [shownOven]));
    const result = await resolveEffectiveJobForm(jobB, settings, { database: database as never, now: new Date("2026-11-30T13:30:00Z") });
    expect(((result.template?.schema as { sections: Array<{ fields: Array<{ id: string }> }> }).sections[0].fields).map((field) => field.id)).toEqual(["bench", "oven"]);
  });
});

it("reads the monthly keys a stored submission showed, tolerant of anything", () => {
  expect(monthlyKeysShownIn(shownOven.data)).toEqual(["oven"]);
  expect(monthlyKeysShownIn({})).toEqual([]);
  expect(monthlyKeysShownIn(null)).toEqual([]);
  expect(monthlyKeysShownIn({ __templateSchema: "nope" })).toEqual([]);
});
