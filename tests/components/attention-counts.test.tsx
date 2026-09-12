import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAttentionCounts } from "@/components/v2/portal/use-attention-counts";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
const signedIn = (id = "one") => ({ status: "authenticated", data: { user: { id, role: "CLEANER" } } });
beforeEach(() => mocks.session.mockReturnValue(signedIn()));
afterEach(() => vi.unstubAllGlobals());

describe("shared attention counts", () => {
  it("waits for identity", () => {
    mocks.session.mockReturnValue({ status: "loading", data: null });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(renderHook(() => useAttentionCounts("/counts")).result.current).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("handles %i without mixing denial and transient failure", async status => {
    const counts = { "/v2/cleaner/jobs": 3 };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ counts })).mockResolvedValueOnce(new Response(null, { status }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useAttentionCounts("/counts"));
    await waitFor(() => expect(result.current).toEqual(counts));
    await act(async () => window.dispatchEvent(new Event("sneek:notification")));
    expect(result.current).toEqual(status === 503 ? counts : {});
  });
  it("validates badge numbers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ counts: { good: 3, zero: 0, fraction: 0.5, negative: -1, text: "2" } })));
    const { result } = renderHook(() => useAttentionCounts("/counts"));
    await waitFor(() => expect(result.current).toEqual({ good: 3, zero: 0 }));
  });
  it("aborts old identities and serializes focus/event refreshes", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockResolvedValue(Response.json({ counts: { current: 1 } }));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender, unmount } = renderHook(() => useAttentionCounts("/counts"));
    act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("sneek:notification")); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    mocks.session.mockReturnValue(signedIn("two")); rerender();
    expect(result.current).toEqual({});
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ counts: { old: 99 } })));
    expect(result.current).toEqual({ current: 1 });
    unmount();
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  });
});
