// @vitest-environment node
// Wave B: the job form resolver hides a "Monthly" question already shown this
// month at the property (organisation timezone) and reads last-shown dates only
// for forms that have one.
import { beforeEach, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";
const mocks = vi.hoisted(() => ({ templates: vi.fn(), rotation: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { propertyRotationState: { findMany: mocks.rotation }, formTemplate: { findMany: mocks.templates } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(() => { throw Error("Unexpected settings access"); }) }));
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";

const schemaWith = (fields: unknown[]) => ({ standardSections: false, sections: [{ id: "kitchen", title: "Kitchen", fields }] });
const job = { jobType: JobType.AIRBNB_TURNOVER, propertyId: "property", isRework: false, internalNotes: null, property: { name: "P", bedrooms: 1, bathrooms: 1 } };
const fieldIds = (result: Awaited<ReturnType<typeof resolveEffectiveJobForm>>) => ((result.template?.schema as any).sections[0].fields as Array<{ id: string }>).map((f) => f.id);

beforeEach(() => vi.resetAllMocks());

it("hides a monthly question shown earlier this month and shows it on the first clean of the next", async () => {
  mocks.templates.mockResolvedValue([{ id: "t", name: "t", isActive: true, version: 1, serviceType: JobType.AIRBNB_TURNOVER, schema: schemaWith([{ id: "bench", type: "checkbox", label: "Bench" }, { id: "oven", type: "yesno", label: "Oven", frequency: "MONTHLY" }]) }]);
  mocks.rotation.mockResolvedValue([{ itemKey: "oven", cleansSinceDone: 0, lastCompletedAt: new Date("2026-11-01T02:00:00Z") }]);
  const settings = { propertyFormTemplateOverrides: {}, timezone: "Australia/Sydney" };
  expect(fieldIds(await resolveEffectiveJobForm(job, settings, { now: new Date("2026-11-20T01:00:00Z") }))).toEqual(["bench"]);
  expect(fieldIds(await resolveEffectiveJobForm(job, settings, { now: new Date("2026-11-30T13:30:00Z") }))).toEqual(["bench", "oven"]); // 1 Dec 00:30 Sydney
  expect(mocks.rotation.mock.calls[0][0].select).toEqual({ itemKey: true, cleansSinceDone: true, lastCompletedAt: true });
});

it("keeps the exact rotation read for forms without a monthly question", async () => {
  mocks.templates.mockResolvedValue([{ id: "t", name: "t", isActive: true, version: 1, serviceType: JobType.AIRBNB_TURNOVER, schema: schemaWith([{ id: "top", type: "photo", label: "Top", frequency: "ROTATIONAL", rotationEveryNCleans: 3 }]) }]);
  mocks.rotation.mockResolvedValue([]);
  await resolveEffectiveJobForm(job, { propertyFormTemplateOverrides: {} });
  expect(mocks.rotation.mock.calls[0][0].select).toEqual({ itemKey: true, cleansSinceDone: true });
});
