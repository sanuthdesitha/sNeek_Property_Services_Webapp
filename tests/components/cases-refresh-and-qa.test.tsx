/**
 * Cases: the restored manual Refresh (parity with the old screen) and the
 * "Raise QA issue for cleaner" next step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { useCaseList } from "@/components/v2/admin/cases/use-case-list";
import { useCaseDetail } from "@/components/v2/admin/cases/use-case-detail";
import { CaseList } from "@/components/v2/admin/cases/case-list";
import { CaseDetailsPanel } from "@/components/v2/admin/cases/case-details-panel";
import { CaseRaiseQaDialog, QUALITY_FIGURES_NOTE } from "@/components/v2/admin/cases/case-raise-qa-dialog";
import { EMPTY_FILTERS, type CaseDetail } from "@/components/v2/admin/cases/case-types";
import type { CaseLinkedContext } from "@/lib/cases/linked-context";

afterEach(() => vi.unstubAllGlobals());

const detail = (patch: Partial<CaseDetail> = {}): CaseDetail => ({
  id: "c1", title: "Shower screen dirty", description: "", severity: "MEDIUM", status: "OPEN", slaBreachAt: null, caseType: "CLIENT_DISPUTE",
  clientVisible: false, clientCanReply: true, resolutionNote: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  source: null, jobId: "job-1", reportId: null, clientId: null, propertyId: null, comments: [], attachments: [], ...patch,
});

const linked = (cleaners: CaseLinkedContext["cleaners"]): CaseLinkedContext => ({
  job: { id: "job-1", jobNumber: "J-1", scheduledDate: "2026-11-10T00:00:00Z", status: "COMPLETED" }, property: null, client: null, cleaners,
  departingGuest: null, report: null, evidence: { jobPhotos: 2, clientAttachments: 0, officeAttachments: 0 },
  nextSteps: { repairQuoteHref: "/q", clientDraftInvoicesHref: null, newInvoiceHref: "/i" },
});

const summary = { rows: [], total: 0, page: 1, pageCount: 1, counts: { mine: 0 }, typeCounts: {}, assignees: [], viewer: { id: "me", name: null, email: null, role: "ADMIN" } };

describe("manual Refresh", () => {
  it("re-reads list and counts, aborting the older read", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => summary }), 300));
    }));
    const { result } = renderHook(() => useCaseList("queue=all"));
    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => result.current.reload());
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.counts).toEqual({ mine: 0 });
  });

  it("re-reads the open case without blanking it and ignores a late answer for a previous case", async () => {
    let title = "First";
    const pending: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const body = url.endsWith("/linked") ? linked([]) : detail({ id: url.split("/").pop() ?? "", title });
      return new Promise((resolve) => pending.push(() => resolve({ ok: true, json: async () => body })));
    }));
    const { result, rerender } = renderHook(({ id }) => useCaseDetail(id), { initialProps: { id: "c1" as string | null } });
    await act(async () => { pending.splice(0).forEach((go) => go()); });
    await waitFor(() => expect(result.current.detail?.title).toBe("First"));
    title = "Refreshed";
    act(() => result.current.refresh());
    expect(result.current.detail?.title).toBe("First"); // still on screen while refreshing
    await act(async () => { pending.splice(0).forEach((go) => go()); });
    await waitFor(() => expect(result.current.detail?.title).toBe("Refreshed"));

    act(() => result.current.refresh());
    const late = pending.splice(0);
    rerender({ id: "c2" });
    await act(async () => { pending.splice(0).forEach((go) => go()); });
    await act(async () => { late.forEach((go) => go()); });
    await waitFor(() => expect(result.current.detail?.id).toBe("c2"));
  });

  it("puts a Refresh control in the list header", () => {
    const onRefresh = vi.fn();
    render(
      <CaseList rows={[]} status="success" error="" refreshFailed={false} total={0} page={1} sort="sla" dir="asc" filters={EMPTY_FILTERS}
        assignees={[]} viewer={null} openId={null} selected={new Set()} onOpen={vi.fn()} onToggle={vi.fn()} onToggleAll={vi.fn()} onSort={vi.fn()}
        onFilters={vi.fn()} onPage={vi.fn()} onRetry={vi.fn()} onRefresh={onRefresh} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("Raise QA issue for cleaner", () => {
  const panel = (cleaners: CaseLinkedContext["cleaners"]) => (
    <CaseDetailsPanel detail={detail()} linked={linked(cleaners)} linkedStatus="success" assignees={[]} viewer={null} saving={false} onSave={vi.fn()} onRaiseQaIssue={vi.fn()} />
  );

  it("is a next step only when the linked job has an assigned cleaner", () => {
    const { rerender } = render(panel([]));
    expect(screen.queryByRole("button", { name: "Raise QA issue for cleaner" })).toBeNull();
    rerender(panel([{ id: "cl1", name: "Aiko", isPrimary: true }]));
    expect(screen.getByRole("button", { name: "Raise QA issue for cleaner" })).toBeInTheDocument();
  });

  const options = {
    caseId: "c1", jobId: "job-1", canRaise: true,
    cleaners: [{ id: "cl1", name: "Aiko" }, { id: "cl2", name: "Marco" }],
    categories: [{ key: "bathroom", label: "Bathroom" }], severities: ["MINOR", "MAJOR", "CRITICAL"],
    jobPhotos: [{ id: "m1", label: "Job photo 1 (shower)", createdAt: "x" }], attachments: [{ id: "a1", label: "Client photo" }], raised: [],
  };

  it("states it counts in quality figures, posts one keyed request and keeps the draft on failure", async () => {
    let fail = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/admin/quality/issues/case-options")) return new Response(JSON.stringify(options), { status: 200 });
      if (fail) return new Response(JSON.stringify({ error: "That cleaner is not assigned to the case's job." }), { status: 400 });
      return new Response(JSON.stringify({ issueId: "i1", duplicate: false, href: "/v2/admin/quality?tab=issues&q=i1" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onRaised = vi.fn();
    render(<CaseRaiseQaDialog open detail={detail()} onClose={vi.fn()} onRaised={onRaised} />);
    const dialog = await screen.findByRole("dialog", { name: "Raise QA issue for cleaner" });
    await within(dialog).findByLabelText("Cleaner");
    expect(within(dialog).getByText(new RegExp(QUALITY_FIGURES_NOTE.slice(0, 40)))).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Description (the cleaner sees it)")).toHaveValue("Shower screen dirty");
    fireEvent.change(within(dialog).getByLabelText("Cleaner"), { target: { value: "cl2" } });
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "bathroom" } });
    fireEvent.change(within(dialog).getByLabelText("Severity"), { target: { value: "MAJOR" } });
    fireEvent.click(within(dialog).getByLabelText("Client photo"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Raise issue" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That cleaner is not assigned to the case's job.");
    expect(within(dialog).getByLabelText("Cleaner")).toHaveValue("cl2");
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Raise issue" }));
    expect(await within(dialog).findByText(/QA issue raised/)).toBeInTheDocument();
    expect(onRaised).toHaveBeenCalledTimes(1);
    const posts = fetchMock.mock.calls.filter(([url]) => url === "/api/admin/quality/issues");
    const bodies = posts.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies[0]).toMatchObject({ caseId: "c1", cleanerId: "cl2", category: "bathroom", severity: "MAJOR", attachmentIds: ["a1"], jobMediaIds: [] });
    // The retry is the same request (same key).
    expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
    expect(within(dialog).getByRole("link", { name: "Open in Quality" })).toHaveAttribute("href", "/v2/admin/quality?tab=issues&q=i1");
  });

  it("says plainly when the viewer cannot raise one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...options, canRaise: false }), { status: 200 })));
    render(<CaseRaiseQaDialog open detail={detail()} onClose={vi.fn()} onRaised={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Raise QA issue for cleaner" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("cannot raise QA issues");
    expect(within(dialog).getByRole("button", { name: "Raise issue" })).toBeDisabled();
  });
});
