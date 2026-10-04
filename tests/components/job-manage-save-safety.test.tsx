import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), changed: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/components/v2/admin/jobs/job-row", () => ({ statusLabel: (status: string) => status }));
vi.mock("@/components/v2/admin/jobs/job-reset-dialog", () => ({ JobResetDialog: () => null }));
vi.mock("@/components/v2/admin/jobs/notice-images-input", () => ({ NoticeImagesInput: () => null }));
vi.mock("@/components/v2/shared/job-pay-card", () => ({ JobPayCard: () => null }));
import { JobManagePanel } from "@/components/v2/admin/jobs/job-manage";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
const revision = "2026-10-03T02:17:12.123Z";
const task = (id: string, title: string, extra = {}) => ({ id, title, description: "Original directions", source: "ADMIN", executionStatus: "OPEN", requiresPhoto: true, requiresNote: false, metadata: { allowNotApplicable: true }, ...extra });
const fixture = () => ({ id: "job", updatedAt: revision, jobType: "AIRBNB_TURNOVER", status: "COMPLETED", scheduledDate: "2026-09-18T00:00:00Z", completedAt: "2026-09-18T03:12:44.123Z", startTime: "10:00", dueTime: "14:00", endTime: "13:12", notes: "Client directions", assignments: [], internalNotes: serializeJobInternalNotes({ specialRequestTasks: [{ id: "legacy", title: "Stale metadata task", requiresPhoto: false, requiresNote: false }] }), jobTasks: [task("persisted-one", "Plant check"), task("persisted-two", "Skirting detail"), task("history", "Finished history", { executionStatus: "COMPLETED" }), task("client-task", "Client request", { source: "CLIENT" })] });
const response = (body: any = {}, ok = true) => ({ ok, json: async () => body });
const payload = (index = 0) => JSON.parse(m.fetch.mock.calls[index][1].body);
const inputFor = (label: string) => screen.getByText(label, { selector: "label" }).parentElement!.querySelector("input")!;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch); m.fetch.mockResolvedValue(response()); });
afterEach(() => vi.unstubAllGlobals());
it("Scope removes only explicitly confirmed canonical task IDs and sends the reviewed revision", async () => {
 render(<JobManagePanel job={fixture()} section="scope" onChanged={m.changed} />);
 expect(screen.getByDisplayValue("Plant check")).toBeInTheDocument(); expect(screen.queryByDisplayValue("Stale metadata task")).toBeNull(); expect(screen.queryByDisplayValue("Finished history")).toBeNull(); expect(screen.queryByDisplayValue("Client request")).toBeNull();
 const remove = screen.getAllByRole("button", { name: "Remove task" })[0]; fireEvent.click(remove);
 expect(screen.getByDisplayValue("Plant check")).toBeInTheDocument(); expect(m.fetch).not.toHaveBeenCalled();
 fireEvent.click(remove); expect(screen.queryByDisplayValue("Plant check")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
 await waitFor(() => expect(m.changed).toHaveBeenCalledOnce());
 expect(m.fetch.mock.calls[0][0]).toBe("/api/admin/jobs/job");
 expect(payload()).toMatchObject({ cancelTaskIds: ["persisted-one"], expectedUpdatedAt: revision, specialRequestTasks: [{ id: "persisted-two", title: "Skirting detail", requiresPhoto: true, allowNotApplicable: true }] });
 for (const field of ["completedAt", "scheduledDate", "startTime", "dueTime", "fixedPrice", "cleanerPayouts"]) expect(payload()).not.toHaveProperty(field);
});
it("revision conflict preserves edited task and explicit cancellation for a safe retry", async () => {
 m.fetch.mockResolvedValueOnce(response({ error: "This job changed. Reload before saving." }, false)).mockResolvedValue(response());
 render(<JobManagePanel job={fixture()} section="scope" onChanged={m.changed} />);
 fireEvent.change(screen.getByDisplayValue("Skirting detail"), { target: { value: "Skirting and corners" } });
 const remove = screen.getAllByRole("button", { name: "Remove task" })[0]; fireEvent.click(remove); fireEvent.click(remove);
 fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Update failed", description: "This job changed. Reload before saving." })));
 expect(m.changed).not.toHaveBeenCalled(); expect(screen.getByDisplayValue("Skirting and corners")).toBeInTheDocument(); expect(screen.queryByDisplayValue("Plant check")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Save scope" })); await waitFor(() => expect(m.changed).toHaveBeenCalledOnce());
 expect(payload(1)).toEqual(payload(0));
});
it("new Scope tasks default photo-on and keep their draft ID across a failed save", async () => {
 const job = { ...fixture(), jobTasks: [task("history", "History", { executionStatus: "COMPLETED" })] };
 m.fetch.mockResolvedValueOnce(response({}, false)).mockResolvedValue(response());
 render(<JobManagePanel job={job} section="scope" onChanged={m.changed} />);
 fireEvent.click(screen.getByRole("button", { name: /Add task/ }));
 expect(screen.getByRole("switch", { name: "Requires photo" })).toHaveAttribute("aria-checked", "true");
 fireEvent.change(screen.getByPlaceholderText("Task 1 title"), { target: { value: "Photo of soil" } });
 fireEvent.click(screen.getByRole("button", { name: "Save scope" })); await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Update failed" })));
 const first = payload().specialRequestTasks[0]; expect(first).toMatchObject({ title: "Photo of soil", requiresPhoto: true }); expect(first.id).toMatch(/^admin-task-/);
 fireEvent.click(screen.getByRole("button", { name: "Save scope" })); await waitFor(() => expect(m.changed).toHaveBeenCalledOnce()); expect(payload(1).specialRequestTasks[0].id).toBe(first.id);
});
it("fresh server data resets cancellation and preserves canonical task IDs for subsequent saves", async () => {
 const job = fixture(); const view = render(<JobManagePanel job={job} section="scope" onChanged={m.changed} />);
 const remove = screen.getAllByRole("button", { name: "Remove task" })[0]; fireEvent.click(remove); fireEvent.click(remove);
 view.rerender(<JobManagePanel job={{ ...job, updatedAt: "2026-10-03T03:00:00.000Z", jobTasks: [task("persisted-two", "Skirting detail")] }} section="scope" onChanged={m.changed} />);
 fireEvent.click(screen.getByRole("button", { name: "Save scope" })); await waitFor(() => expect(m.changed).toHaveBeenCalledOnce());
 expect(payload()).toMatchObject({ cancelTaskIds: [], expectedUpdatedAt: "2026-10-03T03:00:00.000Z", specialRequestTasks: [{ id: "persisted-two" }] });
});
it.each(["2026-09-18T03:12:44.123Z", null])("unchanged completion date is omitted from narrow schedule detail save (%s)", async completedAt => {
 render(<JobManagePanel job={{ ...fixture(), completedAt }} section="schedule" onChanged={m.changed} />);
 fireEvent.change(inputFor("End time"), { target: { value: "13:30" } }); fireEvent.click(screen.getByRole("button", { name: "Save schedule details" }));
 await waitFor(() => expect(m.changed).toHaveBeenCalledOnce()); expect(payload()).toMatchObject({ endTime: "13:30", expectedUpdatedAt: revision });
 for (const key of ["completedAt", "scheduledDate", "startTime", "dueTime", "specialRequestTasks", "cancelTaskIds"]) expect(payload()).not.toHaveProperty(key);
});
it.each([["2026-10-05", "2026-10-05T01:00:00.000Z"], ["", null]])("explicit completion-date edit sends Sydney noon or clear (%s)", async (date, expected) => {
 render(<JobManagePanel job={fixture()} section="schedule" onChanged={m.changed} />);
 fireEvent.change(inputFor("Completion date"), { target: { value: date } }); fireEvent.click(screen.getByRole("button", { name: "Save schedule details" }));
 await waitFor(() => expect(m.changed).toHaveBeenCalledOnce()); expect(payload().completedAt).toBe(expected);
});
it("reschedule includes revision and preserves edited date after request failure", async () => {
 m.fetch.mockResolvedValue(response({ error: "Conflict" }, false)); render(<JobManagePanel job={fixture()} section="schedule" onChanged={m.changed} />);
 fireEvent.change(inputFor("Scheduled date"), { target: { value: "2026-10-06" } }); fireEvent.click(screen.getByRole("button", { name: "Apply reschedule" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Reschedule failed" })));
 expect(payload()).toMatchObject({ date: "2026-10-06", expectedUpdatedAt: revision }); expect(inputFor("Scheduled date")).toHaveValue("2026-10-06"); expect(m.changed).not.toHaveBeenCalled();
});
it("People save preserves explicit zero base pay while blank restores formula, without Scope or completion writes", async () => {
 const job = { ...fixture(), assignments: [{ userId: "cleaner", user: { name: "Cleaner" } }] };
 render(<JobManagePanel job={job} section="people" onChanged={m.changed} />);
 expect(screen.getByText(/0 = zero base pay/)).toHaveTextContent("Approved extras and transport still apply");
 fireEvent.change(screen.getByPlaceholderText("Auto"), { target: { value: "0" } });
 fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await waitFor(() => expect(m.changed).toHaveBeenCalledOnce());
 expect(payload().cleanerPayouts).toEqual({ cleaner: 0 });
 fireEvent.change(screen.getByPlaceholderText("Auto"), { target: { value: "" } });
 fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await waitFor(() => expect(m.changed).toHaveBeenCalledTimes(2));
 expect(payload(1).cleanerPayouts).toEqual({});
 for (const body of [payload(), payload(1)]) { expect(body.expectedUpdatedAt).toBe(revision); expect(body).not.toHaveProperty("completedAt"); expect(body).not.toHaveProperty("specialRequestTasks"); }
});
