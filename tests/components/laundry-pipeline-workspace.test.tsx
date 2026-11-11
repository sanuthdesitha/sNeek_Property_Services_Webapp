import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/components/v2/admin/laundry/laundry-live", () => ({ LaundryLive: () => <p>Live board</p> }));
vi.mock("@/components/v2/admin/laundry/laundry-reports", () => ({ LaundryReports: ({ task }: { task?: { name: string } | null }) => <p>Reports for {task?.name ?? "all"}</p> }));
vi.mock("@/components/v2/admin/laundry/laundry-new-run", () => ({ LaundryNewRun: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-edit-dialog", () => ({ LaundryEditDialog: ({ task }: { task: { id: string } | null }) => (task ? <p>Editing {task.id}</p> : null) }));
vi.mock("@/components/v2/admin/laundry/laundry-suppliers", () => ({ LaundrySuppliers: () => <p>Supplier list</p> }));
vi.mock("@/components/v2/laundry/laundry-delete-dialog", () => ({ useLaundryDeleteDialog: () => ({ requestDelete: (task: { id: string }) => deleted.push(task.id), modal: null }) }));
vi.mock("@/components/shared/media-gallery", () => ({ MediaGallery: () => <p>Gallery</p> }));
vi.mock("@/components/v2/admin/laundry/laundry-evidence-replacement", () => ({ LaundryEvidenceReplacement: () => <button type="button">Replace photo</button> }));
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";
import { LaundryRunPanel } from "@/components/v2/admin/laundry/laundry-run-panel";

const deleted: string[] = [];
const card = {
  id: "t1", status: "CONFIRMED", pickupDate: "2026-11-11T00:00:00.000Z", dropoffDate: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z",
  jobId: "j1", job: { id: "j1", jobNumber: "J-1040", scheduledDate: "2026-11-11T00:00:00.000Z", status: "IN_PROGRESS" },
  property: { id: "p", name: "Coogee Terrace", suburb: "Coogee" }, supplier: { id: "s", name: "CleanCo" },
  confirmations: [{ id: "c1", photoUrl: "https://x/p.jpg", laundryReady: false, confirmedByName: "Jane", createdAt: "2026-11-11T01:40:00Z", notes: "{}" }],
  lane: "pickup", carriedIn: false, exceptions: [{ code: "NOT_READY", label: "Not ready" }], readiness: false, bagCount: null, driver: null, dayOf: null,
  nextGuest: { checkinAt: "2026-11-14T04:00:00Z", name: null }, cleaners: ["Jane C."],
};
const pipeline = (date: string) => ({
  date, today: date, lanes: { pickup: [card], laundry: [], drop: [], delivered: [] }, counts: { pickup: 1, laundry: 0, drop: 0, delivered: 0 },
  summary: { pickups: 1, drops: 0, exceptions: 1 }, tiles: { runsToday: 1, inTransit: 0, deliveredToday: 0 }, drivers: [], suppliers: [],
  approvalsFlagged: 2, settings: { maxOutdoorDays: 3, requireDropoffPhoto: true }, truncated: false, generatedAt: new Date().toISOString(),
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function pipelineCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/laundry/pipeline")).length;
}

describe("Laundry workspace", () => {
  it("polls the pipeline every 30 s only while Pipeline is showing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => pipeline(new URL(`http://x${url}`).searchParams.get("date") ?? "2026-11-11") }));
    vi.stubGlobal("fetch", fetcher);
    render(<LaundryWorkspace />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(pipelineCalls(fetcher)).toBe(1);
    expect(screen.getByText("Coogee Terrace")).toBeInTheDocument();
    expect(screen.getByText(/1 pickup and 0 drops today · 1 exception/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Approvals \(2 flagged runs\)/ })).toHaveAttribute("href", "/v2/admin/approvals");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(pipelineCalls(fetcher)).toBe(2);
    fireEvent.click(screen.getByRole("tab", { name: "Suppliers" }));
    expect(screen.getByText("Supplier list")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(pipelineCalls(fetcher)).toBe(2);
  });

  it("old tab ids keep working (?tab=reports opens Costs and invoices)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    window.history.replaceState(null, "", "/v2/admin/laundry?tab=reports");
    render(<LaundryWorkspace />);
    expect(await screen.findByText("Reports for all")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Costs and invoices" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Run side panel", () => {
  it("exposes every old card action", () => {
    const onEdit = vi.fn(), onReschedule = vi.fn(), onDelete = vi.fn(), onReport = vi.fn();
    render(<LaundryRunPanel task={card as never} busy={false} onClose={vi.fn()} onEdit={onEdit} onReschedule={onReschedule} onDelete={onDelete} onReport={onReport} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Task report / PDF" }));
    fireEvent.click(screen.getByRole("button", { name: /Skip or delete/ }));
    expect([onEdit, onReschedule, onReport, onDelete].every((fn) => fn.mock.calls.length === 1)).toBe(true);
    expect(screen.getAllByRole("link", { name: /Open linked job|J-1040/ })[0]).toHaveAttribute("href", "/v2/admin/jobs/j1");
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeInTheDocument();
    expect(screen.getByText("Gallery")).toBeInTheDocument();
    expect(screen.getByText(/Jane: Not ready/)).toBeInTheDocument();
  });

  it("a delivered run cannot be rescheduled from the panel", () => {
    render(<LaundryRunPanel task={{ ...card, status: "DROPPED" } as never} busy={false} onClose={vi.fn()} onEdit={vi.fn()} onReschedule={vi.fn()} onDelete={vi.fn()} onReport={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reschedule" })).toBeDisabled();
  });
});
