import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";

const mocks = vi.hoisted(() => ({ session: vi.fn(), gps: vi.fn(), pathname: "/v2/cleaner" }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/gps/client", () => ({ useGpsTracker: mocks.gps }));
const signedIn = (id = "one", role = "CLEANER", impersonation?: object) => ({
  status: "authenticated", data: { user: { id, role }, impersonation },
});
const job = (status = "IN_PROGRESS", id = "job-1", name = "Harbour House") => ({ id, status, property: { name } });
const response = (value: unknown = job()) => Response.json({ job: value });
const fetcher = vi.fn();
const gps = () => mocks.gps.mock.calls.at(-1)?.[0];
const refresh = async () => { await act(async () => { window.dispatchEvent(new Event("focus")); }); };
function deferred() {
  let resolve!: (response: Response) => void;
  return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (value: Response) => resolve(value) };
}

beforeEach(() => {
  mocks.session.mockReturnValue(signedIn());
  mocks.gps.mockClear();
  mocks.pathname = "/v2/cleaner";
  fetcher.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("cleaner active job strip", () => {
  it.each([["EN_ROUTE", "On the way"], ["IN_PROGRESS", "In progress"], ["PAUSED", "Paused"]])(
    "tracks %s and displays its status", async (status, label) => {
      fetcher.mockResolvedValueOnce(response(job(status)));
      render(<LocationTracker />);
      expect(gps()).toEqual({ jobId: "", enabled: false });
      expect(await screen.findByText(label)).toBeVisible();
      expect(gps()).toEqual({ jobId: "job-1", enabled: true });
      expect(screen.getByRole("link", { name: "Resume job" })).toHaveAttribute("href", "/v2/cleaner/jobs/job-1");
    },
  );

  it("updates status and property without an id change, then stops for no active job", async () => {
    render(<LocationTracker />);
    await screen.findByText("In progress");
    fetcher.mockResolvedValueOnce(response(job("PAUSED", "job-1", "New name")));
    await refresh();
    expect(screen.getByText("New name")).toBeVisible();
    expect(screen.getByText("Paused")).toBeVisible();
    fetcher.mockResolvedValueOnce(response(null));
    await refresh();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(gps()).toEqual({ jobId: "", enabled: false });
  });

  it.each(["loading", "unauthenticated", "wrong-role", "missing-id"])("does not probe or track %s", state => {
    mocks.session.mockReturnValue(state === "wrong-role" ? signedIn("one", "ADMIN")
      : state === "missing-id" ? signedIn("") : { status: state, data: null });
    render(<LocationTracker />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(gps()).toEqual({ jobId: "", enabled: false });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it.each([401, 403, 500, "network", "json"])("clears the old job on %s and supports keyboard Retry", async failure => {
    render(<LocationTracker />);
    await screen.findByText("Harbour House");
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("offline"));
    else if (failure === "json") fetcher.mockResolvedValueOnce(new Response("invalid json"));
    else fetcher.mockResolvedValueOnce(new Response(null, { status: failure }));
    await refresh();
    expect(screen.getByRole("status")).toHaveTextContent("Active job unavailable");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(gps()).toEqual({ jobId: "", enabled: false });
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await screen.findByRole("link", { name: "Resume job" });
    expect(gps().enabled).toBe(true);
  });

  it.each([{}, { job: undefined }, { job: {} }, { job: job("COMPLETED") },
    { job: job("IN_PROGRESS", "") }, { job: job("PAUSED", "..") },
    { job: job("PAUSED", "job-1", "  ") }, { job: { ...job(), property: null } }])(
    "rejects malformed probe %j", async body => {
      fetcher.mockResolvedValueOnce(Response.json(body));
      render(<LocationTracker />);
      await screen.findByText("Active job unavailable.");
      expect(gps().enabled).toBe(false);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it.each(["/v2/cleaner/jobs/job-1", "/v2/cleaner/jobs/job-1/checklist"])("hides on %s while GPS stays enabled", async pathname => {
    mocks.pathname = pathname;
    render(<LocationTracker />);
    await waitFor(() => expect(gps().enabled).toBe(true));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("encodes the job id, wraps long names, and does not hide on a different job", async () => {
    mocks.pathname = "/v2/cleaner/jobs/job-10";
    const name = "LongPropertyName".repeat(30);
    fetcher.mockResolvedValueOnce(response(job("EN_ROUTE", "job/1?#", name)));
    render(<LocationTracker />);
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/v2/cleaner/jobs/job%2F1%3F%23");
    expect(screen.getByText(name).parentElement).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByRole("region")).toHaveClass("motion-reduce:animate-none");
    link.focus();
    expect(link).toHaveFocus();
  });

  it.each(["account", "role", "logout", "loading", "impersonation"])("invalidates known jobs and stale responses on %s change", async change => {
    const pending = deferred();
    const { rerender } = render(<LocationTracker />);
    await screen.findByText("Harbour House");
    fetcher.mockReturnValueOnce(pending.promise);
    await refresh();
    const signal = fetcher.mock.calls[1][1].signal;
    const next = deferred();
    fetcher.mockReturnValueOnce(next.promise);
    mocks.session.mockReturnValue(change === "account" ? signedIn("two")
      : change === "role" ? signedIn("one", "ADMIN")
      : change === "impersonation" ? signedIn("one", "CLEANER", { actorId: "admin", mode: "READ_ONLY", startedAt: 1 })
      : { status: change === "logout" ? "unauthenticated" : "loading", data: null });
    // Rerender the same mounted component to exercise immediate identity gating.
    rerender(<LocationTracker />);
    expect(signal.aborted).toBe(true);
    expect(gps().enabled).toBe(false);
    await act(async () => pending.resolve(response(job("PAUSED", "old-job"))));
    expect(gps().enabled).toBe(false);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    if (change === "account" || change === "impersonation") {
      await act(async () => next.resolve(response(job("IN_PROGRESS", "new-job"))));
      expect(gps()).toEqual({ jobId: "new-job", enabled: true });
    }
  });

  it("serializes and coalesces focus, visible, notification and interval refreshes", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    fetcher.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<LocationTracker />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("sneek:notification"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(response()));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(response(null)));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(gps().enabled).toBe(false);
  });

  it("aborts on unmount and removes refresh listeners and polling", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    fetcher.mockReturnValueOnce(pending.promise);
    const { unmount } = render(<LocationTracker />);
    const signal = fetcher.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response()));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("sneek:notification"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(120_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(gps().enabled).toBe(false);
  });
});
