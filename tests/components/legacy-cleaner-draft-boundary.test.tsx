import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ toast: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "job" }), useRouter: () => ({ push: m.push }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/lib/geo/get-position", () => ({ getAccuratePosition: async () => { throw new Error("No GPS in test"); }, formatAccuracy: () => "", GpsError: class extends Error {}, POOR_ACCURACY_M: 100 }));
vi.mock("@/components/forms/field-renderer", () => ({ FieldRenderer: () => null }));
vi.mock("@/components/shared/clock-locations-map", () => ({ ClockLocationsMap: () => null }));
vi.mock("@/components/maintenance/report-maintenance-sheet", () => ({ ReportMaintenanceSheet: () => null }));
vi.mock("@/components/cleaner/driving-panel", () => ({ DrivingPanel: () => null }));
import CleanerJobPage from "@/app/cleaner/jobs/[id]/page";
let fetcher: ReturnType<typeof vi.fn>;
let shared: any;
let result: any;
let submitStatus: number;
let body: any;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
 vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); shared = null; result = { ok: true }; submitStatus = 200;
 body = { job: { id: "job", jobType: "GENERAL_CLEAN", status: "ASSIGNED", scheduledDate: "2026-10-03", propertyId: "property", property: { id: "property", name: "Home" } }, timeState: { completedSeconds: 0, isRunning: false }, template: { id: "template", schema: { sections: [] } }, jobTasks: [] };
 fetcher = vi.fn(async (url: RequestInfo | URL, options: RequestInit = {}) => {
  if (String(url).endsWith("/form")) return json(body);
  if (String(url).endsWith("/briefing")) return json({});
  if (String(url).endsWith("/early-checkout-requests")) return json([]);
  if (String(url).endsWith("/reschedule-request")) return json([]);
  if (String(url).endsWith("/draft")) return json(options.method === "PATCH" ? { updatedAt: new Date().toISOString() } : { draft: shared });
  if (String(url).endsWith("/submit")) return new Response(JSON.stringify(result), { status: submitStatus });
  throw new Error(`Unexpected ${options.method ?? "GET"} ${url}`);
 });vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals(); });
async function mount() { await act(async () => { render(<CleanerJobPage />); }); }
const writes = () => fetcher.mock.calls.filter(([, options]) => options?.method === "DELETE");
it.each([{ stockCorrectionRequired: true }, { payRequestsAlreadyRecorded: 1 }])("keeps correction notices when an explicitly queued submission syncs (%j)", async flags => {
 result = { ok: true, ...flags }; localStorage.setItem("cleaner-job-pending-submit:job", JSON.stringify({ templateId: "template", data: {} }));
 await mount();
 expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Queued submission synced", description: expect.stringContaining(flags.stockCorrectionRequired ? "Stock was already recorded" : "Existing extra-payment requests were kept") }));
 expect(localStorage.getItem("cleaner-job-pending-submit:job")).toBeNull(); expect(m.push).toHaveBeenCalledWith("/cleaner"); expect(writes()).toEqual([]);
});
it("ignores obsolete shared progress on initial reset load without deleting it", async () => {
 shared = { editorSessionId: "other", updatedAt: "2099-01-01T00:00:00Z", state: { step: "checklist", formData: { stale: "old clean" } } };
 await mount(); expect(writes()).toEqual([]);
 expect(JSON.parse(localStorage.getItem("cleaner-job-draft:job")!).formData.stale).toBeUndefined();
 expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
it("ignores obsolete progress arriving in a shared draft poll without submitting or deleting it", async () => {
 await mount(); shared = { editorSessionId: "other", updatedAt: "2099-01-01T00:00:00Z", state: { step: "checklist", formData: { stale: "old clean" } } };
 await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
 expect(fetcher.mock.calls.filter(([url, options]) => String(url).endsWith("/draft") && !options?.method).length).toBeGreaterThan(1);
 expect(writes()).toEqual([]); expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
it("keeps an explicitly queued submission available when the server rejects it", async () => {
 submitStatus = 409; result = { error: "This form was reset. Review before submitting." };
 localStorage.setItem("cleaner-job-pending-submit:job", JSON.stringify({ templateId: "template", data: {} }));
 await mount();
 expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Submission failed", description: result.error, variant: "destructive" }));
 expect(localStorage.getItem("cleaner-job-pending-submit:job")).not.toBeNull(); expect(m.push).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
});
it("restores newer valid shared progress without treating draft load as submission", async () => {
 body.job.status = "IN_PROGRESS";
 shared = { editorSessionId: "other", updatedAt: "2099-01-01T00:00:00Z", state: { step: "checklist", formData: { sharedAnswer: "still drafting" } } };
 await mount();
 expect(JSON.parse(localStorage.getItem("cleaner-job-draft:job")!).formData.sharedAnswer).toBe("still drafting");
 expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false); expect(writes()).toEqual([]);
});
it("reports ordinary queued success without inventing a stock or pay correction", async () => {
 localStorage.setItem("cleaner-job-pending-submit:job", JSON.stringify({ templateId: "template", data: {} }));
 await mount();
 expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Queued submission synced", description: "Offline submission is now synced." }));
 expect(localStorage.getItem("cleaner-job-pending-submit:job")).toBeNull(); expect(writes()).toEqual([]);
});
it.each([
 [{ stockCorrectionRequired: true }, "Stock was already recorded"],
 [{ payRequestsAlreadyRecorded: 1 }, "Existing extra-payment requests were kept"],
 [{}, "Submission sent to admin."],
])("submits restored draft only after the cleaner clicks Submit Job (%j)", async (flags, message) => {
 body.job.status = "IN_PROGRESS"; result = { ok: true, ...flags };
 localStorage.setItem("cleaner-job-draft:job", JSON.stringify({ step: "submit", formData: {}, uploads: {}, laundryOutcome: "NO_PICKUP_REQUIRED", laundrySkipReasonCode: "NO_LAUNDRY", confirmChecklist: true, confirmOnSite: true }));
 await mount(); expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
 await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Submit Job" })); });
 expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Job submitted successfully", description: expect.stringContaining(String(message)) }));
 expect(m.push).toHaveBeenCalledWith("/cleaner"); expect(writes()).toEqual([]);
});
it("preserves newer local progress when an older shared draft arrives during load", async () => {
 body.job.status = "IN_PROGRESS";
 localStorage.setItem("cleaner-job-draft:job", JSON.stringify({ step: "checklist", updatedAt: "2100-01-01T00:00:00Z", formData: { answer: "new local work" } }));
 shared = { editorSessionId: "other", updatedAt: "2099-01-01T00:00:00Z", state: { step: "checklist", formData: { answer: "older shared work" } } };
 await mount();
 expect(JSON.parse(localStorage.getItem("cleaner-job-draft:job")!).formData.answer).toBe("new local work");
 expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false); expect(writes()).toEqual([]);
});
