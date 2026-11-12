import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineFacts } from "@/lib/jobs/job-page/timeline";
import { jobStages, type JobStageFacts } from "@/lib/jobs/job-page/stage-bar";
import { jobBlockers, blockersHeading } from "@/lib/jobs/job-page/blockers";

const facts = (overrides: Partial<TimelineFacts> = {}): TimelineFacts => ({
  status: "UNASSIGNED",
  hasAssignment: false,
  acceptedCount: 0,
  assignmentCount: 0,
  hasTimeLog: false,
  clockRunning: false,
  hasSubmission: false,
  hasQaReview: false,
  qaPassed: null,
  qaScore: null,
  qaInspectorName: null,
  reportExists: false,
  reportSent: false,
  laundry: { exists: false, supplierName: null, finished: false },
  liveInvoice: null,
  formName: null,
  bookingSource: null,
  hasReservation: false,
  siteWindow: null,
  runningSinceLabel: null,
  submittedLabel: null,
  ...overrides,
});

const states = (input: TimelineFacts) => Object.fromEntries(buildTimeline(input).map((stage) => [stage.key, stage.state]));

describe("timeline assembly", () => {
  it("has the nine drawn stages in order with numbered eyebrows", () => {
    const timeline = buildTimeline(facts());
    expect(timeline.map((stage) => stage.eyebrow)).toEqual([
      "1 · Booking", "2 · Scope", "3 · Dispatch", "4 · On site", "5 · Submitted", "6 · Quality check", "7 · Report", "8 · Laundry", "9 · Invoice and pay",
    ]);
    expect(timeline.map((stage) => stage.anchor)).toContain("s-submitted");
  });

  it("unassigned: booking and scope filled, dispatch current, the rest not yet", () => {
    expect(states(facts())).toEqual({ booking: "done", scope: "done", dispatch: "now", site: "todo", submitted: "todo", qa: "todo", report: "todo", laundry: "todo", invoice: "todo" });
    expect(buildTimeline(facts()).find((stage) => stage.key === "dispatch")?.headline).toBe("No cleaner assigned");
  });

  it("submitted: the submission stage is current and needs review", () => {
    const input = facts({ status: "SUBMITTED", hasAssignment: true, assignmentCount: 2, acceptedCount: 2, hasTimeLog: true, hasSubmission: true, siteWindow: "09:28 – 12:40" });
    const timeline = buildTimeline(input);
    expect(states(input)).toMatchObject({ dispatch: "done", site: "done", submitted: "now", qa: "todo", invoice: "todo" });
    expect(timeline.find((stage) => stage.key === "submitted")?.headline).toBe("Needs your review");
    expect(timeline.find((stage) => stage.key === "dispatch")?.headline).toBe("2 cleaners accepted");
    expect(timeline.find((stage) => stage.key === "site")?.headline).toBe("09:28 – 12:40");
  });

  it("in progress: on site is current while the clock runs", () => {
    const input = facts({ status: "IN_PROGRESS", hasAssignment: true, assignmentCount: 1, acceptedCount: 1, hasTimeLog: true, clockRunning: true, runningSinceLabel: "09:04" });
    expect(states(input).site).toBe("now");
    expect(buildTimeline(input).find((stage) => stage.key === "site")?.headline).toBe("Clock running since 09:04");
  });

  it("does not mark a stage done without its record", () => {
    // Completed with no submission recorded: Submitted stays "not yet".
    expect(states(facts({ status: "COMPLETED", hasAssignment: true, hasTimeLog: true })).submitted).toBe("todo");
  });

  it("invoiced: invoice current until paid, then done", () => {
    const sent = facts({ status: "INVOICED", liveInvoice: { invoiceNumber: "INV-0421", status: "SENT" } });
    expect(states(sent).invoice).toBe("now");
    expect(buildTimeline(sent).find((stage) => stage.key === "invoice")?.headline).toBe("INV-0421 · sent");
    expect(states(facts({ status: "INVOICED", liveInvoice: { invoiceNumber: "INV-0421", status: "PAID" } })).invoice).toBe("done");
  });

  it("cancelled: no current stage, recorded stages stay done", () => {
    const result = states(facts({ status: "CANCELLED", hasAssignment: true }));
    expect(Object.values(result)).not.toContain("now");
    expect(result.dispatch).toBe("done");
    expect(result.site).toBe("todo");
  });

  it("uses records for the independent stages", () => {
    const input = facts({ status: "SUBMITTED", hasQaReview: true, qaPassed: true, qaScore: 92.4, reportExists: true, laundry: { exists: true, supplierName: "Bright Linen Co.", finished: false } });
    const timeline = buildTimeline(input);
    expect(states(input)).toMatchObject({ qa: "done", report: "done", laundry: "todo" });
    expect(timeline.find((stage) => stage.key === "qa")?.headline).toBe("QA 92, passed");
    expect(timeline.find((stage) => stage.key === "laundry")?.headline).toBe("Bright Linen Co.");
    expect(states(facts({ status: "QA_REVIEW" })).qa).toBe("now");
  });
});

const stageFacts = (overrides: Partial<JobStageFacts> = {}): JobStageFacts => ({
  status: "UNASSIGNED",
  hasAssignment: false,
  hasTimeLog: false,
  hasSubmission: false,
  completedAt: null,
  hasLiveInvoiceLine: false,
  liveInvoiceStatus: null,
  ...overrides,
});

describe("eight-step stage bar", () => {
  it("has the eight drawn steps", () => {
    expect(jobStages(stageFacts()).map((stage) => stage.label)).toEqual(["Booked", "Assigned", "En route", "In progress", "Submitted, review", "Completed", "Invoiced", "Paid"]);
  });

  it("marks the status's step current and earlier steps done only with a record", () => {
    const stages = jobStages(stageFacts({ status: "SUBMITTED", hasAssignment: true, hasTimeLog: true, hasSubmission: true }));
    expect(stages.map((stage) => stage.state)).toEqual(["done", "done", "done", "done", "current", "todo", "todo", "todo"]);
    const unrecorded = jobStages(stageFacts({ status: "COMPLETED", completedAt: new Date() }));
    expect(unrecorded[1].state).toBe("passed");
    expect(unrecorded[5].state).toBe("current");
  });

  it("shows paid as current once the live invoice is paid, and part paid as pending", () => {
    expect(jobStages(stageFacts({ status: "INVOICED", hasLiveInvoiceLine: true, liveInvoiceStatus: "PAID" }))[7].state).toBe("current");
    expect(jobStages(stageFacts({ status: "INVOICED", hasLiveInvoiceLine: true, liveInvoiceStatus: "PART_PAID" }))[7]).toMatchObject({ state: "pending", note: "Part paid" });
  });

  it("strikes every step through when cancelled", () => {
    expect(new Set(jobStages(stageFacts({ status: "CANCELLED" })).map((stage) => stage.state))).toEqual(new Set(["skipped"]));
  });

  it("notes an interruption on the current step", () => {
    expect(jobStages(stageFacts({ status: "PAUSED" }))[3]).toMatchObject({ state: "current", note: "Paused" });
  });
});

describe("blockers", () => {
  const input = { status: "SUBMITTED", pendingTaskRequests: 1, pendingContinuations: 0, clockInDistanceM: 420, geofenceRadiusM: 150, skipStatus: "NONE" };
  it("lists what needs a decision, linking into the stage", () => {
    const blockers = jobBlockers(input);
    expect(blockers.map((blocker) => blocker.text)).toEqual(["1 task request to decide", "Clocked in 420 m from the property"]);
    expect(blockers.map((blocker) => blocker.href)).toEqual(["#s-submitted", "#s-site"]);
    expect(blockersHeading("SUBMITTED", 2)).toBe("Before you approve, 2 things need you:");
    expect(blockersHeading("IN_PROGRESS", 1)).toBe("1 thing needs you:");
  });

  it("does not flag an unknown distance or one inside the radius", () => {
    expect(jobBlockers({ ...input, pendingTaskRequests: 0, clockInDistanceM: null })).toEqual([]);
    expect(jobBlockers({ ...input, pendingTaskRequests: 0, clockInDistanceM: 120 })).toEqual([]);
  });

  it("shows nothing for a cancelled job", () => {
    expect(jobBlockers({ ...input, status: "CANCELLED" })).toEqual([]);
  });
});
