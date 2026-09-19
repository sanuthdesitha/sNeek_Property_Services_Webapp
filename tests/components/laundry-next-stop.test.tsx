import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextStopExecution } from "@/components/v2/laundry/next-stop-execution";
import { LaundryRouteMap } from "@/components/v2/laundry/route-map";
vi.mock("@/lib/maps/loader", () => ({ ensureGoogleMaps: vi.fn().mockRejectedValue(new Error("No provider in unit tests")) }));
vi.mock("@/components/v2/laundry/laundry-action-modal", () => ({ useLaundryActionModal: () => ({ openAction: vi.fn(), modal: null, config, optionsLoaded: true }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const config = { showPickupPhoto: true, requireDropoffPhoto: true, requireEarlyDropoffReason: true, showCostTracking: false };
const task = { id: "t1", status: "CONFIRMED", pickupDate: "2026-09-13", dropoffDate: "2026-09-14", property: { name: "House", address: "1 Street", accessInfo: { laundrySameAsCleaner: false }, accessGuide: [
  { id: "1", kind: "ENTRY", label: "Laundry entrance", instructions: "Side gate", audience: "LAUNDRY", images: [] },
  { id: "2", kind: "ENTRY", label: "Cleaner secret", instructions: "Hidden", audience: "CLEANER", images: [] },
] } };
describe("laundry next stop execution", () => {
  it("opens the existing pickup check with the exact task and keeps quantities unknown", () => {
    const onAction = vi.fn();
    render(<NextStopExecution task={task} kind="pickup" config={config} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup" }));
    expect(onAction).toHaveBeenCalledWith("t1", "PICKED_UP");
    fireEvent.click(screen.getByRole("button", { name: "Report access problem" }));
    expect(onAction).toHaveBeenCalledWith("t1", "FAILED_PICKUP");
    expect(screen.getByText(/Bag count not recorded/)).toBeVisible();
    expect(screen.getByText(/Pickup photo is optional/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open task board" })).toHaveAttribute("href", "/v2/laundry/tracking#task-t1");
    expect(screen.queryByText("Cleaner secret")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Laundry access guide"));
    expect(screen.getByText("Side gate")).toBeVisible();
  });
  it("uses recorded pickup quantities and configured return proof", () => {
    const onAction = vi.fn();
    render(<NextStopExecution task={{ ...task, status: "PICKED_UP", confirmations: [{ notes: '{"event":"PICKED_UP","bagCount":3}', bagLocation: "Cupboard" }] }} kind="dropoff" config={config} onAction={onAction} />);
    expect(screen.getByText("3 bags recorded at pickup.")).toBeVisible();
    expect(screen.getByText(/Drop-off photo required/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm drop-off" }));
    expect(onAction).toHaveBeenCalledWith("t1", "RETURNED");
  });
  it("does not bypass pickup or flagged task state", () => {
    const view = render(<NextStopExecution task={task} kind="dropoff" onAction={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Pickup must be recorded");
    view.rerender(<NextStopExecution task={{ ...task, status: "FLAGGED" }} kind="pickup" onAction={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("flagged");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("honors same-as-cleaner access and does not guess unavailable proof settings", () => {
    render(<NextStopExecution task={{ ...task, property: { ...task.property, accessInfo: { laundrySameAsCleaner: true } } }} kind="pickup" onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Laundry access guide"));
    expect(screen.getByText("Cleaner secret")).toBeVisible();
    expect(screen.getByText(/Proof settings unavailable/)).toBeVisible();
    expect(screen.queryByText(/photo required/)).not.toBeInTheDocument();
  });
  it("has no action or property details for inaccessible route tasks", () => {
    render(<NextStopExecution kind="pickup" onAction={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Stop details unavailable");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

it("loads the Sydney date key and hides actions on route refresh failure even when week succeeds", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let failed = false;
  const fetcher = vi.fn(async (url: string) => url.includes("/week?") ? { ok: true, json: async () => [{ ...task, pickupDate: `${today}T00:00:00.000Z`, dropoffDate: null }] } : { ok: !failed, json: async () => ({ route: null, tasks: [] }) });
  vi.stubGlobal("fetch", fetcher);
  render(<LaundryRouteMap />);
  await screen.findByRole("button", { name: "Confirm pickup", exact: true });
  expect(fetcher).toHaveBeenCalledWith(`/api/laundry/week?start=${today}T00:00:00.000Z&days=2`, expect.anything());
  expect(screen.getByText(new RegExp(`scheduled ${today}`))).toBeVisible();
  failed = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
  await screen.findByText("Could not load today's route");
  expect(screen.queryByRole("button", { name: "Confirm pickup", exact: true })).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm pickup", exact: true })).toBeVisible());
});
