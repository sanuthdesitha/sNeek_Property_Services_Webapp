import { describe, expect, it } from "vitest";
import { JobStatus } from "@prisma/client";
import {
  PRIMARY_ACTION_BY_STATUS,
  REMINDER_STALE_MS,
  VIEW_ONLY_REASON,
  jobStatusBadge,
  primaryActionFor,
  reminderEligibility,
  secondaryActionsFor,
} from "@/lib/jobs/job-page/primary-action";
import { cancelUnavailableReason, moreMenuFor, type JobMenuInput } from "@/lib/jobs/job-page/more-menu";

const base = { jobId: "job_1", liveInvoice: null, restoreRefusal: null, readOnly: false };
const now = new Date("2026-11-12T10:00:00Z");

describe("primary action by status", () => {
  it("covers every job status", () => {
    for (const status of Object.values(JobStatus)) expect(PRIMARY_ACTION_BY_STATUS[status]).toBeDefined();
  });

  it("matches the four drawn states and the submitted board", () => {
    expect(primaryActionFor({ ...base, status: "UNASSIGNED" })).toMatchObject({ label: "Assign cleaner", href: "#s-dispatch", disabledReason: null });
    expect(primaryActionFor({ ...base, status: "SUBMITTED" })).toMatchObject({ label: "Review and approve", href: "#s-submitted" });
    expect(primaryActionFor({ ...base, status: "IN_PROGRESS" })).toMatchObject({ label: "Message team" });
    // Owner decision 2026-11-13: a dialog (no link); disabled with the reason when nobody is assigned or the viewer may not send.
    expect(primaryActionFor({ ...base, status: "IN_PROGRESS", teamMessage: { assignedCount: 2, refusal: null } })).toMatchObject({ href: null, disabledReason: null });
    expect(primaryActionFor({ ...base, status: "ASSIGNED", teamMessage: { assignedCount: 0, refusal: null } })?.disabledReason).toMatch(/Nobody is assigned/);
    expect(primaryActionFor({ ...base, status: "ASSIGNED", teamMessage: { assignedCount: 1, refusal: "Messages cannot be sent while impersonating." } })?.disabledReason).toBe("Messages cannot be sent while impersonating.");
    expect(primaryActionFor({ ...base, status: "INVOICED", liveInvoice: { id: "inv_9", invoiceNumber: "INV-0421" } })).toMatchObject({
      label: "Open invoice INV-0421",
      href: "/v2/admin/finance/invoices/inv_9",
    });
    expect(primaryActionFor({ ...base, status: "CANCELLED" })).toMatchObject({ label: "Restore job", href: null, disabledReason: null });
  });

  it("keeps Open invoice visible but disabled, with the reason, when nothing is invoiced", () => {
    const action = primaryActionFor({ ...base, status: "COMPLETED" });
    expect(action?.label).toBe("Open invoice");
    expect(action?.disabledReason).toMatch(/Not invoiced yet/);
  });

  it("explains why a cancelled job cannot be restored, and refuses changes to view-only viewers", () => {
    expect(primaryActionFor({ ...base, status: "CANCELLED", restoreRefusal: "It had started." })?.disabledReason).toBe("It had started.");
    expect(primaryActionFor({ ...base, status: "CANCELLED", readOnly: true })?.disabledReason).toBe(VIEW_ONLY_REASON);
    expect(primaryActionFor({ ...base, status: "UNASSIGNED", readOnly: true })?.disabledReason).toBe(VIEW_ONLY_REASON);
  });

  it("gives an unknown status no primary action", () => {
    expect(primaryActionFor({ ...base, status: "SOMETHING_NEW" })).toBeNull();
  });
});

describe("reminder eligibility", () => {
  it("is offered when paused or running for over 24 hours", () => {
    expect(reminderEligibility({ status: "PAUSED", runningSince: null, now }).eligible).toBe(true);
    expect(reminderEligibility({ status: "IN_PROGRESS", runningSince: new Date(now.getTime() - REMINDER_STALE_MS - 1000), now }).eligible).toBe(true);
  });

  it("is withheld with a reason otherwise", () => {
    const fresh = reminderEligibility({ status: "IN_PROGRESS", runningSince: new Date(now.getTime() - 60_000), now });
    expect(fresh.eligible).toBe(false);
    expect(fresh.reason).toMatch(/paused or has been running for over 24 hours/);
    expect(reminderEligibility({ status: "IN_PROGRESS", runningSince: null, now }).eligible).toBe(false);
  });
});

describe("secondary actions", () => {
  const reminder = { eligible: false, reason: "Offered when paused." };
  it("draws the buttons for each state", () => {
    expect(secondaryActionsFor({ jobId: "j", status: "SUBMITTED", reminder, hasSubmission: true, readOnly: false }).map((a) => a.label)).toEqual(["Message", "Send back for rework"]);
    expect(secondaryActionsFor({ jobId: "j", status: "UNASSIGNED", reminder, hasSubmission: false, readOnly: false }).map((a) => a.label)).toEqual(["Message"]);
    expect(secondaryActionsFor({ jobId: "j", status: "CANCELLED", reminder, hasSubmission: false, readOnly: false }).map((a) => a.label)).toEqual(["Message client"]);
    expect(secondaryActionsFor({ jobId: "j", status: "INVOICED", reminder, hasSubmission: true, readOnly: false }).map((a) => a.label)).toEqual(["Share report"]);
  });

  it("keeps Send reminder visible but disabled while the job is running normally", () => {
    const [action] = secondaryActionsFor({ jobId: "j", status: "IN_PROGRESS", reminder, hasSubmission: false, readOnly: false });
    expect(action).toMatchObject({ label: "Send reminder", disabledReason: "Offered when paused." });
  });

  it("links Message to the Messages tab with the chat anchor", () => {
    const [message] = secondaryActionsFor({ jobId: "a b", status: "UNASSIGNED", reminder, hasSubmission: false, readOnly: false });
    expect(message.href).toBe("/v2/admin/jobs/a%20b?view=messages#chat");
  });
});

describe("status badge", () => {
  it("uses the drawn words and tones", () => {
    expect(jobStatusBadge("SUBMITTED")).toEqual({ label: "Submitted, awaiting review", tone: "gold" });
    expect(jobStatusBadge("UNASSIGNED").tone).toBe("danger");
    expect(jobStatusBadge("CANCELLED").tone).toBe("danger");
    expect(jobStatusBadge("NEW_STATUS").tone).toBe("neutral");
  });
});

const menuInput = (overrides: Partial<JobMenuInput> = {}): JobMenuInput => ({
  jobId: "job_1",
  status: "ASSIGNED",
  actorIsAdmin: true,
  readOnly: false,
  reminder: { eligible: false, reason: "Offered when paused." },
  hasSubmission: false,
  hasTimeLogs: false,
  skipStatus: "NONE",
  ...overrides,
});

describe("More menu", () => {
  it("lists the job group then the danger zone", () => {
    const menu = moreMenuFor(menuInput());
    expect(menu.map((entry) => entry.key)).toEqual([
      "edit-details", "reschedule", "change-status", "skip", "send-reminder", "save-template", "download-report", "open-live-ops", "reset", "cancel", "delete",
    ]);
    expect(menu.filter((entry) => entry.group === "danger").map((entry) => entry.key)).toEqual(["reset", "cancel", "delete"]);
  });

  it("disables Cancel on an invoiced job with the drawn reason", () => {
    const cancel = moreMenuFor(menuInput({ status: "INVOICED" })).find((entry) => entry.key === "cancel");
    expect(cancel?.disabledReason).toBe("Invoiced jobs cannot be cancelled.");
  });

  it("disables Cancel of a started job for an operations manager, as the cancel rules do", () => {
    expect(cancelUnavailableReason("IN_PROGRESS", false)).toBe("Only an administrator can cancel a job that has started.");
    expect(cancelUnavailableReason("IN_PROGRESS", true)).toBeNull();
    expect(cancelUnavailableReason("ASSIGNED", false)).toBeNull();
  });

  it("keeps Send reminder with its condition and reason", () => {
    const reminder = moreMenuFor(menuInput()).find((entry) => entry.key === "send-reminder");
    expect(reminder).toMatchObject({ badge: "Paused or 24 h+", disabledReason: "Offered when paused." });
    const eligible = moreMenuFor(menuInput({ status: "PAUSED", reminder: { eligible: true, reason: null } })).find((entry) => entry.key === "send-reminder");
    expect(eligible?.disabledReason).toBeNull();
  });

  it("adds Edit clock and GPS once there are clock records or the job is running", () => {
    expect(moreMenuFor(menuInput()).some((entry) => entry.key === "edit-clock")).toBe(false);
    expect(moreMenuFor(menuInput({ status: "IN_PROGRESS" })).find((entry) => entry.key === "edit-clock")?.href).toBe("/v2/admin/jobs/job_1?view=clock");
  });

  it("names the skip entry by the skip state", () => {
    expect(moreMenuFor(menuInput({ skipStatus: "REQUESTED" })).find((entry) => entry.key === "skip")?.label).toBe("Review skip request");
    expect(moreMenuFor(menuInput({ skipStatus: "SKIPPED" })).find((entry) => entry.key === "skip")?.label).toBe("Restore skipped clean");
  });

  it("hides Edit, Reschedule and Skip on a cancelled job and keeps Delete", () => {
    const keys = moreMenuFor(menuInput({ status: "CANCELLED" })).map((entry) => entry.key);
    expect(keys).toEqual(["download-report", "delete"]);
  });

  it("disables every change for a view-only viewer but keeps navigation", () => {
    const menu = moreMenuFor(menuInput({ readOnly: true }));
    for (const entry of menu.filter((item) => item.href === null && item.key !== "download-report")) {
      expect(entry.disabledReason).toBe(VIEW_ONLY_REASON);
    }
    expect(menu.find((entry) => entry.key === "open-live-ops")?.disabledReason).toBeNull();
  });

  it("disables Download report until there is a submission", () => {
    expect(moreMenuFor(menuInput()).find((entry) => entry.key === "download-report")?.disabledReason).toMatch(/No submitted job form/);
    expect(moreMenuFor(menuInput({ hasSubmission: true })).find((entry) => entry.key === "download-report")?.disabledReason).toBeNull();
  });
});
