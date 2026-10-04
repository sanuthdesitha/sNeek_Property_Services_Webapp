import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: () => null }));
vi.mock("@/components/shared/image-annotator", () => ({ ImageAnnotator: () => null }));
import { DamageReportForm } from "@/components/v2/cleaner/damage-report-form";
const item = { id: "item", area: "Bathroom", category: "Mirror", description: "Large crack across mirror", severity: "MODERATE", photos: [{ s3Key: "proof.jpg", section: "OVERVIEW" }] };
let fetcher: ReturnType<typeof vi.fn>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { vi.useFakeTimers(); fetcher = vi.fn().mockImplementation(async () => json({ report: { id: "report", items: [item] } })); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { render(<DamageReportForm jobId="job" embedded />); }); }
async function advance() { await act(async () => { await vi.advanceTimersByTimeAsync(1300); }); }
it("does not write the hydrated draft until the cleaner edits, then keeps its report identity", async () => {
 await mount(); await advance(); expect(fetcher).toHaveBeenCalledTimes(1);
 fireEvent.change(screen.getByPlaceholderText("e.g. Main bathroom"), { target: { value: "Bedroom" } });
 await advance();
 expect(fetcher.mock.calls[1][1].method).toBe("PUT"); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ reportId: "report", items: [{ area: "Bedroom" }] });
 expect(screen.getByText("Saved")).toBeInTheDocument();
 expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
it("shows failed autosave persistently and retries on the next edit", async () => {
 await mount(); fetcher.mockResolvedValueOnce(json({}, 503));
 fireEvent.change(screen.getByPlaceholderText("e.g. Main bathroom"), { target: { value: "Bedroom" } }); await advance();
 expect(screen.getByText("Not saved — keep this page open")).toBeInTheDocument();
 fireEvent.change(screen.getByPlaceholderText("e.g. Main bathroom"), { target: { value: "Kitchen" } }); await advance();
 expect(screen.getByText("Saved")).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("binds explicit submission to the loaded draft report and stops autosave afterward", async () => {
 const onSubmitted = vi.fn(); await act(async () => { render(<DamageReportForm jobId="job" onSubmitted={onSubmitted} />); });
 fireEvent.click(screen.getByRole("button", { name: "Submit damage report" })); await act(async () => {});
 expect(fetcher.mock.calls[1][1].method).toBe("POST"); expect(JSON.parse(fetcher.mock.calls[1][1].body).reportId).toBe("report"); expect(onSubmitted).toHaveBeenCalledTimes(1);
 await advance(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("shows load failure without saving an empty replacement report", async () => {
 fetcher.mockResolvedValueOnce(json({ error: "Access denied" }, 403)); await mount(); await advance();
 expect(screen.getByText("Access denied")).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([true, false])("saves an unsaved report identity before explicit POST (save succeeds=%s)", async ok => {
 fetcher.mockResolvedValueOnce(json({ report: { items: [item] } })); await mount();
 fetcher.mockResolvedValueOnce(json(ok ? { report: { id: "new-report" } } : {}, ok ? 200 : 503));
 fireEvent.click(screen.getByRole("button", { name: "Submit damage report" })); await act(async () => {});
 expect(fetcher.mock.calls[1][1].method).toBe("PUT");
 if (ok) {
   expect(fetcher.mock.calls[2][1].method).toBe("POST"); expect(JSON.parse(fetcher.mock.calls[2][1].body).reportId).toBe("new-report");
 } else {
   expect(screen.getByText("Save the draft before submitting.")).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(2);
 }
});
it("keeps submission errors visible and preserves the draft for retry", async () => {
 await mount(); fetcher.mockResolvedValueOnce(json({ error: "Report changed; reload it" }, 409));
 fireEvent.click(screen.getByRole("button", { name: "Submit damage report" })); await act(async () => {});
 expect(screen.getByText("Report changed; reload it")).toBeInTheDocument();
 expect(screen.getByPlaceholderText("e.g. Main bathroom")).toHaveValue("Bathroom");
});
it("retains an existing report id when autosave acknowledges without repeating it", async () => {
 await mount(); fetcher.mockResolvedValueOnce(json({ ok: true }));
 fireEvent.change(screen.getByPlaceholderText("e.g. Main bathroom"), { target: { value: "Bedroom" } }); await advance();
 fireEvent.click(screen.getByRole("button", { name: "Submit damage report" })); await act(async () => {});
 expect(JSON.parse(fetcher.mock.calls[2][1].body).reportId).toBe("report");
});
it("an edited draft without a report id autosaves without inventing one", async () => {
 fetcher.mockResolvedValueOnce(json({ report: { items: [item] } })); await mount();
 fireEvent.change(screen.getByPlaceholderText("e.g. Main bathroom"), { target: { value: "Bedroom" } }); await advance();
 expect(JSON.parse(fetcher.mock.calls[1][1].body).reportId).toBeUndefined(); expect(screen.getByText("Saved")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Submit damage report" })); await act(async () => {});
 expect(JSON.parse(fetcher.mock.calls[2][1].body).reportId).toBe("report");
});
