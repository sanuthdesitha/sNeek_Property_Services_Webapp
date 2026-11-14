import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin Maintenance (boards "Maintenance", "Maintenance item" and the phone
 * frames, 2026-11-14): every function of the old list and item page stays
 * reachable, attention is a first-cell tint with a written reason, and the
 * phone layout docks one primary action.
 */
vi.mock("next/navigation", () => ({ useSearchParams: () => null, usePathname: () => "/v2/admin/maintenance", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { MaintenanceHub } from "@/components/v2/admin/maintenance/maintenance-hub";
import { EstateMaintenanceDetail } from "@/components/v2/admin/maintenance/maintenance-detail";
import { DEFAULT_MAINTENANCE_VIEW } from "@/components/v2/admin/maintenance/maintenance-view";

function media(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 639") ? phone : query.includes("max-width: 1023") ? phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, title: `Item ${id}`, area: "Kitchen", category: "APPLIANCE", recommendedAction: "REPAIR", priority: "MEDIUM", status: "OPEN", source: "CLEANER",
    clientVisible: true, createdAt: "2026-11-10T00:00:00.000Z", property: { id: "p1", name: "Bondi Beach House", suburb: "Bondi" }, job: null, reportedByName: "Maria",
    photoCount: 0, photoUrl: null, assignedWorker: null, roster: [], nobodyAssigned: true, scheduledFor: null, estimatedCost: null, quotedCost: null,
    costApprovalStatus: null, costDecidedAt: null, pricePending: false, attention: null, ...overrides,
  };
}

const LIST = {
  rows: [
    row("urgent", { title: "Smoke alarm chirping", priority: "URGENT", attention: { tone: "problem", reason: "Nobody assigned" } }),
    row("declined", { title: "Sofa bed mattress stained", status: "ACKNOWLEDGED", nobodyAssigned: false, assignedWorker: { id: "w1", name: "Dan", trade: "Plumber", company: "Eastside Plumbing", hasLogin: true }, quotedCost: 400, costApprovalStatus: "DECLINED", attention: { tone: "attention", reason: "Client declined price" } }),
  ],
  total: 2, page: 1, pageSize: 25, pageCount: 1, sort: "priority", dir: "desc",
  statusCounts: { open: 2, OPEN: 1, ACKNOWLEDGED: 1, IN_PROGRESS: 0, ORDERED: 0, RESOLVED: 18, DISMISSED: 3 },
  tiles: { open: 23, urgent: 3, urgentNobody: 1, nobody: 6, nobodyOldestDays: 4, waitingClient: 2, waitingClientQuoted: 640, visitsWeek: 5, visitsToday: 2, resolvedMonth: 18, dismissedMonth: 3 },
  timeZone: "Australia/Sydney",
};

const ITEM = {
  id: "item1", title: "Dishwasher not draining", description: "Water sitting in the base.", category: "APPLIANCE", area: "Kitchen", priority: "URGENT", status: "IN_PROGRESS",
  source: "CLEANER", recommendedAction: "REPAIR", estimatedCost: 180, quotedCost: 240, costApprovalStatus: "PENDING", costDecidedAt: null, clientVisible: true, caseId: "case1",
  jobId: "job1", job: { id: "job1", jobNumber: "J-1051", scheduledDate: "2026-11-10T00:00:00.000Z" },
  photos: [{ key: "k1", url: "https://x/1.jpg" }], finishPhotos: [], outcome: null, originalOutcome: null, workerNote: null, issuesNote: null,
  scheduledFor: "2026-11-12T21:00:00.000Z", shareAccess: true, enRouteAt: null, arrivedAt: null, clockInAt: null, clockOutAt: null, resolvedAt: null, resolutionNote: null,
  assignedAt: "2026-11-11T22:05:00.000Z", assignedWorker: { id: "w2", name: "Tony Russo", phone: "0412", email: null, trade: "Handyman", company: null, isPermanent: false, userId: null },
  contactPerson: null, contactPersonUserId: null, pings: [], property: { id: "p1", name: "Bondi Beach House", address: "12 Campbell Parade", suburb: "Bondi Beach", state: "NSW", postcode: "2026", latitude: null, longitude: null, placeId: null, clientId: "c1", client: { name: "Harbour View Stays", email: null, phone: "02 9130" } },
  events: [{ id: "e1", fromStatus: null, toStatus: "OPEN", note: "Reported", createdAt: "2026-11-10T00:42:00.000Z", user: { name: "Maria Santos", email: null, role: "CLEANER" } }],
  reportedBy: { name: "Maria Santos", email: null, role: "CLEANER" }, createdAt: "2026-11-10T00:42:00.000Z", assignmentInstructions: [],
};

const ROSTER = {
  assignments: [{ id: "as1", role: "MAINTENANCE", userId: "u1", assignedAt: "2026-11-11T22:05:00.000Z", removedAt: null, notifiedAt: null, acceptedAt: "2026-11-11T22:31:00.000Z", declinedAt: null, declineReason: null, completedAt: null, completionNote: null, payType: "FIXED", payAmount: 180, payHours: null, payPayer: "COMPANY", payChangeAmount: 220, payChangeReason: "Pump needs replacing", payChangeStatus: "PENDING", user: { id: "u1", name: "Dan Kowalski", email: "dan@x" } }],
  candidates: { MAINTENANCE: [{ id: "u1", name: "Dan Kowalski", email: "dan@x" }], CLEANER: [{ id: "u2", name: "Maria Santos", email: null }], QA: [] },
};

const WORKERS = { workers: [{ id: "w2", name: "Tony Russo", trade: "Handyman", company: null, phone: null, email: null, userId: null, isActive: true, isPermanent: false, openItems: 1, lastVisitAt: null }] };

function respond(url: string): Response {
  if (url.startsWith("/api/admin/maintenance?")) return new Response(JSON.stringify(LIST));
  if (url.startsWith("/api/admin/maintenance/workers")) return new Response(JSON.stringify(WORKERS));
  if (url.includes("/assignees")) return new Response(JSON.stringify(ROSTER));
  if (url.startsWith("/api/maintenance/")) return new Response(JSON.stringify({ item: ITEM }));
  return new Response(JSON.stringify({}), { status: 404 });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/v2/admin/maintenance");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = { initialView: DEFAULT_MAINTENANCE_VIEW, properties: [{ id: "p1", name: "Bondi Beach House", suburb: "Bondi" }], isAdmin: true, timeZone: "Australia/Sydney" };

describe("Maintenance list, desktop", () => {
  it("shows one heading, the real summary, tiles that never invent a zero, and the status bar counts", async () => {
    media(false);
    render(<MaintenanceHub {...props} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Loading the summary…")).toBeInTheDocument();
    await screen.findAllByText("Smoke alarm chirping");
    expect(screen.getByText(/23 open · 3 urgent · 2 waiting on a client price/)).toBeInTheDocument();
    const tiles = screen.getByRole("group", { name: /each tile filters the list/ });
    expect(within(tiles).getByRole("button", { name: /Waiting on client price/ })).toHaveTextContent("$640.00 quoted");
    expect(within(tiles).getByRole("button", { name: /Nobody assigned/ })).toHaveTextContent("oldest 4 days");
    fireEvent.click(within(tiles).getByRole("button", { name: /Nobody assigned/ }));
    expect(window.location.search).toContain("assigned=none");
  });

  it("tints the first cell of a row that needs someone and writes the reason beside the title", async () => {
    media(false);
    render(<MaintenanceHub {...props} />);
    const table = await screen.findByRole("table", { name: "Maintenance items" });
    const urgentRow = within(table).getByText("Smoke alarm chirping").closest("tr")!;
    expect(within(urgentRow).getByText("Nobody assigned")).toBeInTheDocument();
    const cells = urgentRow.querySelectorAll("td");
    expect(cells[1].className).toContain("band-problem-bg");
    expect(cells[2].className).not.toContain("band-");
    const declinedRow = within(table).getByText("Sofa bed mattress stained").closest("tr")!;
    expect(declinedRow.querySelectorAll("td")[1].className).toContain("band-attention-bg");
    expect(within(declinedRow).getByText("Declined")).toBeInTheDocument();
  });

  it("keeps every row action in the row menu: open, status, assign, visit, price, job, visibility, copy — and no delete", async () => {
    media(false);
    render(<MaintenanceHub {...props} />);
    const table = await screen.findByRole("table", { name: "Maintenance items" });
    fireEvent.click(within(table).getByRole("button", { name: "More for Smoke alarm chirping" }));
    const menu = await screen.findByRole("menu");
    const labels = within(menu).getAllByRole("menuitem").map((item) => item.textContent ?? "");
    for (const expected of ["Open full page", "Acknowledge", "Mark in progress", "Mark ordered", "Mark resolved…", "Dismiss…", "Assign…", "Schedule visit…", "Send client price…", "Link to a job…", "Hide from the client", "Copy link"]) {
      expect(labels.some((label) => label.startsWith(expected)), expected).toBe(true);
    }
    expect(labels.some((label) => /delete/i.test(label))).toBe(false);
  });

  it("selecting rows shows the bulk bar with every status action and Assign…", async () => {
    media(false);
    render(<MaintenanceHub {...props} />);
    await screen.findByRole("table", { name: "Maintenance items" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Smoke alarm chirping" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    for (const label of ["Acknowledge", "Mark in progress", "Mark ordered", "Mark resolved…", "Dismiss…", "Assign…"]) expect(within(bar).getByRole("button", { name: label })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Dismiss…" }));
    const dialog = screen.getByRole("dialog", { name: /Dismiss: Smoke alarm chirping/ });
    expect(within(dialog).getByLabelText("Note for the history, optional")).toBeInTheDocument();
  });

  it("opens the side panel on ?open= with the full-page link carrying the list view back", async () => {
    media(false);
    render(<MaintenanceHub {...props} initialView={{ ...DEFAULT_MAINTENANCE_VIEW, open: "item1", price: "PENDING" }} />);
    const panel = await screen.findByRole("complementary", { name: "Item detail" });
    await within(panel).findByText("Dishwasher not draining");
    expect(within(panel).getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe(`/v2/admin/maintenance/item1?back=${encodeURIComponent("/v2/admin/maintenance?price=PENDING")}`);
    expect(within(panel).getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(within(panel).getByText(/awaiting client/)).toBeInTheDocument();
  });

  it("an unreadable list says so, keeps the filters and never shows 0 tiles", async () => {
    media(false);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.startsWith("/api/admin/maintenance?") ? new Response(JSON.stringify({ error: "Database unavailable" }), { status: 500 }) : respond(url))));
    render(<MaintenanceHub {...props} initialView={{ ...DEFAULT_MAINTENANCE_VIEW, priority: ["URGENT"] }} />);
    await screen.findByText("Could not load this list");
    const tiles = screen.getByRole("group", { name: /each tile filters the list/ });
    expect(within(tiles).getAllByText("–").length).toBeGreaterThan(0);
    expect(window.location.search).toBe("");
  });

  it("People and trades lists the workers with login state and offers portal login to administrators", async () => {
    media(false);
    render(<MaintenanceHub {...props} initialView={{ ...DEFAULT_MAINTENANCE_VIEW, tab: "people" }} />);
    await screen.findAllByText("Tony Russo");
    expect(screen.getByText("Ad hoc, no login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create portal login" })).toBeInTheDocument();
  });
});

describe("Maintenance list, phone", () => {
  it("stacks cards with one Assign… button only where nobody is on it, folds filters into a sheet and docks Report", async () => {
    media(true);
    render(<MaintenanceHub {...props} />);
    const list = await screen.findByRole("list", { name: "Maintenance items" });
    const cards = within(list).getAllByRole("listitem");
    expect(within(cards[0]).getByRole("button", { name: "Assign…" })).toBeInTheDocument();
    expect(within(cards[1]).queryByRole("button", { name: "Assign…" })).toBeNull();
    expect(cards[0].querySelector("[data-tone='problem']")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Maintenance actions" })).toHaveTextContent("+ Report");
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    for (const name of ["Property", "Priority", "Category", "Reported by", "Assigned to", "Client price", "Client sees it"]) expect(within(sheet).getAllByText(name).length).toBeGreaterThan(0);
  });
});

describe("Maintenance item page", () => {
  it("renders the record with every old function: photos, client price, visit, history, roster with pay, instructions, reassign, portal login", async () => {
    media(false);
    render(<EstateMaintenanceDetail itemId="item1" timeZone="Australia/Sydney" isAdmin />);
    expect(await screen.findByRole("heading", { level: 1, name: /Dishwasher not draining/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Progress" })).toBeInTheDocument();
    for (const title of ["What was reported", "Work completed photos", "Visit progress", "History", "Who is on this", "Visit and access", "Client price", "Linked records"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("Instructions for the assignee")).toBeInTheDocument();
    await screen.findByText("Dan Kowalski");
    expect(screen.getByRole("button", { name: "Approve $220.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create portal login" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update price" })).toBeInTheDocument();
    expect(screen.getByText(/an approved price does not create an invoice by itself/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Case/ })).toHaveAttribute("href", "/v2/admin/cases?open=case1");
    fireEvent.click(screen.getByRole("button", { name: /^More/ }));
    const menu = await screen.findByRole("menu");
    const labels = within(menu).getAllByRole("menuitem").map((item) => item.textContent ?? "");
    for (const expected of ["Edit details…", "Move to another job…", "Hide from the client", "Copy link", "Mark ordered", "Dismiss…"]) expect(labels.some((label) => label.startsWith(expected)), expected).toBe(true);
    expect(labels.some((label) => /delete/i.test(label))).toBe(false);
  });

  it("an operations manager sees the price request but not the approve action, nor portal login creation", async () => {
    media(false);
    render(<EstateMaintenanceDetail itemId="item1" timeZone="Australia/Sydney" isAdmin={false} />);
    await screen.findByText("Dan Kowalski");
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByText(/An administrator approves a higher price/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create portal login" })).toBeNull();
  });

  it("opens the assign sheet with Maintenance, Cleaner and QA", async () => {
    media(false);
    render(<EstateMaintenanceDetail itemId="item1" timeZone="Australia/Sydney" isAdmin />);
    await screen.findByText("Dan Kowalski");
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const sheet = await screen.findByRole("dialog", { name: /Assign · Dishwasher not draining/ });
    for (const name of ["Maintenance", "Cleaner", "QA"]) expect(within(sheet).getByRole("button", { name })).toBeInTheDocument();
    await within(sheet).findByText("Tony Russo");
    expect(within(sheet).getByRole("button", { name: /Add a new worker/ })).toBeInTheDocument();
  });

  it("phone: docks Status and Mark resolved…, folds the long cards and offers Decide on the price request", async () => {
    media(true);
    render(<EstateMaintenanceDetail itemId="item1" timeZone="Australia/Sydney" isAdmin />);
    await screen.findByRole("heading", { level: 1, name: /Dishwasher not draining/ });
    const bar = screen.getByRole("region", { name: "Item actions" });
    expect(within(bar).getByRole("button", { name: "Status ▾" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Mark resolved…" })).toBeInTheDocument();
    const fold = screen.getByRole("button", { name: /Visit and access/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    await screen.findByRole("button", { name: "Decide" });
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Who is on this/ })).toHaveAttribute("aria-expanded", "true"));
  });
});
