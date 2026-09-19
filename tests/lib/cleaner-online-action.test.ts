import { afterEach, describe, expect, it, vi } from "vitest";
import { postOnlineAction, UnknownActionOutcome } from "@/lib/cleaner/online-action";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("online-only action transport", () => {
  it("does not dispatch while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(postOnlineAction("/action")).rejects.toThrow("connection");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new TypeError("Failed to fetch"), new Response("bad", { status: 502 }), new Response("{}"), new Response("not json")])("retains an uncertain outcome for lost or unusable acknowledgement", async response => {
    vi.stubGlobal("fetch", response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response));
    await expect(postOnlineAction("/action")).rejects.toBeInstanceOf(UnknownActionOutcome);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves an explicit business rejection for acknowledgement dialogs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "START_BRIEFING_REQUIRED", error: "Read briefing", items: ["one"] }), { status: 409 })));
    await expect(postOnlineAction("/action")).rejects.toMatchObject({ code: "START_BRIEFING_REQUIRED", data: { items: ["one"] } });
  });
  it("does not infer rollback from legacy routes reporting post-commit failures as 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Delivery failed" }), { status: 400 })));
    await expect(postOnlineAction("/action")).rejects.toMatchObject({ message: "Delivery failed Check the latest status before trying again." });
  });
});
