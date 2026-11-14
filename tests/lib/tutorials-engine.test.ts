import { describe, expect, it } from "vitest";
import {
  continueOffer,
  deferralReason,
  effectiveVersion,
  helpStatus,
  matchesRoute,
  nextAvailableIndex,
  personalise,
  planAutoRun,
  planManualRun,
  resolveSteps,
  stepsForViewer,
  type AutoRunContext,
  type TourViewer,
} from "@/lib/tutorials/engine";
import { findTour } from "@/lib/tutorials/registry";
import type { TourDefinition, TourProgressRecord, TourSettingView } from "@/lib/tutorials/types";

const admin: TourViewer = { role: "ADMIN", canOpen: () => true, canManage: () => true };

function progress(partial: Partial<TourProgressRecord> & { tourKey: string }): TourProgressRecord {
  return { version: 1000, status: "DONE", seenSteps: [], missingSteps: [], currentStep: 0, updatedAt: null, completedAt: null, ...partial };
}

function context(partial: Partial<AutoRunContext> = {}): AutoRunContext {
  return { progress: undefined, setting: undefined, viewer: admin, recordable: true, toursOn: true, roleToursOn: true, legacyWelcomeSeen: false, ...partial };
}

const jobs = findTour("admin.jobs")!;

/** The Jobs tour after a release that changed step 2 (board "Tutorials", section 6). */
const jobsV2: TourDefinition = {
  ...jobs,
  version: 2,
  steps: jobs.steps.map((step) => (step.id === "unassigned" ? { ...step, since: 2, body: "Unassigned jobs now sit above the table, with Assign." } : step)),
};

describe("tour ordering and routes", () => {
  it("keeps code order, then applies an administrator's order and hidden steps", () => {
    expect(resolveSteps(jobs).map((step) => step.id)).toEqual(["filters", "unassigned", "row", "bulk", "new"]);
    const setting: TourSettingView = { status: "LIVE", revision: 0, updatedAt: null, overrides: { order: ["new", "filters"], steps: [{ id: "bulk", hidden: true }] } };
    expect(resolveSteps(jobs, setting).map((step) => step.id)).toEqual(["new", "filters", "unassigned", "row"]);
  });

  it("ignores wording over 25 words and a target from another page", () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    const setting: TourSettingView = { status: "LIVE", revision: 0, updatedAt: null, overrides: { steps: [{ id: "filters", body: long, target: "cleaner.today.clock" }] } };
    const [first] = resolveSteps(jobs, setting);
    expect(first.body).toBe(jobs.steps[0].body);
    expect(first.target).toBe("admin.jobs.filters");
  });

  it("matches exact routes, [id] segments and ignores the query", () => {
    expect(matchesRoute("/v2/admin/jobs", "/v2/admin/jobs/")).toBe(true);
    expect(matchesRoute("/v2/admin/jobs", "/v2/admin/jobs/new")).toBe(false);
    expect(matchesRoute("/v2/client/jobs/[id]", "/v2/client/jobs/abc")).toBe(true);
    expect(matchesRoute("/v2/admin/finance?tab=invoices", "/v2/admin/finance")).toBe(true);
  });
});

describe("when a tour starts on its own", () => {
  it("runs the full page tour on a first visit and nothing once done", () => {
    expect(planAutoRun(jobs, context())?.mode).toBe("full");
    expect(planAutoRun(jobs, context({ progress: progress({ tourKey: "admin.jobs" }) }))).toBeNull();
  });

  it("never starts while testing as someone else, with tours off, for a role switched off or for a walkthrough", () => {
    expect(planAutoRun(jobs, context({ recordable: false }))).toBeNull();
    expect(planAutoRun(jobs, context({ toursOn: false }))).toBeNull();
    expect(planAutoRun(jobs, context({ roleToursOn: false }))).toBeNull();
    expect(planAutoRun(findTour("admin.jobs.create")!, context())).toBeNull();
  });

  it("does not start a draft or paused tour", () => {
    expect(planAutoRun(jobs, context({ setting: { status: "PAUSED", revision: 0, overrides: {}, updatedAt: null } }))).toBeNull();
    expect(planAutoRun(jobs, context({ setting: { status: "DRAFT", revision: 0, overrides: {}, updatedAt: null } }))).toBeNull();
  });

  it("gives existing people (retired tutorialSeen flag) no welcome and a one-card offer instead of a full page tour", () => {
    expect(planAutoRun(findTour("welcome.admin")!, context({ legacyWelcomeSeen: true }))).toBeNull();
    expect(planAutoRun(jobs, context({ legacyWelcomeSeen: true }))?.mode).toBe("intro");
  });

  it("shows a welcome once: skipped or done never shows again", () => {
    const welcome = findTour("welcome.admin")!;
    expect(planAutoRun(welcome, context())?.mode).toBe("full");
    expect(planAutoRun(welcome, context({ progress: progress({ tourKey: welcome.key, status: "SKIPPED" }) }))).toBeNull();
  });

  it("respects Don't show again when there is no newer version", () => {
    expect(planAutoRun(jobs, context({ dontShowAgain: true }))).toBeNull();
    expect(planAutoRun(jobs, context({ progress: progress({ tourKey: "admin.jobs", status: "DISMISSED" }) }))).toBeNull();
  });

  it("leaves a tour stopped part-way to the Continue chip instead of popping it up", () => {
    const stopped = progress({ tourKey: "admin.jobs", status: "IN_PROGRESS", currentStep: 2 });
    expect(planAutoRun(jobs, context({ progress: stopped }))).toBeNull();
    expect(continueOffer(jobs, stopped, undefined, admin)).toEqual({ step: 3, total: 5 });
  });
});

describe("What's new", () => {
  it("re-shows only the changed step to someone who finished the previous version", () => {
    const plan = planAutoRun(jobsV2, context({ progress: progress({ tourKey: "admin.jobs", version: 1000 }) }));
    expect(plan?.mode).toBe("whatsNew");
    expect(plan?.steps.map((step) => step.id)).toEqual(["unassigned"]);
    expect(plan?.version).toBe(2000);
  });

  it("shows only the What's new step to someone who chose Don't show again", () => {
    const plan = planAutoRun(jobsV2, context({ progress: progress({ tourKey: "admin.jobs", version: 1000, status: "DISMISSED" }) }));
    expect(plan?.steps.map((step) => step.id)).toEqual(["unassigned"]);
  });

  it("shows the full new version to someone who never opened the page", () => {
    expect(planAutoRun(jobsV2, context())?.steps).toHaveLength(5);
  });

  it("re-shows a step an administrator ticked as What's new, by revision", () => {
    const setting: TourSettingView = { status: "LIVE", revision: 1, updatedAt: null, overrides: { steps: [{ id: "row", body: "Click a job to open its page.", whatsNewRevision: 1 }] } };
    expect(effectiveVersion(jobs, setting)).toBe(1001);
    const plan = planAutoRun(jobs, context({ setting, progress: progress({ tourKey: "admin.jobs", version: 1000 }) }));
    expect(plan?.steps.map((step) => step.id)).toEqual(["row"]);
    expect(helpStatus(jobs, progress({ tourKey: "admin.jobs", version: 1000 }), setting)).toBe("new");
  });

  it("does not re-show anything for a wording fix without the What's new tick", () => {
    const setting: TourSettingView = { status: "LIVE", revision: 0, updatedAt: null, overrides: { steps: [{ id: "row", body: "Click a job to open its page." }] } };
    expect(planAutoRun(jobs, context({ setting, progress: progress({ tourKey: "admin.jobs", version: 1000 }) }))).toBeNull();
  });
});

describe("permissions and missing targets", () => {
  it("skips steps for controls the person cannot use (an ops manager with Finance at View has no Send step)", () => {
    const viewOnly: TourViewer = { role: "OPS_MANAGER", canOpen: () => true, canManage: () => false };
    const result = stepsForViewer(resolveSteps(findTour("admin.finance.send")!), viewOnly);
    expect(result.steps.map((step) => step.id)).toEqual(["list", "lines", "preview", "status"]);
    expect(result.permissionSkipped).toEqual(["send"]);
  });

  it("skips a missing target and records it, never an error", () => {
    const steps = resolveSteps(jobs);
    const onScreen = new Set(["admin.jobs.filters", "admin.jobs.new"]);
    expect(nextAvailableIndex(steps, 1, 1, (id) => onScreen.has(id))).toEqual({ index: 4, missing: ["unassigned", "row", "bulk"] });
    expect(nextAvailableIndex(steps, 1, 1, () => false)).toEqual({ index: null, missing: ["unassigned", "row", "bulk", "new"] });
  });

  it("resumes a replay where the person stopped", () => {
    const plan = planManualRun(jobs, undefined, admin, progress({ tourKey: "admin.jobs", status: "IN_PROGRESS", currentStep: 3 }), "continue");
    expect(plan?.startIndex).toBe(3);
    expect(planManualRun(jobs, undefined, admin, undefined, "replay")?.startIndex).toBe(0);
  });
});

describe("urgent work defers tours", () => {
  const calm = { clockRunning: false, dialogOpen: false, unsavedForm: false, busyMarkers: [] };
  it("defers for a running clock, an open dialog, an unsaved form or a page's busy marker", () => {
    expect(deferralReason(calm)).toBeNull();
    expect(deferralReason({ ...calm, clockRunning: true })).toBe("clock");
    expect(deferralReason({ ...calm, busyMarkers: ["clock"] })).toBe("clock");
    expect(deferralReason({ ...calm, dialogOpen: true })).toBe("dialog");
    expect(deferralReason({ ...calm, unsavedForm: true })).toBe("unsaved");
    expect(deferralReason({ ...calm, busyMarkers: ["offline"] })).toBe("busy");
  });
});

it("greets by first name only when there is one", () => {
  expect(personalise("G'day {firstName}, welcome to sNeek", "Jane")).toBe("G'day Jane, welcome to sNeek");
  expect(personalise("G'day {firstName}, welcome to sNeek", null)).toBe("G'day, welcome to sNeek");
});
