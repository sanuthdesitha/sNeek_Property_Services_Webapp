import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobProgressPanel } from "@/components/v2/client/job-progress";
import { JobLivePanel } from "@/components/v2/client/job-live-panel";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const router = { refresh: mocks.refresh };
vi.mock("@/components/v2/client/live-trip-map", () => ({ ELiveTripMap: ({ cleanerLat }: any) => <div data-testid="map">{cleanerLat}</div> }));
const result = (body: unknown, ok = true) => ({ ok, json: async () => body });
const progress = (percent: number | null = 40, id = "job") => ({ id, status: "IN_PROGRESS", progressPercent: percent });
const live = () => ({ id: "job", status: "EN_ROUTE", startTime: null, enRouteEtaMinutes: 10, enRouteEtaUpdatedAt: new Date().toISOString(), liveTrip: { cleanerLat: 3, cleanerLng: 4, lastPingAt: new Date().toISOString() }, property: {} });
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("client progress refresh", () => {
  it("checks immediately and explains the estimate without claiming captured checklist freshness", async () => {
    mocks.fetch.mockResolvedValue(result(progress())); render(<JobProgressPanel jobId="job" initialPercent={10} />); await settle();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40"); expect(screen.getByText(/Last checked/)).toBeTruthy(); expect(screen.getByText(/elapsed time/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("retains the last estimate with failure and user retry", async () => {
    mocks.fetch.mockResolvedValueOnce(result({}, false)).mockResolvedValueOnce(result(progress(55)));
    render(<JobProgressPanel jobId="job" initialPercent={20} />); await settle(); expect(screen.getByRole("status").textContent).toContain("last available estimate");
    fireEvent.click(screen.getByRole("button", { name: "Retry progress" })); await settle(); expect(screen.queryByRole("status")).toBeNull(); expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("55");
  });
  it("shows failure without inventing a zero reading", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline")); render(<JobProgressPanel jobId="job" initialPercent={null} />); await settle(); expect(screen.getByText("Unavailable")).toBeTruthy(); expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it.each([NaN, "40", undefined])("rejects malformed progress %s", async (value) => {
    mocks.fetch.mockResolvedValue(result({ ...progress(), progressPercent: value })); render(<JobProgressPanel jobId="job" initialPercent={12} />); await settle(); expect(screen.getByRole("status")).toBeTruthy(); expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("12");
  });
  it("rejects a different job response", async () => { mocks.fetch.mockResolvedValue(result(progress(90, "other"))); render(<JobProgressPanel jobId="job" initialPercent={12} />); await settle(); expect(screen.getByRole("status")).toBeTruthy(); });
  it("refreshes page and stops polling when status changes", async () => { mocks.fetch.mockResolvedValue(result({ id: "job", status: "COMPLETED" })); render(<JobProgressPanel jobId="job" initialPercent={20} />); await settle(); expect(mocks.refresh).toHaveBeenCalledTimes(1); await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("progressbar")).toBeNull(); });
  it("serializes requests and ignores late response after job changes", async () => {
    let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValue(result(progress(5, "other")));
    const view = render(<JobProgressPanel jobId="job" initialPercent={20} />); await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const signal = mocks.fetch.mock.calls[0][1].signal; view.rerender(<JobProgressPanel jobId="other" initialPercent={0} />); await settle(); expect(signal.aborted).toBe(true); await act(async () => { resolve(result(progress(99))); }); expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("5");
  });
  it("accepts unavailable progress and clamps finite out-of-range estimates", async () => {
    mocks.fetch.mockResolvedValueOnce(result(progress(null))).mockResolvedValueOnce(result(progress(200))); render(<JobProgressPanel jobId="job" initialPercent={NaN} />); await settle(); expect(screen.queryByRole("progressbar")).toBeNull(); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});
describe("client arrival refresh", () => {
  it("recovers automatically after an initial failure", async () => { mocks.fetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result(live())); render(<JobLivePanel jobId="job" />); await settle(); expect(screen.getByRole("status")).toBeTruthy(); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(screen.queryByRole("status")).toBeNull(); expect(screen.getByTestId("map")).toBeTruthy(); });
  it("hides the stale map on refresh failure, then retries by gesture", async () => { mocks.fetch.mockResolvedValueOnce(result(live())).mockResolvedValueOnce(result({}, false)).mockResolvedValue(result(live())); render(<JobLivePanel jobId="job" />); await settle(); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(screen.queryByTestId("map")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Retry arrival updates" })); await settle(); expect(screen.getByTestId("map")).toBeTruthy(); });
  it("aborts on unmount and never starts an orphan timer after a late response", async () => { let resolve!: (v: unknown) => void; mocks.fetch.mockReturnValue(new Promise((r) => { resolve = r; })); const view = render(<JobLivePanel jobId="job" />); const signal = mocks.fetch.mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true); await act(async () => { resolve(result(live())); }); await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(mocks.fetch).toHaveBeenCalledTimes(1); });
  it("rejects wrong-job data and refreshes once after arrival", async () => { mocks.fetch.mockResolvedValueOnce(result({ ...live(), id: "other" })).mockResolvedValue(result({ id: "job", status: "IN_PROGRESS" })); render(<JobLivePanel jobId="job" />); await settle(); expect(screen.getByRole("status")).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Retry arrival updates" })); await settle(); expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(screen.queryByTestId("map")).toBeNull(); await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(mocks.fetch).toHaveBeenCalledTimes(2); });
});

describe("arrival state rendering", () => {
  it.each([
    { drivingPausedAt: "now", drivingPauseReason: "TRAFFIC" },
    { drivingPausedAt: "now", drivingPauseReason: null },
    { arrivedAt: "now" },
    { drivingDelayedAt: "now", drivingDelayedReason: "TRAFFIC" },
    { drivingDelayedAt: "now", drivingDelayedReason: null },
    { startTime: "00:00" },
    { startTime: "23:59" },
    { startTime: "12:10" },
    { enRouteEtaMinutes: 1 },
    { enRouteEtaMinutes: null },
    { enRouteEtaUpdatedAt: null, liveTrip: null, property: { latitude: 1, longitude: 2 } },
    { enRouteEtaUpdatedAt: "bad-date", liveTrip: null, property: null },
    { enRouteEtaUpdatedAt: "2026-09-13T01:00:00Z", liveTrip: { cleanerLat: null, cleanerLng: null, propertyLat: 1, propertyLng: 2, heading: 90 } },
  ])("renders known arrival variations %#", async (overrides) => {
    vi.setSystemTime(new Date(2026, 8, 13, 12, 0, 0)); mocks.fetch.mockResolvedValue(result({ ...live(), ...overrides })); render(<JobLivePanel jobId="job" />); await settle(); expect(screen.getByTestId("map")).toBeTruthy();
  });
  it("keeps retry disabled while a retry is pending", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline")).mockReturnValue(new Promise(() => {})); render(<JobLivePanel jobId="job" />); await settle(); fireEvent.click(screen.getByRole("button", { name: "Retry arrival updates" })); await settle(); expect(screen.getByRole("button", { name: /Checking/ }).hasAttribute("disabled")).toBe(true);
  });
  it("ignores rejected transport after unmount", async () => {
    let reject!: (error: Error) => void; mocks.fetch.mockReturnValue(new Promise((_, r) => { reject = r; })); const view = render(<JobLivePanel jobId="job" />); view.unmount(); await act(async () => { reject(new Error("aborted")); }); expect(vi.getTimerCount()).toBe(0);
  });
});
