// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobAssignmentResponseStatus, JobStatus, type Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  jobs: vi.fn<[Prisma.JobFindManyArgs], Promise<unknown[]>>(),
  user: vi.fn(),
  tasks: vi.fn(),
  stock: vi.fn(),
  laundry: vi.fn(),
  feedback: vi.fn(),
  tickets: vi.fn(),
  documents: vi.fn(),
  reviews: vi.fn(),
  settings: vi.fn(),
  decrypt: vi.fn(),
  meta: vi.fn(),
  ruleTime: vi.fn(),
  pay: vi.fn(),
  weather: vi.fn(),
  eta: vi.fn(),
  mistakes: vi.fn(),
  cleanerIssues: vi.fn(),
  propertyIssues: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    job: { findMany: mocks.jobs },
    user: { findUnique: mocks.user },
    jobTask: { findMany: mocks.tasks },
    propertyStock: { findMany: mocks.stock, fields: { reorderThreshold: "reorderThreshold" } },
    laundryTask: { findMany: mocks.laundry },
    jobFeedback: { findMany: mocks.feedback },
    issueTicket: { findMany: mocks.tickets },
    staffDocument: { findMany: mocks.documents },
    qAReview: { findMany: mocks.reviews },
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/security/encryption", () => ({ decryptSecret: mocks.decrypt }));
vi.mock("@/lib/jobs/meta", () => ({ parseJobInternalNotes: mocks.meta, resolveRuleTime: mocks.ruleTime }));
vi.mock("@/lib/finance/job-money", () => ({ computeCleanerPay: mocks.pay }));
vi.mock("@/lib/briefing/weather", () => ({ getBriefingWeather: mocks.weather }));
vi.mock("@/lib/jobs/eta", () => ({ getEtaMinutes: mocks.eta }));
vi.mock("@/lib/workforce/mistakes", () => ({
  getCleanerCommonMistakes: mocks.mistakes,
  prettifyFieldId: vi.fn((value: string) => value),
}));
vi.mock("@/lib/accountability/patterns", () => ({
  getCleanerRecurringIssues: mocks.cleanerIssues,
  getPropertyRecurringIssues: mocks.propertyIssues,
}));

// Keep the assembler, audience predicate and spoken-script builder real.
import { assembleCleanerBriefing } from "@/lib/briefing/cleaner-briefing";

const cleanerId = "cleaner-audience-test";
const photoReminder = "Check the reference photos before you start.";

function entry(id: string, audience?: unknown, withPhoto = true) {
  return {
    id,
    kind: "ENTRY",
    label: `${id} entrance`,
    instructions: `Use the ${id} doorway`,
    ...(audience === undefined ? {} : { audience }),
    images: withPhoto ? [{ url: `https://example.test/${id}.jpg`, key: `${id}-photo` }] : [],
  };
}

function job(accessGuide: unknown, propertyOverrides: Record<string, unknown> = {}) {
  return {
    id: "accepted-job",
    jobType: "REGULAR_CLEAN",
    status: JobStatus.ASSIGNED,
    startTime: "10:00",
    dueTime: "14:00",
    estimatedHours: 2,
    internalNotes: null,
    propertyId: "test-property",
    property: {
      name: "Test Cottage",
      suburb: "Sydney",
      address: "1 Test Street",
      latitude: -33.86,
      longitude: 151.2,
      bedrooms: 2,
      bathrooms: 1,
      // Empty legacy fields ensure the rich-guide fallback is exercised.
      imageUrl: null,
      accessCode: null,
      alarmCode: null,
      keyLocation: null,
      accessNotes: null,
      accessInfo: null,
      accessGuide,
      features: null,
      ...propertyOverrides,
    },
    assignments: [{ userId: cleanerId, payRate: null, removedAt: null }],
  };
}

function load(guide: unknown, day: "today" | "tomorrow" = "today", overrides: Record<string, unknown> = {}) {
  const accepted = job(guide, overrides);
  // Dispatch by query purpose, not call order: historical/pending rows stay empty.
  mocks.jobs.mockImplementation(async (query) =>
    query.select?.id &&
    query.where?.assignments?.some?.responseStatus === JobAssignmentResponseStatus.ACCEPTED
      ? [accepted]
      : []
  );
  return assembleCleanerBriefing({ cleanerId, cleanerName: "Alex", day });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Sydney is already September 10 here, while UTC is still September 9.
  vi.setSystemTime(new Date("2026-09-09T15:00:00.000Z"));
  vi.stubGlobal("fetch", mocks.fetch.mockRejectedValue(new Error("Unexpected network request")));
  for (const query of [mocks.tasks, mocks.stock, mocks.laundry, mocks.feedback, mocks.tickets,
    mocks.documents, mocks.reviews, mocks.cleanerIssues, mocks.propertyIssues]) {
    query.mockResolvedValue([]);
  }
  mocks.user.mockResolvedValue({ hourlyRate: 30, latitude: -33.9, longitude: 151.1, preferredTransport: "DRIVING" });
  mocks.settings.mockResolvedValue({ cleanerJobHourlyRates: {} });
  mocks.decrypt.mockImplementation((value) => value);
  mocks.meta.mockReturnValue({ additionals: [], quoteReferenceImages: [] });
  mocks.ruleTime.mockReturnValue(undefined);
  mocks.pay.mockReturnValue({ total: 60, transportAllowance: 0, rateMissing: false });
  mocks.weather.mockResolvedValue(null);
  mocks.eta.mockResolvedValue(15);
  mocks.mistakes.mockResolvedValue({ items: [] });
});

afterEach(() => {
  try {
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("assembleCleanerBriefing wave18 audience projection", () => {
  it.each([
    ["LAUNDRY", "LAUNDRY"],
    ["unknown string", "INVALID"],
    ["empty string", ""],
    ["lowercase", "cleaner"],
    ["number", 42],
    ["boolean", false],
    ["object", { role: "CLEANER" }],
    ["array", ["CLEANER"]],
  ])("hides %s guide text and photos from returned briefing and speech", async (_label, audience) => {
    const result = await load([entry("restricted", audience)]);

    expect(result.jobsOverview?.count).toBe(1);
    expect(result.accessNotes).toBeNull();
    expect(result.newProperties?.items).toEqual([{
      jobId: "accepted-job", propertyName: "Test Cottage", suburb: "Sydney",
      bedrooms: 2, bathrooms: 1, hasReferencePhotos: false,
    }]);
    expect(result.spokenScript).toContain("here's your briefing for today");
    expect(result.spokenScript).not.toContain("restricted");
    expect(result.spokenScript).not.toContain(photoReminder);
    expect(JSON.stringify(result)).not.toContain("restricted");
  });

  it.each([
    ["CLEANER", "CLEANER"],
    ["BOTH", "BOTH"],
    ["legacy omitted", undefined],
    ["legacy null", null],
  ])("keeps %s access text and photo availability in the real assembly", async (_label, audience) => {
    const result = await load([entry("visible", audience)]);

    expect(result.accessNotes).toEqual({ stops: [{
      propertyName: "Test Cottage", items: ["visible entrance: Use the visible doorway"],
    }] });
    expect(result.newProperties?.items).toHaveLength(1);
    expect(result.newProperties?.items[0].hasReferencePhotos).toBe(true);
    expect(result.spokenScript).toContain(photoReminder);
    // The current spoken builder does not narrate accessNotes; assert its actual photo cue.
  });

  it("filters hidden entries before the three-item access limit without losing cleaner, shared or legacy notes", async () => {
    const result = await load([
      entry("laundry-private", "LAUNDRY"), entry("invalid-private", "INVALID"),
      entry("laundry-second", "LAUNDRY"),
      entry("cleaner-visible", "CLEANER", false), entry("shared-visible", "BOTH", false),
      entry("legacy-visible", undefined, false),
    ]);

    expect(result.accessNotes).toEqual({ stops: [{ propertyName: "Test Cottage", items: [
      "cleaner-visible entrance: Use the cleaner-visible doorway",
      "shared-visible entrance: Use the shared-visible doorway",
      "legacy-visible entrance: Use the legacy-visible doorway",
    ] }] });
    expect(result.newProperties?.items[0].hasReferencePhotos).toBe(false);
    expect(result.spokenScript).not.toContain(photoReminder);
    for (const hidden of ["laundry-private", "invalid-private", "laundry-second"]) {
      expect(JSON.stringify(result)).not.toContain(hidden);
      expect(result.spokenScript).not.toContain(hidden);
    }
  });

  it("finds a visible photo after hidden photos even when legacy access text bypasses guide fallback", async () => {
    const result = await load([
      entry("laundry-private", "LAUNDRY"), entry("invalid-private", "INVALID"), entry("visible", "CLEANER"),
    ], "today", { accessNotes: "Use the main entrance" });

    expect(result.accessNotes).toEqual({ stops: [{ propertyName: "Test Cottage", items: ["Use the main entrance"] }] });
    expect(result.newProperties?.items[0].hasReferencePhotos).toBe(true);
    expect(result.spokenScript).toContain(photoReminder);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each(["property image", "quote reference"])("preserves the independent %s photo source when all guide photos are hidden", async (source) => {
    if (source === "quote reference") {
      mocks.meta.mockReturnValue({ additionals: [], quoteReferenceImages: ["https://example.test/quote.jpg"] });
    }
    const result = await load([entry("restricted", "LAUNDRY")], "today",
      source === "property image" ? { imageUrl: "https://example.test/property.jpg" } : {});

    expect(result.accessNotes).toBeNull();
    expect(result.newProperties?.items[0].hasReferencePhotos).toBe(true);
    expect(result.spokenScript).toContain(photoReminder);
    expect(JSON.stringify(result)).not.toContain("restricted");
  });

  it.each([
    ["today", "2026-09-09T14:00:00.000Z", "2026-09-10T13:59:59.999Z"],
    ["tomorrow", "2026-09-10T14:00:00.000Z", "2026-09-11T13:59:59.999Z"],
  ] as const)("preserves the accepted, nonremoved, own day-job query for %s", async (day, start, end) => {
    const result = await load([entry("visible", "CLEANER")], day);
    const baseQuery = mocks.jobs.mock.calls[0][0];

    expect(baseQuery.where).toEqual({
      assignments: { some: { userId: cleanerId, removedAt: null, responseStatus: JobAssignmentResponseStatus.ACCEPTED } },
      scheduledDate: { gte: new Date(start), lte: new Date(end) },
      status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
    });
    expect(baseQuery.select).toMatchObject({
      id: true,
      property: { select: { accessGuide: true, imageUrl: true, accessInfo: true, accessNotes: true } },
      assignments: { select: { userId: true, payRate: true, removedAt: true } },
    });
    expect(mocks.jobs.mock.calls[1][0].where).toEqual({
      ...baseQuery.where,
      assignments: { some: { userId: cleanerId, removedAt: null, responseStatus: JobAssignmentResponseStatus.PENDING } },
    });
    expect(result.jobsOverview?.jobs.map((item) => item.id)).toEqual(["accepted-job"]);
    expect(result.acceptGate).toBeNull();
    expect(result.day).toBe(day);
    expect(mocks.eta).toHaveBeenCalledTimes(1);
    expect(mocks.weather).toHaveBeenCalledWith({ latitude: -33.86, longitude: 151.2, dayOffset: day === "today" ? 0 : 1 });
    expect(mocks.reviews).toHaveBeenCalledTimes(1);
    expect(mocks.mistakes).toHaveBeenCalledWith(cleanerId, 90);
    expect(mocks.cleanerIssues).toHaveBeenCalledWith(cleanerId);
    expect(mocks.propertyIssues).toHaveBeenCalledWith("test-property");
  });
});
