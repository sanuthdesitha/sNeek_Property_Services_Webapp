// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { JobStatus, JobType, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), job: vi.fn(), settings: vi.fn(), templates: vi.fn(), hidden: vi.fn(), create: vi.fn(),
  sign: vi.fn(), attach: vi.fn(), tasks: vi.fn(), clockout: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  job: { findUnique: mocks.job },
  formTemplate: { findMany: mocks.templates, findFirst: mocks.hidden, create: mocks.create },
  timeLog: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  issueTicket: { findMany: vi.fn(async () => []) },
  nfcScanEvent: { findFirst: vi.fn(async () => null) },
  propertyMaintenanceItem: { findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/auth/roles", () => ({ canActAs: () => false }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: mocks.sign }));
vi.mock("@/lib/time/auto-clockout", () => ({ autoClockOutStaleTimeLogsForUser: mocks.clockout }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ getApprovedContinuationProgressSnapshot: vi.fn(async () => null) }));
vi.mock("@/lib/accountability/patterns", () => ({ getJobStartReminders: vi.fn(async () => []) }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingCarryForwardTasksToJob: mocks.attach, listCleanerJobTasks: mocks.tasks }));
vi.mock("@/lib/laundry/previous-cycle", () => ({ getPreviousCleanLaundryCycle: vi.fn(async () => null) }));

import { GET } from "@/app/api/jobs/[id]/form/route";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { assembleJobForm } from "@/lib/forms/assemble-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";

const baseSchema = { standardSections: false, sections: [{ id: "room", title: "Room", fields: [
  { id: "proof", type: "photo", label: "Evidence", required: true, references: [{ storageKey: "example.jpg" }] },
] }] };
const extras = [{ id: "extra", label: "<b>Oven</b>", instructions: "<p>Wipe trays</p>" }];
function template(id: string, version = 1, patch: Record<string, unknown> = {}) {
  return { id, name: id, serviceType: JobType.AIRBNB_TURNOVER, version, isActive: true, schema: baseSchema, ...patch };
}
let job: Record<string, any>;
let settings: Record<string, any>;
async function read() {
  const response = await GET(new NextRequest("http://localhost/api/jobs/job/form"), { params: { id: "job" } });
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  job = { id: "job", propertyId: "property", jobType: JobType.AIRBNB_TURNOVER,
    status: JobStatus.IN_PROGRESS, isRework: false, formTemplateId: null,
    scheduledDate: new Date("2026-09-09T00:00:00Z"), startTime: "10:00",
    assignments: [], property: { name: "Test property", inventoryEnabled: false, laundryEnabled: false },
    internalNotes: serializeJobInternalNotes({ additionals: extras }),
  };
  settings = { timezone: "Australia/Sydney", propertyFormTemplateOverrides: {},
    cleanerPortalVisibility: { showPayRequests: false }, companyName: "Test", companyPhone: "",
    accountability: {}, finalCheckup: { enabled: false }, selectAllAllowedCleanerIds: [],
    clockOutWithoutFormAllowedCleanerIds: [], noPhotoExemptCleanerIds: [],
  };
  mocks.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
  mocks.job.mockImplementation(async () => job);
  mocks.settings.mockImplementation(async () => settings);
  mocks.templates.mockResolvedValue([template("global")]);
  mocks.hidden.mockResolvedValue(null);
  mocks.create.mockImplementation(() => { throw new Error("Unexpected form provisioning"); });
  mocks.sign.mockImplementation(async key => `https://signed.invalid/${key}`);
  mocks.attach.mockResolvedValue(undefined); mocks.tasks.mockResolvedValue([]); mocks.clockout.mockResolvedValue(undefined);
});

describe("real form read resolution", () => {
  it("rehydrates the cleaner receipt after later driver confirmations without modifying history", async () => {
    const confirmation = { id: "original", createdAt: new Date("2026-10-04T03:06:00Z"), bagLocation: "Shelf", s3Key: "laundry/photo.jpg", photoUrl: "/photo.jpg", notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", bagCount: 2, unit: "bags" }) };
    job.laundryTask = { status: "PICKED_UP", confirmations: [{ ...confirmation, id: "driver", createdAt: new Date("2026-10-05T00:00:00Z"), notes: JSON.stringify({ source: "PICKUP" }) }, confirmation] };
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.laundryState.savedUpdate).toMatchObject({ id: "original", recordedAt: "2026-10-04T03:06:00.000Z", photoKey: "laundry/photo.jpg", bagCount: "2" });
    expect(job.laundryTask.confirmations).toHaveLength(2);
  });
  it("selects floorCount and fingerprints the same visible property projection used by submission", async () => {
    const schema = { standardSections: false, sections: [{ id: "stairs", fields: [
      { id: "stairs-note", type: "text", required: true, conditional: { propertyField: "floorCount", value: 2 } },
    ] }] };
    job.property.floorCount = 2;
    mocks.templates.mockResolvedValue([template("global", 1, { schema })]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(mocks.job.mock.calls[0][0].include.property.select.floorCount).toBe(true);
    expect(body.job.property.floorCount).toBe(2);
    expect(body.formRevision).toBe(jobFormRevision({ template: { id: "global", schema: assembleJobForm(schema, extras) },
      job: { ...job, property: { ...job.property, createdAt: new Date(), clientId: "private", cleanerServiceRate: 99 } },
      settings, canUseNoPhoto: false, finalCheckupItems: [] }));
  });

  it("preserves legacy form reads while marking a private property predicate unavailable to v2", async () => {
    mocks.templates.mockResolvedValue([template("global", 1, { schema: { sections: [{ id: "private",
      conditional: { propertyField: "clientId", value: "private" }, fields: [] }] } })]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.template).not.toBeNull();
    expect(body.formRevision).toBeNull();
    expect(body.formContractError).toMatch(/unsupported property condition/);
  });
  it("uses the job pin and preserves normalized additionals with signed references", async () => {
    job.formTemplateId = "pinned";
    settings.propertyFormTemplateOverrides = { property: { AIRBNB_TURNOVER: "override" } };
    mocks.templates.mockResolvedValue([template("global", 50), template("override", 20), template("pinned", 1, { isJobScoped: true })]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.template.id).toBe("pinned");
    expect(body.templateSource).toBe("job_pin");
    expect(body.configuredPropertyTemplateId).toBe("override");
    expect(body.formRevision).toBe(jobFormRevision({ template: { id: body.template.id,
      schema: assembleJobForm(baseSchema, extras) }, job, settings, canUseNoPhoto: false, finalCheckupItems: [] }));
    const expected = assembleJobForm(baseSchema, extras);
    expect(body.template.schema.sections).toEqual([
      { ...expected.sections[0], fields: [{ ...expected.sections[0].fields[0], references: [{ storageKey: "example.jpg", url: "https://signed.invalid/example.jpg" }] }] },
      expected.sections[1],
    ]);
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("falls back from an unusable pin to the configured property template", async () => {
    job.formTemplateId = "wrong-service";
    settings.propertyFormTemplateOverrides = { property: { AIRBNB_TURNOVER: "override" } };
    mocks.templates.mockResolvedValue([template("wrong-service", 99, { serviceType: JobType.DEEP_CLEAN }), template("global", 30), template("override")]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.template.id).toBe("override");
    expect(body.templateSource).toBe("property_override");
  });

  it("excludes other-property and job-only templates from the global fallback", async () => {
    settings.propertyFormTemplateOverrides = { other: { AIRBNB_TURNOVER: "other-property" } };
    mocks.templates.mockResolvedValue([template("job-only", 100, { isJobScoped: true }), template("other-property", 90), template("global", 2)]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.template.id).toBe("global");
    expect(body.templateSource).toBe("global_latest");
  });

  it("retains display-only additionals without silently creating a form template", async () => {
    mocks.templates.mockResolvedValue([]);
    const { response, body } = await read();
    expect(response.status).toBe(200);
    expect(body.template.id).toBe("additionals-only");
    expect(body.template.schema).toEqual(JSON.parse(JSON.stringify(assembleJobForm(null, extras))));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an unassigned cleaner before resolving or signing any template", async () => {
    mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
    const { response } = await read();
    expect(response.status).toBe(403);
    expect(mocks.templates).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});


it("does not clock out a cleaner or provision templates during a form read", async () => {
  mocks.role.mockResolvedValue({ user: { id: "cleaner", role: Role.CLEANER } });
  job.assignments = [{ userId: "cleaner", user: { name: "Cleaner" } }];
  job.isRework = true; job.reworkAreas = [{ id: "room", label: "Room", photoKeys: [] }];
  await read();
  expect(mocks.clockout).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});


it.each([false, true])("projects missing-count preparation for cleaners (same-day %s) without rewriting notes", async sameDayCheckin => {
  job.property.name = "Jackson Property-11";
  job.property.accessInfo = { maxGuestCount: 4 };
  job.sameDayCheckin = sameDayCheckin;
  const originalNotes = job.internalNotes;
  const { response, body } = await read();
  expect(response.status).toBe(200);
  expect(body.jobMeta.reservationContext).toMatchObject({ preparationGuestCount: 7, preparationSource: "PROPERTY_MAX" });
  expect(body.nextGuest).toMatchObject({ preparationGuestCount: 7, preparationIsFallback: true });
  expect(job.internalNotes).toBe(originalNotes);
  expect(body.finalCheckup.items).toEqual([]);
});

it("returns the real arrival count in both cleaner projections", async () => {
  job.property.name = "JacksonP3";
  job.sameDayCheckin = true;
  job.internalNotes = serializeJobInternalNotes({ reservationContext: { preparationGuestCount: 5, preparationSource: "INCOMING_BOOKING" } });
  const { body } = await read();
  expect(body.jobMeta.reservationContext.preparationGuestCount).toBe(5);
  expect(body.nextGuest.preparationGuestCount).toBe(5);
});


it("projects the owner-confirmed P3 Ring removal without updating templates or job data", async () => {
  job.property.name = "JacksonP3";
  const schema = { ...baseSchema, sections: [{ id: "devices", title: "Devices", fields: [
    { id: "ring", label: "Ring camera charged?", type: "checkbox", required: true },
    { id: "minut", label: "Minut charged?", type: "checkbox", required: true },
  ] }] };
  const before = JSON.stringify({ schema, job });
  mocks.templates.mockResolvedValue([template("global", 1, { schema })]);
  const { response, body } = await read();
  expect(response.status).toBe(200);
  const fields = body.template.schema.sections.flatMap((section: any) => section.fields);
  expect(fields.some((field: any) => field.id === "ring")).toBe(false);
  expect(fields.some((field: any) => field.id === "minut")).toBe(true);
  expect(JSON.stringify({ schema, job })).toBe(before);
  expect(mocks.create).not.toHaveBeenCalled();
});
