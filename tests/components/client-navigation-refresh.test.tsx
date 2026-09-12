import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClientPortalCounts } from "@/components/v2/portal/use-attention-counts";

const payload = { counts: { "/v2/client/cases": 3 }, portal: { actor: "VA", permissions: { bookings: true }, actingFor: "Client One" } };
afterEach(() => vi.unstubAllGlobals());
describe("client permission refresh", () => {
  it("does not fetch before identity resolves", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useClientPortalCounts("/counts", ""));
    expect(result.current.gate).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500])("removes stale grants on HTTP %i and can recover", async (status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(payload)).mockResolvedValueOnce(new Response(null, { status })).mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useClientPortalCounts("/counts", "va-one"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.gate).toBeNull());
    expect(result.current.status).toBe(status === 500 ? "unavailable" : "denied");
    expect(result.current.counts).toEqual(status === 500 ? payload.counts : {});
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
  it("validates grants strictly and excludes malformed counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ counts: { bad: -1, text: "2", okay: 2 }, portal: { actor: "VA", permissions: { bookings: "true", reports: true } } })));
    const { result } = renderHook(() => useClientPortalCounts("/counts", "va-one"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.gate?.permissions).toEqual({ bookings: false, reports: true });
    expect(result.current.counts).toEqual({ okay: 2 });
  });
  it("does not overlap focus refreshes", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useClientPortalCounts("/counts", "va-one"));
    act(() => { result.current.refresh(); window.dispatchEvent(new Event("focus")); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { finish(Response.json(payload)); });
    expect(result.current.status).toBe("ready");
  });
  it("does not release the prior identity's late response", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValue(Response.json({ ...payload, portal: { ...payload.portal, actingFor: "Client Two" } })));
    const { result, rerender } = renderHook(({ id }) => useClientPortalCounts("/counts", id), { initialProps: { id: "one" } });
    rerender({ id: "two" });
    await waitFor(() => expect(result.current.gate?.actingFor).toBe("Client Two"));
    await act(async () => { finish(Response.json(payload)); });
    expect(result.current.gate?.actingFor).toBe("Client Two");
  });
  it("fails closed for malformed payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ counts: {}, portal: { actor: "VA", permissions: [] } })));
    const { result } = renderHook(() => useClientPortalCounts("/counts", "va-one"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.gate).toBeNull();
  });
});
