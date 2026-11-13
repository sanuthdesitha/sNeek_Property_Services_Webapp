import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobHeaderActions, type JobHeaderActionsProps } from "@/components/v2/admin/jobs/detail/job-header-actions";
import { JobRestoreProvider } from "@/components/v2/admin/jobs/detail/job-restore";
import { StageShell } from "@/components/v2/admin/jobs/detail/stage-shell";
import { PhoneFold } from "@/components/v2/admin/phone-fold";
import { PhoneCarousel } from "@/components/v2/admin/phone-carousel";
import { primaryActionFor, reminderEligibility, secondaryActionsFor } from "@/lib/jobs/job-page/primary-action";
import { JOB_MENU_FOOTNOTE, CANCELLED_MENU_FOOTNOTE, moreMenuFor } from "@/lib/jobs/job-page/more-menu";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";

/** The admin job page on a phone (board M-JobDetail, 2026-11). */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
beforeEach(() => setPhone(true));
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const manageJob = {
  id: "job_1", updatedAt: "2026-11-12T00:00:00.000Z", jobTasks: [], jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", status: "ASSIGNED",
  scheduledDate: "2026-11-12T00:00:00.000Z", startTime: "09:30", dueTime: "12:30", endTime: null, estimatedHours: 2.5, actualHours: null,
  completedAt: null, notes: null, fixedPrice: 245, invoiceNote: null, internalNotes: null, cleanSkipStatus: "NONE",
  property: { name: "Glebe House" }, assignments: [], submission: null,
} as unknown as JobHeaderActionsProps["manageJob"];

function props(status: string, overrides: Partial<JobHeaderActionsProps> = {}, liveInvoice: { id: string; invoiceNumber: string } | null = null): JobHeaderActionsProps {
  const reminder = reminderEligibility({ status, runningSince: null, now: new Date() });
  return {
    jobId: "job_1",
    jobLabel: "Glebe House · Thu 12 Nov 2026",
    statusLabel: status,
    status,
    primary: primaryActionFor({ jobId: "job_1", status, liveInvoice, restoreRefusal: null, readOnly: false }),
    secondary: secondaryActionsFor({ jobId: "job_1", status, reminder, hasSubmission: true, readOnly: false }),
    menu: moreMenuFor({ jobId: "job_1", status, actorIsAdmin: true, readOnly: false, reminder, hasSubmission: true, hasTimeLogs: false, skipStatus: "NONE" }),
    menuFootnote: status === "CANCELLED" ? CANCELLED_MENU_FOOTNOTE : JOB_MENU_FOOTNOTE,
    initialOpen: null,
    manageJob,
    hasQaReview: false,
    ...overrides,
  };
}

function renderActions(p: JobHeaderActionsProps) {
  return render(
    <JobRestoreProvider jobId={p.jobId}>
      <JobHeaderActions {...p} />
    </JobRestoreProvider>,
  );
}

function bar() {
  return screen.getByRole("region", { name: "Job actions" });
}

function openSheet() {
  fireEvent.click(within(bar()).getByRole("button", { name: "More job actions" }));
  return screen.getByRole("dialog", { name: "Job actions" });
}

describe("job page phone action bar", () => {
  it("docks the status's one primary action with More, per state", () => {
    const cases: Array<[string, string, { id: string; invoiceNumber: string } | null]> = [
      ["UNASSIGNED", "Assign cleaner", null],
      ["SUBMITTED", "Review and approve", null],
      ["INVOICED", "Open invoice INV-0421", { id: "inv_1", invoiceNumber: "INV-0421" }],
      ["CANCELLED", "Restore job", null],
    ];
    for (const [status, label, invoice] of cases) {
      const { unmount } = renderActions(props(status, {}, invoice));
      const region = bar();
      expect(within(region).getByRole(status === "CANCELLED" ? "button" : "link", { name: label })).toBeInTheDocument();
      expect(within(region).getByRole("button", { name: "More job actions" })).toBeInTheDocument();
      unmount();
    }
    const { unmount } = renderActions(props("IN_PROGRESS"));
    expect(within(bar()).getByRole("button", { name: "Message team" })).toBeDisabled();
    unmount();
  });

  it("never puts the Send back dialog inside the docked bar; the sheet jumps to the Submitted stage", () => {
    renderActions(props("SUBMITTED"));
    expect(within(bar()).queryByRole("button", { name: "Send back for rework" })).toBeNull();
    expect(within(bar()).getByRole("link", { name: "Message" })).toBeInTheDocument();
    const sheet = openSheet();
    expect(within(sheet).getByRole("link", { name: /Send back for rework/ })).toHaveAttribute("href", "#s-submitted");
    // Secondary actions that do not fit the bar lead the sheet.
    expect(within(sheet).getByText("This job now")).toBeInTheDocument();
  });

  it("lists every desktop More item in the sheet, with groups, reasons and the footnote", () => {
    const p = props("INVOICED", {}, { id: "inv_1", invoiceNumber: "INV-0421" });
    renderActions(p);
    const sheet = openSheet();
    for (const entry of p.menu) {
      const item = within(sheet).getByRole(entry.href && !entry.disabledReason ? "link" : "button", { name: new RegExp(entry.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      if (entry.disabledReason) expect(item).toBeDisabled();
    }
    expect(within(sheet).getByText("Danger zone")).toBeInTheDocument();
    expect(within(sheet).getByText("Invoiced jobs cannot be cancelled.")).toBeInTheDocument();
    expect(within(sheet).getByText(JOB_MENU_FOOTNOTE)).toBeInTheDocument();
  });

  it("opens the existing dialog an item names, after closing the sheet", () => {
    renderActions(props("ASSIGNED"));
    fireEvent.click(within(openSheet()).getByRole("button", { name: "Save job as template" }));
    expect(screen.queryByRole("dialog", { name: "Job actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save template" })).toBeInTheDocument();
  });

  it("opens the sheet, not the desktop menu, on arrival from a danger link", () => {
    renderActions(props("ASSIGNED", { initialOpen: "menu" }));
    expect(screen.getByRole("dialog", { name: "Job actions" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws no phone bar or sheet from 640px up", () => {
    setPhone(false);
    renderActions(props("SUBMITTED"));
    expect(screen.queryByRole("region", { name: "Job actions" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /More/ })).toHaveLength(1);
  });
});

describe("job timeline and rail on a phone", () => {
  const done: TimelineStage = { key: "booking", anchor: "s-booking", label: "Booking", eyebrow: "1 · Booking", state: "done", headline: "From the Airbnb calendar" } as TimelineStage;

  it("folds a finished stage to its headline and opens it from a link inside", async () => {
    render(<StageShell stage={done}><p id="booking-guest">Sofia Bianchi</p></StageShell>);
    const toggle = screen.getByRole("button", { name: "Show details: Booking" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Sofia Bianchi").parentElement).toHaveAttribute("hidden");
    await act(async () => {
      window.location.hash = "#booking-guest";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("button", { name: "Hide details: Booking" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps stage, fold and carousel markup unchanged from 640px up", () => {
    setPhone(false);
    const { container } = render(
      <>
        <StageShell stage={done}><p>Sofia Bianchi</p></StageShell>
        <PhoneFold><p>Body</p></PhoneFold>
        <PhoneCarousel label="Job progress"><ol aria-label="Job progress"><li aria-current="step">Review</li></ol></PhoneCarousel>
      </>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector("[data-phone-fold],[data-phone-carousel]")).toBeNull();
    expect(screen.getByText("Body").parentElement).toBe(container);
  });

  it("puts the stage bar in a carousel on a phone", () => {
    render(<PhoneCarousel label="Job progress, swipe"><ol><li>Booked</li><li aria-current="step">Review</li></ol></PhoneCarousel>);
    expect(screen.getByRole("region", { name: "Job progress, swipe" })).toContainElement(screen.getByText("Review"));
  });

  it("gives the section switcher a target for every stage and the rail", () => {
    // Stage targets are the stage anchors (StageShell's id); the rail is "job-details".
    render(<StageShell stage={done}>x</StageShell>);
    expect(document.getElementById("s-booking")).not.toBeNull();
    const page = readFileSync(path.join(process.cwd(), "app/v2/admin/jobs/[id]/page.tsx"), "utf8");
    expect(page).toContain("model.timeline.map((stage) => ({ id: stage.anchor");
    expect(page).toContain('{ id: "job-details", label: "Details" }');
    const rail = readFileSync(path.join(process.cwd(), "components/v2/admin/jobs/detail/job-rail.tsx"), "utf8");
    expect(rail).toContain('<aside id="job-details"');
  });
});
