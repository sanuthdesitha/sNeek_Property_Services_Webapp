import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { LaundryWorkspace } from "@/components/v2/client/laundry/laundry-workspace";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/shared/media-gallery", () => ({ MediaGallery: () => <div data-testid="laundry-media">Photo gallery</div> }));
const fetchMock = vi.fn();
const task = { id: "task", status: "PENDING", pickupDate: "2026-10-01T00:00:00Z", dropoffDate: null, updatedAt: "2026-10-01T00:00:00Z", property: { id: "property", name: "Harbour apartment", suburb: "Sydney" }, job: { id: "job", jobNumber: "J01", scheduledDate: "2026-10-01T00:00:00Z" }, confirmations: [{ id: "photo", laundryReady: true, createdAt: "2026-10-01T00:00:00Z", photoUrl: "https://example.invalid/photo.jpg" }] };
const response = (data: unknown) => ({ ok: true, json: async () => data });
const mount = (images = true) => render(<LaundryWorkspace tasks={[task]} showLaundryImages={images} />);
const latestQuery = () => new URL(fetchMock.mock.calls.at(-1)![0], "https://example.test").searchParams;
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(response([task])); vi.stubGlobal("fetch", fetchMock); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T15:00:00Z")); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("sends property, status, custom bounds and selected date field together", async () => {
  mount(); await screen.findByText("Harbour apartment · Job J01");
  fireEvent.change(screen.getByLabelText("Property"), { target: { value: "property" } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "PICKED_UP" } });
  fireEvent.click(screen.getByRole("button", { name: "Custom dates" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-30" } });
  fireEvent.change(screen.getByLabelText("Filter dates by"), { target: { value: "dropoff" } });
  await waitFor(() => expect(Object.fromEntries(latestQuery())).toEqual({ propertyId: "property", status: "PICKED_UP", dateField: "dropoff", from: "2026-09-01", to: "2026-09-30" }));
});
it("Today returns from a past range to Sydney current day", async () => {
  mount(); await screen.findByText("Harbour apartment · Job J01");
  fireEvent.click(screen.getByRole("button", { name: "Custom dates" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-08-10" } });
  fireEvent.click(screen.getByRole("button", { name: "Today", exact: true }));
  await waitFor(() => expect(latestQuery().get("from")).toBe("2026-10-01"));
  expect(latestQuery().get("to")).toBe("2026-10-01"); expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-01");
});
it("compact details start folded and a missing drop-off remains unscheduled", async () => {
  const view = mount(); await screen.findByText("Harbour apartment · Job J01");
  expect(screen.getByText("Not scheduled")).toBeVisible();
  const details = screen.getByText("Updates, notes and photos").closest("details")!; expect(details).not.toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Compact view" })); expect(screen.getByText("Updates, notes and photos").closest("details")).toHaveAttribute("open");
  expect(screen.getByTestId("laundry-media")).toBeInTheDocument();
  view.rerender(<LaundryWorkspace tasks={[task]} showLaundryImages={false} />); expect(screen.queryByTestId("laundry-media")).not.toBeInTheDocument();
});
it("hides previous rows and counts during pending/error and retries explicitly", async () => {
  mount(); await screen.findByText("Harbour apartment · Job J01");
  let reject!: (error: Error) => void; fetchMock.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "FLAGGED" } });
  expect(screen.getByRole("status")).toHaveTextContent("Loading"); expect(screen.queryByText("Harbour apartment · Job J01")).not.toBeInTheDocument(); expect(screen.getAllByText("—")).toHaveLength(3);
  await act(async () => { reject(new Error("offline")); }); expect(screen.getByRole("alert")).toHaveTextContent("Could not load laundry");
  fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true })); await screen.findByText("Harbour apartment · Job J01");
});
it("late earlier filter responses cannot replace newer rows", async () => {
  mount(); await screen.findByText("Harbour apartment · Job J01");
  let resolve!: (data: unknown) => void; fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(response([]));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "FLAGGED" } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DROPPED" } });
  await screen.findByText("No laundry schedule updates match the selected range.");
  await act(async () => { resolve(response([task])); }); expect(screen.queryByText("Harbour apartment · Job J01")).not.toBeInTheDocument();
});
it("rejects reversed custom dates without fetching and clears filters explicitly", async () => {
  mount(); await screen.findByText("Harbour apartment · Job J01");
  fireEvent.click(screen.getByRole("button", { name: "Custom dates" })); const count = fetchMock.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-01" } });
  expect(screen.getByRole("alert")).toHaveTextContent("End date must be on or after start date"); expect(fetchMock).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" })); await screen.findByText("Harbour apartment · Job J01"); expect(Object.fromEntries(latestQuery())).toEqual({ dateField: "any" });
});
it("offers authorized properties outside the initial task window and human-readable bag notes", async () => {
  const withNotes = { ...task, confirmations: [{ id: "note", createdAt: "2026-10-01T00:00:00Z", notes: JSON.stringify({ event: "PICKED_UP", bagCount: 3, note: "Collected from cupboard", pickupPhotoKey: "private/internal/key" }) }] };
  fetchMock.mockResolvedValue(response([withNotes]));
  render(<LaundryWorkspace tasks={[withNotes]} showLaundryImages={false} properties={[{ id: "outside", name: "Outside initial window" }]} />);
  await screen.findByText("Harbour apartment · Job J01"); expect(screen.getByRole("option", { name: "Outside initial window" })).toHaveValue("outside");
  expect(screen.getByText("Picked up — 3 bags · Collected from cupboard")).toBeInTheDocument(); expect(screen.queryByText(/private\/internal\/key/)).not.toBeInTheDocument();
});
