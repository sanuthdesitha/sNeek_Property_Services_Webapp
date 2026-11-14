/**
 * Deep-clean scheduling screen (board "Deep clean", 2026-11-16): the rule
 * strip, tiles, banded queue rows, the date panel with guests and turnovers
 * (past days cannot be chosen), the same request on retry, read only for
 * operations managers, a failed load never says "nothing due", and phones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/v2/admin/deep-clean-planning",
}));

import { DeepCleanScheduling } from "@/components/v2/admin/properties/deep-clean-scheduling";
import type { DeepCleanQueue } from "@/lib/properties/deep-clean-queue-model";

const TODAY = "2026-11-14";

function queue(canManage = true): DeepCleanQueue {
  return {
    today: TODAY,
    timeZone: "Australia/Sydney",
    canManage,
    rows: [
      { propertyId: "p1", propertyName: "Coogee Terrace", clientName: "Harbour View Stays", suburb: "Coogee", bedrooms: 3, state: "needs_date", dueDay: "2026-11-09", revision: 3, baseline: { jobId: "j0", jobNumber: "J-0912", completedDay: "2026-08-09", verifiedByName: "Ravi Mehta", verifiedAt: "2026-08-10T00:00:00.000Z" }, proposal: { id: "p1:j0", status: "NEEDS_SCHEDULING", scheduledDay: null, jobId: null, jobNumber: null, assigned: null }, changeReason: null },
      { propertyId: "p2", propertyName: "Glebe House", clientName: "Inner West Short Stays", suburb: "Glebe", bedrooms: null, state: "evidence_changed", dueDay: "2026-11-05", revision: 2, baseline: { jobId: "j5", jobNumber: "J-0897", completedDay: "2026-08-05", verifiedByName: "Hannah Lee", verifiedAt: "2026-08-06T00:00:00.000Z" }, proposal: null, changeReason: "a photo or video was removed after verifying" },
    ],
    tiles: { needsDate: 1, oldestDue: "2026-11-09", evidenceChanged: 1, dueLater: 0, nextDue: null, draftCreated: 0, draftUnassigned: 0, noBaseline: 2 },
    noBaseline: [{ propertyId: "p8", propertyName: "Bronte Flat" }, { propertyId: "p9", propertyName: "Paddington Terrace" }],
  };
}

const detail = (canManage = true) => ({
  property: { id: "p1", name: "Coogee Terrace", isActive: true },
  plan: { revision: 3, baseline: { jobId: "j0", completedDay: "2026-08-09", dueDay: "2026-11-09", verifiedAt: "2026-08-10T00:00:00.000Z", reviewNote: "ok" }, proposal: { id: "p1:j0", status: "NEEDS_SCHEDULING", dueDay: "2026-11-09", jobId: null, scheduledDay: null } },
  baselineValid: true,
  today: TODAY,
  canManage,
  candidates: [],
  candidateDetails: [],
  history: [{ at: "2026-11-08T21:15:00.000Z", text: "Proposal due 2026-11-09, needs a date", actor: "daily check" }],
  changeReason: null,
});

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Deep-clean scheduling", () => {
  it("shows the rule step by step, the tiles and banded rows with the reason written", async () => {
    setPhone(false);
    stubFetch(() => ({ body: queue() }));
    render(<DeepCleanScheduling />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(screen.getByRole("list", { name: "The deep-clean rule" })).getAllByRole("listitem")).toHaveLength(6);
    await screen.findAllByText("Coogee Terrace");
    const overdue = document.querySelector('[data-queue-row="p1"]') as HTMLElement;
    expect(overdue).toHaveTextContent("Due 5 days ago");
    expect(overdue).toHaveTextContent("Needs a date");
    const changed = document.querySelector('[data-queue-row="p2"]') as HTMLElement;
    expect(changed).toHaveTextContent("a photo or video was removed after verifying");
    expect(within(changed).getByRole("button", { name: "Re-verify…" })).toBeInTheDocument();
    expect(screen.getByText(/1 needs a date · 1 needs re-checking/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bronte Flat" })).toBeInTheDocument();
  });

  it("marks guests and turnovers, blocks past days and sends the same request on Try again", async () => {
    setPhone(false);
    search = new URLSearchParams("property=p1");
    let posts = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url.includes("/calendar")) return { body: { guests: ["2026-11-16", "2026-11-17"], turnovers: ["2026-11-15"] } };
      if (init?.method === "POST") {
        posts += 1;
        return posts === 1 ? { status: 500, body: { error: "lost connection" } } : { body: { jobId: "j77" } };
      }
      if (url.includes("deep-clean-planning?detail=1")) return { body: detail() };
      return { body: queue() };
    });
    render(<DeepCleanScheduling />);
    const past = await screen.findByRole("gridcell", { name: /Thu 12 Nov 2026, past, cannot be chosen/ });
    expect(past).toBeDisabled();
    expect(await screen.findByRole("gridcell", { name: /Mon 16 Nov 2026, guests staying/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: /Tue 24 Nov 2026/ }));
    expect(screen.getByText(/Does not assign a cleaner, notify the client or add a charge/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create draft for Tue 24 Nov" }));
    expect(await screen.findByText(/No job was created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Draft job created for Tue 24 Nov/)).toBeInTheDocument();
    const bodies = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST").map((call) => String(call[1]!.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0])).toEqual({ action: "schedule", proposalId: "p1:j0", revision: 3, date: "2026-11-24" });
  });

  it("an operations manager sees the panel read only", async () => {
    setPhone(false);
    search = new URLSearchParams("property=p1");
    stubFetch((url) => {
      if (url.includes("/calendar")) return { body: { guests: [], turnovers: [] } };
      if (url.includes("detail=1")) return { body: detail(false) };
      return { body: queue(false) };
    });
    render(<DeepCleanScheduling />);
    expect(await screen.findByText(/An administrator chooses the day/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create draft/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("gridcell", { name: /Tue 24 Nov 2026/ })).toBeDisabled());
  });

  it("a failed load says so and never says nothing is due", async () => {
    setPhone(false);
    stubFetch(() => ({ status: 500, body: { error: "x" } }));
    render(<DeepCleanScheduling />);
    expect(await screen.findByText("The queue could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/No property needs a date/)).toBeNull();
  });

  it("on a phone the rows are cards, the figures fold and Refresh docks", async () => {
    setPhone(true);
    stubFetch(() => ({ body: queue() }));
    render(<DeepCleanScheduling />);
    const bar = await screen.findByRole("region", { name: "Deep-clean actions" });
    expect(within(bar).getByRole("button", { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Deep-clean queue" }).length).toBe(1);
    expect(screen.getByRole("button", { name: /5 figures/ })).toBeInTheDocument();
  });
});
