import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteTimeline, orderStorageKey, type RouteStop } from "@/components/v2/cleaner/route-timeline";

vi.mock("@/components/v2/cleaner/job-offer-actions", () => ({
  JobOfferActions: ({ jobId }: { jobId: string }) => <button>Accept {jobId}</button>,
}));
vi.mock("@/lib/time/sydney-range", () => ({
  sydneyTodayKey: () => "2026-09-09",
  addDaysToKey: (_date: string, offset: number) => offset ? "2026-09-10" : "2026-09-09",
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const stop = (jobId: string): RouteStop => ({
  jobId, jobNumber: 1, status: "OFFERED", startTime: null,
  propertyName: jobId, address: "1 Main St", suburb: "Sydney", latitude: null, longitude: null,
});
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const requests: Array<ReturnType<typeof deferred<Response>> & { signal: AbortSignal; url: string }> = [];

beforeEach(() => {
  requests.length = 0;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
    const pending = deferred<Response>();
    requests.push({ ...pending, url, signal: options.signal as AbortSignal });
    // Intentionally ignore abort so generation protection is exercised too.
    return pending.promise;
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  return render(<RouteTimeline initialDate="2026-09-09" initialStops={[stop("Old home"), stop("Other home")]} userId="cleaner" />);
}
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
async function finish(index: number, body: unknown, ok = true) {
  await act(async () => { requests[index].resolve(response(body, ok)); });
}
function expectNoActions() {
  expect(screen.queryByText("Old home")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Accept / })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open job/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Directions|Copy link|Open all in Maps|Move stop|Reset to suggested order/ })).not.toBeInTheDocument();
  expect(screen.queryByText("No stops scheduled")).not.toBeInTheDocument();
}

describe("route fetch lifecycle", () => {
  it("names the travel mode and custom date controls", () => {
    mount();
    expect(screen.getByRole("combobox", { name: "Travel mode" })).toBeInTheDocument();
    click("Pick a date");
    expect(screen.getByLabelText("Route date")).toHaveAttribute("type", "date");
  });

  it("keeps hydrated stops without fetching, then removes all previous-day actions during loading and HTTP failure", async () => {
    mount();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Old home")).toBeVisible();
    click("Tomorrow");
    expect(requests[0].url).toBe("/api/cleaner/today-route?relative=tomorrow");
    expectNoActions();
    await finish(0, {}, false);
    expect(screen.getByText("Could not load route")).toBeVisible();
    expectNoActions();
    click("Refresh");
    await finish(1, { date: "2026-09-10", stops: [stop("New home")] });
    expect(screen.getByText("New home")).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept New home" })).toBeVisible();
  });

  it.each(["resolve", "reject"] as const)("ignores stale %s and its loading cleanup while a newer date is pending", async (outcome) => {
    mount();
    click("Tomorrow");
    click("Today");
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") requests[0].resolve(response({ date: "2026-09-10", stops: [stop("Stale home")] }));
      else requests[0].reject(new Error("Stale failure"));
    });
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(screen.queryByText("Stale home")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale failure")).not.toBeInTheDocument();
    expectNoActions();
    await finish(1, { date: "2026-09-09", stops: [stop("Current home")] });
    expect(screen.getByText("Current home")).toBeVisible();
  });

  it("ignores an old JSON body that completes after the newest response", async () => {
    mount();
    click("Tomorrow");
    const body = deferred<unknown>();
    await act(async () => { requests[0].resolve({ ok: true, json: () => body.promise } as Response); });
    click("Today");
    await finish(1, { date: "2026-09-09", stops: [stop("Current home")] });
    await act(async () => { body.resolve({ date: "2026-09-10", stops: [stop("Stale home")] }); });
    expect(screen.getByText("Current home")).toBeVisible();
    expect(screen.queryByText("Stale home")).not.toBeInTheDocument();
  });

  it.each([
    [null, "Invalid route date in response"],
    [{ stops: [] }, "Invalid route date in response"],
    [{ date: "2026-02-30", stops: [] }, "Invalid route date in response"],
    [{ date: "2026-09-09", stops: [] }, "Route date does not match the selected day"],
    [{ date: "2026-09-10" }, "Invalid route stops in response"],
    [{ date: "2026-09-10", stops: {} }, "Invalid route stops in response"],
    [{ date: "2026-09-10", stops: [null] }, "Invalid route stops in response"],
    [{ date: "2026-09-10", stops: [{ jobId: "broken" }] }, "Invalid route stops in response"],
    [{ date: "2026-09-10", stops: [stop("duplicate"), stop("duplicate")] }, "Invalid route stops in response"],
  ])("reports malformed/wrong-day response %# without a false empty state", async (body, message) => {
    mount();
    click("Tomorrow");
    await finish(0, body);
    expect(screen.getByText(message as string)).toBeVisible();
    expectNoActions();
  });

  it("validates a cleared date without fetching and supports recovery to an explicit empty day", async () => {
    const { container } = mount();
    click("Pick a date");
    const input = container.querySelector('input[type="date"]')!;
    fireEvent.change(input, { target: { value: "" } });
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(screen.getByText("Invalid route date")).toBeVisible();
    expectNoActions();
    fireEvent.change(input, { target: { value: "2026-09-12" } });
    expect(requests[1].url).toBe("/api/cleaner/today-route?date=2026-09-12");
    await finish(1, { date: "2026-09-12", stops: [] });
    expect(screen.getByText("No stops scheduled")).toBeVisible();
  });

  it("applies only the matching day's stored order and resets to server order", async () => {
    localStorage.setItem(orderStorageKey("cleaner", "2026-09-10"), JSON.stringify(["Second", "First"]));
    mount();
    click("Tomorrow");
    const body = { date: "2026-09-10", stops: [stop("First"), stop("Second")] };
    await finish(0, body);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second");
    click("Reset to suggested order");
    await finish(1, body);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("First");
  });

  it("aborts on unmount and ignores late completion", async () => {
    const view = mount();
    click("Refresh");
    view.unmount();
    expect(requests[0].signal.aborted).toBe(true);
    await finish(0, { date: "2026-09-09", stops: [stop("Late home")] });
    expect(screen.queryByText("Late home")).not.toBeInTheDocument();
  });
});
