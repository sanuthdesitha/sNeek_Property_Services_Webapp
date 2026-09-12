import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCleanerDraft } from "@/lib/cleaner/save-draft-client";
afterEach(() => vi.unstubAllGlobals());
describe("draft save acknowledgement", () => {
  it("confirms only a successful acknowledged save", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, updatedAt: "2026-09-09T10:00:00Z" }) });
    vi.stubGlobal("fetch", fetch);
    expect(await saveCleanerDraft("job", "editor", { answers: { note: "test" } }, true)).toEqual({ ok: true, updatedAt: "2026-09-09T10:00:00Z" });
    expect(fetch).toHaveBeenCalledWith("/api/cleaner/jobs/job/draft", expect.objectContaining({ method: "PATCH", keepalive: true, body: JSON.stringify({ editorSessionId: "editor", state: { answers: { note: "test" } } }) }));
  });
  it.each([401, 403, 409, 400, 503])("does not confirm HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    expect(await saveCleanerDraft("job", "editor", {})).toMatchObject({ ok: false, message: expect.stringContaining("Draft not saved") });
  });
  it.each([null, {}, { ok: true }, { ok: true, updatedAt: "not-a-date" }, { ok: false, updatedAt: "2026-09-09T10:00:00Z" }])("rejects invalid acknowledgement %j", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    expect(await saveCleanerDraft("job", "editor", {})).toMatchObject({ ok: false });
  });
  it("retains uncertainty for network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Private diagnostics")));
    const result = await saveCleanerDraft("job", "editor", {});
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("could not be confirmed") });
    expect(JSON.stringify(result)).not.toContain("Private diagnostics");
  });
});
