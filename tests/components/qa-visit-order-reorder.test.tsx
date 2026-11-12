import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { QaVisitOrder } from "@/components/v2/qa/today/qa-visit-order";

/**
 * Owner decision 2026-11-12 on QA Today: an inspector moves stops in their own
 * day unless the office has set it, which shows as locked with who set it.
 */
const assignment = (id: string) => ({
  id,
  jobId: `job-${id}`,
  assignedTo: { id: "qa-1" },
  status: "ASSIGNED",
  inspectionReadiness: "READY",
  job: { status: "SUBMITTED", property: { name: `Property ${id}` }, assignments: [], formSubmissions: [] },
});

function mockFetch(dayOrder: unknown, patchResponse?: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/qa/queue")) {
      return new Response(JSON.stringify({ assignments: [assignment("a"), assignment("b")] }), { status: 200 });
    }
    if (url.startsWith("/api/qa/visit-order") && (!init || !init.method || init.method === "GET")) {
      return dayOrder === "fail"
        ? new Response(JSON.stringify({ error: "x" }), { status: 500 })
        : new Response(JSON.stringify({ dayOrder }), { status: 200 });
    }
    if (url === "/api/qa/visit-order" && init?.method === "PATCH" && patchResponse) {
      return new Response(JSON.stringify(patchResponse.body), { status: patchResponse.status });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const open = { dayKey: "2026-11-13", locked: false, setByOffice: false, setByName: null, setAt: null };
const locked = { dayKey: "2026-11-13", locked: true, setByOffice: true, setByName: "Mia Office", setAt: "2026-11-12T22:00:00.000Z" };

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("QA Today visit order for inspectors", () => {
  it("shows Move earlier / later when the office has not set the day, and saves with the order it read", async () => {
    const fetchMock = mockFetch(open, { status: 200, body: { ok: true, dayOrder: { ...open, setByName: "Ins" } } });
    render(<QaVisitOrder viewerId="qa-1" canReorder={false} inspectorMayReorder qaPaySettings={null} todayKey="2026-11-13" />);
    const later = await screen.findByRole("button", { name: "Move Property a later" });
    fireEvent.click(later);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/qa/visit-order" && init?.method === "PATCH")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, init]) => url === "/api/qa/visit-order" && init?.method === "PATCH")!;
    expect(JSON.parse(String(init!.body))).toEqual({ date: "today", orderedAssignmentIds: ["b", "a"], expectedOrder: ["a", "b"] });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/qa/assignments/reorder")).toBe(false);
  });

  it("shows the day as locked with who set it, and no arrows", async () => {
    mockFetch(locked);
    render(<QaVisitOrder viewerId="qa-1" canReorder={false} inspectorMayReorder qaPaySettings={null} todayKey="2026-11-13" />);
    expect(await screen.findByText("Order set by the office")).toBeVisible();
    expect(screen.getByText(/Set by Mia Office/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Move Property a/ })).not.toBeInTheDocument();
  });

  it("keeps the arrows off when who set the order cannot be read", async () => {
    mockFetch("fail");
    render(<QaVisitOrder viewerId="qa-1" canReorder={false} inspectorMayReorder qaPaySettings={null} todayKey="2026-11-13" />);
    expect(await screen.findByText(/Could not check who set this order/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Move Property a/ })).not.toBeInTheDocument();
  });

  it("restores the order and shows the reason when the office locked it meanwhile", async () => {
    mockFetch(open, { status: 409, body: { error: "Order set by the office", code: "OFFICE_LOCK", dayOrder: locked } });
    render(<QaVisitOrder viewerId="qa-1" canReorder={false} inspectorMayReorder qaPaySettings={null} todayKey="2026-11-13" />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Property a later" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Order set by the office");
    await waitFor(() => expect(screen.queryByRole("button", { name: /Move Property a/ })).not.toBeInTheDocument());
    const stops = screen.getAllByText(/^Property [ab]$/).map((node) => node.textContent);
    expect(stops).toEqual(["Property a", "Property b"]);
  });

  it("an inspector without reorder rights (or tested-as) reads that the office sets the order", async () => {
    mockFetch(open);
    render(<QaVisitOrder viewerId="qa-1" canReorder={false} inspectorMayReorder={false} qaPaySettings={null} todayKey="2026-11-13" />);
    expect(await screen.findByText(/The office sets the visit order/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Move Property a/ })).not.toBeInTheDocument();
  });
});
