import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ShiftRouteOverview } from "@/components/v2/cleaner/shift-route-overview";
import { orderStorageKey } from "@/lib/cleaner/route-order";
const stops = [{ jobId: "late", property: "Late property", address: "1 Test Street, Sydney NSW", startTime: "11:00", status: "ASSIGNED" }, { jobId: "early", property: "Early property", address: "", startTime: "09:00", status: "IN_PROGRESS" }];
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("shares the route's saved order and safely ignores stale and duplicate job IDs", async () => {
  localStorage.setItem(orderStorageKey("cleaner", "2026-09-13"), JSON.stringify(["foreign", "late", "late"]));
  render(<ShiftRouteOverview stops={stops} userId="cleaner" day="2026-09-13" />);
  await screen.findByText(/Next: Late property/);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0); expect(screen.getByText(/Next:/)).toHaveTextContent("Late property");
  expect(screen.getByRole("link", { name: "Open route" })).toHaveAttribute("href", "/v2/cleaner/route");
});
it.each(["broken", '["late",42]'])("uses schedule fallback and warns without overwriting malformed order %s", async raw => {
  const key = orderStorageKey("cleaner", "2026-09-13"); localStorage.setItem(key, raw);
  render(<ShiftRouteOverview stops={stops} userId="cleaner" day="2026-09-13" />);
  await screen.findByText(/Saved order unavailable/); expect(screen.getByText(/Next:/)).toHaveTextContent("Early property"); expect(localStorage.getItem(key)).toBe(raw);
});
it("isolates login and day and refreshes saved order on focus", async () => {
  localStorage.setItem(orderStorageKey("first", "2026-09-13"), JSON.stringify(["late"]));
  const view = render(<ShiftRouteOverview stops={stops} userId="first" day="2026-09-13" />);
  await screen.findByText(/Next: Late property/);
  view.rerender(<ShiftRouteOverview stops={stops} userId="second" day="2026-09-13" />);
  await screen.findByText(/Next: Early property/); expect(screen.getByText(/Next:/)).toHaveTextContent("Early property");
  localStorage.setItem(orderStorageKey("second", "2026-09-13"), JSON.stringify(["late"]));
  act(() => window.dispatchEvent(new Event("focus"))); await waitFor(() => expect(screen.getByText(/Next:/)).toHaveTextContent("Late property"));
  view.rerender(<ShiftRouteOverview stops={stops} userId="second" day="2026-09-14" />);
  await screen.findByText(/Next: Early property/); expect(screen.getByText(/Next:/)).toHaveTextContent("Early property");
});
it("does not request location or network merely to show an empty route", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<ShiftRouteOverview stops={[]} userId="cleaner" day="2026-09-13" />);
  expect(screen.getByText(/No accepted stops remaining/)).toBeVisible(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
