import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobHeaderActions, type JobHeaderActionsProps } from "@/components/v2/admin/jobs/detail/job-header-actions";
import { CancelledLead, JobRestoreProvider } from "@/components/v2/admin/jobs/detail/job-restore";
import { primaryActionFor, reminderEligibility, secondaryActionsFor } from "@/lib/jobs/job-page/primary-action";
import { JOB_MENU_FOOTNOTE, CANCELLED_MENU_FOOTNOTE, moreMenuFor } from "@/lib/jobs/job-page/more-menu";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

const manageJob = {
  id: "job_1", updatedAt: "2026-11-12T00:00:00.000Z", jobTasks: [], jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", status: "ASSIGNED",
  scheduledDate: "2026-11-12T00:00:00.000Z", startTime: "09:30", dueTime: "12:30", endTime: null, estimatedHours: 2.5, actualHours: null,
  completedAt: null, notes: null, fixedPrice: 245, invoiceNote: null, internalNotes: null, cleanSkipStatus: "NONE",
  property: { name: "Glebe House" }, assignments: [], submission: null,
} as unknown as JobHeaderActionsProps["manageJob"];

function props(status: string, overrides: Partial<JobHeaderActionsProps> = {}, options: { actorIsAdmin?: boolean; readOnly?: boolean; liveInvoice?: { id: string; invoiceNumber: string } | null } = {}): JobHeaderActionsProps {
  const readOnly = options.readOnly ?? false;
  const reminder = reminderEligibility({ status, runningSince: null, now: new Date() });
  return {
    jobId: "job_1",
    jobLabel: "Glebe House · Thu 12 Nov 2026",
    statusLabel: status,
    status,
    primary: primaryActionFor({ jobId: "job_1", status, liveInvoice: options.liveInvoice ?? null, restoreRefusal: null, readOnly }),
    secondary: secondaryActionsFor({ jobId: "job_1", status, reminder, hasSubmission: true, readOnly }),
    menu: moreMenuFor({ jobId: "job_1", status, actorIsAdmin: options.actorIsAdmin ?? true, readOnly, reminder, hasSubmission: true, hasTimeLogs: false, skipStatus: "NONE" }),
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
      <CancelledLead cancelledLine="Cancelled Wed 11 Nov 16:20 by Priya (Ops Manager)" reason="Tenant extended the lease." restoreRefusal={null} />
    </JobRestoreProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /More/ }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

describe("job header actions", () => {
  it("shows the submitted state's buttons with Review and approve as the one primary", () => {
    renderActions(props("SUBMITTED"));
    expect(screen.getByRole("link", { name: "Review and approve" })).toHaveAttribute("href", "#s-submitted");
    expect(screen.getByRole("link", { name: "Message" })).toHaveAttribute("href", "/v2/admin/jobs/job_1?view=messages#chat");
    expect(screen.getByRole("button", { name: "Send back for rework" })).toBeEnabled();
  });

  it("shows Assign cleaner for an unassigned job and Open invoice for an invoiced one", () => {
    const { unmount } = renderActions(props("UNASSIGNED"));
    expect(screen.getByRole("link", { name: "Assign cleaner" })).toHaveAttribute("href", "#s-dispatch");
    unmount();
    renderActions(props("INVOICED", {}, { liveInvoice: { id: "inv_1", invoiceNumber: "INV-0421" } }));
    expect(screen.getByRole("link", { name: "Open invoice INV-0421" })).toHaveAttribute("href", "/v2/admin/finance/invoices/inv_1");
    expect(screen.getByRole("link", { name: "Share report" })).toBeInTheDocument();
  });

  it("keeps Send reminder visible but disabled, with its reason, while running normally", () => {
    renderActions(props("IN_PROGRESS"));
    const reminder = screen.getByRole("button", { name: "Send reminder" });
    expect(reminder).toBeDisabled();
    expect(reminder).toHaveAccessibleDescription(/paused or has been running for over 24 hours/);
    // Owner decision 2026-11-13: Message team opens a dialog to the assigned cleaners; with nobody
    // known to be assigned it stays visible, disabled, with the reason.
    expect(screen.getByRole("button", { name: "Message team" })).toBeDisabled();
  });

  it("opens the Message team dialog when cleaners are assigned and the viewer may send", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      job: { id: "job_1", label: "J-1 at Glebe House" }, recipients: [{ id: "c1", name: "Mia", hasPhone: true }],
      transports: { INBOX: { available: true, reason: null }, PUSH: { available: true, reason: null }, SMS: { available: false, reason: "SMS is not configured." } },
      saved: null, savedReadable: true, title: "Message from the office: J-1 at Glebe House", bodyMax: 600,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const primary = primaryActionFor({ jobId: "job_1", status: "IN_PROGRESS", liveInvoice: null, restoreRefusal: null, readOnly: false, teamMessage: { assignedCount: 1, refusal: null } });
    renderActions(props("IN_PROGRESS", { primary }));
    fireEvent.click(screen.getByRole("button", { name: "Message team" }));
    const dialog = await screen.findByRole("dialog", { name: "Message team" });
    expect(await within(dialog).findByText("Mia")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/jobs/job_1/office-message", expect.objectContaining({ cache: "no-store" }));
  });

  it("groups the More menu into Job and Danger zone, with reasons on disabled items", () => {
    renderActions(props("INVOICED", {}, { liveInvoice: { id: "inv_1", invoiceNumber: "INV-0421" } }));
    const menu = openMenu();
    expect(within(menu).getByText("Job")).toBeInTheDocument();
    expect(within(menu).getByText("Danger zone")).toBeInTheDocument();
    const cancel = within(menu).getByRole("menuitem", { name: /Cancel job/ });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).toHaveTextContent("Invoiced jobs cannot be cancelled.");
    expect(within(menu).getByRole("menuitem", { name: /Send reminder to cleaners/ })).toHaveTextContent("Paused or 24 h+");
    expect(within(menu).getByText(JOB_MENU_FOOTNOTE)).toBeInTheDocument();
  });

  it("opens the existing dialog an item names", () => {
    renderActions(props("ASSIGNED"));
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Save job as template" }));
    expect(screen.getByRole("button", { name: "Save template" })).toBeInTheDocument();
  });

  it("opens Reschedule on arrival from an old schedule link, and the menu from a danger link", () => {
    const { unmount } = renderActions(props("ASSIGNED", { initialOpen: "reschedule" }));
    expect(screen.getByRole("button", { name: "Apply reschedule" })).toBeInTheDocument();
    unmount();
    renderActions(props("ASSIGNED", { initialOpen: "menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("hides Edit, Reschedule and Skip on a cancelled job", () => {
    renderActions(props("CANCELLED"));
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitem", { name: /Edit job details/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /Delete job/ })).toBeInTheDocument();
  });
});

describe("restore from the header", () => {
  it("shows conflicts in the cancelled notice with the existing choices, and retries without the cleaner", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "RESTORE_CONFLICT", conflicts: [{ userId: "sam", name: "Sam O.", reason: "Booked at 09:00 on Fri 13 Nov." }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "ASSIGNED", notRestored: [{ reason: "skipped" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderActions(props("CANCELLED"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore job" }));
    });
    expect(await screen.findByText(/Sam O.: Booked at 09:00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep cancelled" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore without them" }));
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ skipUserIds: ["sam"] });
    expect(screen.getByRole("status")).toHaveTextContent("Restored as assigned. 1 cleaner was not put back.");
  });

  it("disables Restore job with the reason when the job cannot be restored", () => {
    const p = props("CANCELLED");
    renderActions({ ...p, primary: primaryActionFor({ jobId: "job_1", status: "CANCELLED", liveInvoice: null, restoreRefusal: "This job had started when it was cancelled.", readOnly: false }) });
    expect(screen.getByRole("button", { name: "Restore job" })).toBeDisabled();
  });
});
