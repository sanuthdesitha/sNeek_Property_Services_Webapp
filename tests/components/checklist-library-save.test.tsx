import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/components/v2/admin/forms/management/estate-checklists-workspace", () => ({ TaskImageUpload: () => null }));
import { EstateChecklistLibrary } from "@/components/v2/admin/checklists/checklist-library-editor";
const fixture = { modules: [{ id: "room", key: "room", title: "Living", category: "ROOM", appliesWhen: null, isActive: true, items: [{ id: "plant", key: "plant", label: "Plant detail", instructions: "Check soil", fieldType: "photo", required: true, defaultOn: true, jobTypes: [], appliesWhen: null, isActive: true }] }], featureDefs: [{ key: "plants", label: "Plants" }], jobTypes: ["AIRBNB_TURNOVER"] };
const response = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { m.fetch.mockReset(); vi.stubGlobal("fetch", m.fetch); m.fetch.mockResolvedValue(response(fixture)); });
afterEach(() => vi.unstubAllGlobals());
it("reads library without seeding until explicit add-missing-standard action", async () => {
 render(<EstateChecklistLibrary />); await screen.findByText("Living");
 expect(m.fetch).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole("button", { name: "Expand module" })); expect(screen.getByText("Plant detail")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Add missing standard items" }));
 await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(3));
 expect(m.fetch.mock.calls[1]).toEqual(["/api/admin/checklist-library/seed", { method: "POST" }]);
});
it("seed failure is visible and does not pretend the library refreshed", async () => {
 m.fetch.mockResolvedValueOnce(response(fixture)).mockResolvedValueOnce(response({ error: "Seed denied" }, false));
 render(<EstateChecklistLibrary />); await screen.findByText("Living"); fireEvent.click(screen.getByRole("button", { name: "Add missing standard items" }));
 expect(await screen.findByText("Seed denied")).toBeVisible(); expect(m.fetch).toHaveBeenCalledTimes(2);
});
it("explicit module rule and active toggles send narrow PATCH payloads", async () => {
 render(<EstateChecklistLibrary />); await screen.findByText("Living");
 fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "plants" } });
 await waitFor(() => expect(m.fetch.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(true));
 expect(JSON.parse(m.fetch.mock.calls.find(([, options]) => options?.method === "PATCH")![1].body)).toEqual({ appliesWhen: { feature: "plants" } });
 await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(3));
 fireEvent.click(screen.getByRole("switch"));
 await waitFor(() => expect(m.fetch).toHaveBeenCalledTimes(5));
 expect(JSON.parse(m.fetch.mock.calls[3][1].body)).toEqual({ isActive: false });
});
it("new item save uses the selected module and a stable derived key", async () => {
 render(<EstateChecklistLibrary />); await screen.findByText("Living"); fireEvent.click(screen.getByRole("button", { name: "Expand module" })); fireEvent.click(screen.getByRole("button", { name: "Add item" }));
 const label = screen.getByText("Task label").parentElement!.querySelector("input")!;
 fireEvent.change(label, { target: { value: "Check plant soil" } });
 fireEvent.change(screen.getByText("How-to instructions (reveal popup)").parentElement!.querySelector("textarea")!, { target: { value: "Water only if dry" } });
 fireEvent.click(screen.getByRole("button", { name: "Save" }));
 await waitFor(() => expect(m.fetch.mock.calls.some(([url, options]) => url.endsWith("/room/items") && options?.method === "POST")).toBe(true));
 const call = m.fetch.mock.calls.find(([url]) => url.endsWith("/room/items"))!;
 expect(JSON.parse(call[1].body)).toMatchObject({ key: "room.check-plant-soil", label: "Check plant soil", instructions: "Water only if dry" });
});
it.each([true, false])("module deletion verifies security before DELETE (verification accepted=%s)", async accepted => {
 m.fetch.mockImplementation(async (url, options) => url === "/api/admin/security/verify" ? response(accepted ? { ok: true } : { error: "Denied" }, accepted) : response(fixture));
 render(<EstateChecklistLibrary />); await screen.findByText("Living"); fireEvent.click(screen.getByRole("button", { name: "Delete module" }));
 fireEvent.change(screen.getByText("Security PIN").parentElement!.querySelector("input")!, { target: { value: "1234" } });
 fireEvent.click(screen.getAllByRole("button", { name: "Delete module" }).at(-1)!);
 await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => url === "/api/admin/security/verify")).toBe(true));
 if (accepted) await waitFor(() => expect(m.fetch.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(true));
 else { await screen.findByText(/not accepted|Denied/); expect(m.fetch.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false); }
});
