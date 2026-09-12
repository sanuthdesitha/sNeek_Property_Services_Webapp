import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
const signedIn = (id = "one") => ({ status: "authenticated", data: { user: { id, role: "CLEANER" } } });
beforeEach(() => { mocks.session.mockReturnValue(signedIn()); });
afterEach(() => vi.unstubAllGlobals());

describe("maintenance navigation assignment", () => {
  it("does not fetch without an authenticated identity", () => {
    mocks.session.mockReturnValue({ status: "loading", data: null });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(renderHook(useMaintenanceSection).result.current).toEqual({ assigned: false, count: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])("clears stale assignment on %i and recovers", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ assigned: true, count: 2 }))
      .mockResolvedValueOnce(new Response(null, { status })).mockResolvedValue(Response.json({ assigned: true, count: 1 })));
    const { result } = renderHook(useMaintenanceSection);
    await waitFor(() => expect(result.current.count).toBe(2));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current).toEqual({ assigned: false, count: 0 }));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.count).toBe(1));
  });

  it.each([{ assigned: "true", count: 2 }, { assigned: true, count: -1 }, { assigned: true, count: 1.5 }, []])("rejects malformed state %j", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(body)); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(useMaintenanceSection);
    await act(async () => {});
    expect(result.current).toEqual({ assigned: false, count: 0 });
  });

  it("cancels stale identity results and avoids overlapping polls", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValue(Response.json({ assigned: false, count: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender, unmount } = renderHook(useMaintenanceSection);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetcher).toHaveBeenCalledTimes(1);
    mocks.session.mockReturnValue(signedIn("two")); rerender();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { finish(Response.json({ assigned: true, count: 8 })); });
    expect(result.current).toEqual({ assigned: false, count: 0 });
    unmount();
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  });
});
