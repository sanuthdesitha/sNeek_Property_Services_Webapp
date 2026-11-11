// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { JobType } from "@prisma/client";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(() => { throw Error("Unexpected settings access"); }) }));
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";

const repeated = { standardSections: false, sections: [{ id: "bed", title: "Bedroom", repeatBy: "bedrooms", fields: [{ id: "made", type: "checkbox", label: "Bed made", required: true }] }] };
const plain = { standardSections: false, sections: [{ id: "k", title: "Kitchen", fields: [{ id: "x", type: "checkbox", label: "X" }] }] };
const job = { jobType: JobType.AIRBNB_TURNOVER, propertyId: "p", isRework: false, internalNotes: null };
const templates = vi.fn();
const property = vi.fn();
const database = () => ({ formTemplate: { findMany: templates }, property: { findUnique: property } }) as never;

beforeEach(() => vi.resetAllMocks());

it("repeats a per-room section for the property's room count", async () => {
  templates.mockResolvedValue([{ id: "t", isActive: true, version: 1, serviceType: job.jobType, schema: repeated }]);
  property.mockResolvedValue({ bedrooms: 3, bathrooms: 1 });
  const result = await resolveEffectiveJobForm(job, {}, { database: database() });
  const ids = (result.template!.schema as { sections: Array<{ id: string }> }).sections.map((s) => s.id);
  expect(ids).toEqual(["bed-1", "bed-2", "bed-3"]);
});

it("fails closed when the room counts cannot be read", async () => {
  templates.mockResolvedValue([{ id: "t", isActive: true, version: 1, serviceType: job.jobType, schema: repeated }]);
  property.mockResolvedValue(null);
  await expect(resolveEffectiveJobForm(job, {}, { database: database() })).rejects.toThrow("Property room counts are unavailable");
});

it("never reads the property for a form without per-room sections", async () => {
  templates.mockResolvedValue([{ id: "t", isActive: true, version: 1, serviceType: job.jobType, schema: plain }]);
  await resolveEffectiveJobForm(job, {}, { database: database() });
  expect(property).not.toHaveBeenCalled();
});
