import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/components/v2/admin/forms/management/estate-checklists-workspace", () => ({ TaskImageUpload: () => null }));
import { PropertyChecklistProfile } from "@/components/v2/admin/properties/property-checklist-profile";
const base = "/api/admin/properties/p/checklist-profile";
const fixture = { propertyId: "p", propertyName: "Home", features: {}, featureDefs: [], jobTypes: ["AIRBNB_TURNOVER"], library: [{ id: "room", key: "room", title: "Living", category: "ROOM", items: [{ id: "plant", key: "plant", label: "Plant detail", instructions: "Check soil", fieldType: "photo", frequency: "ROTATIONAL", rotationEveryNCleans: 4, jobTypes: [], appliesWhen: null }] }], selections: { modules: { room: { enabled: true, items: { plant: { enabled: true } } } }, customItems: [] }, profile: { status: "DRAFT", approvedAt: null, generatedTemplateIds: {} } };
const response = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch); m.fetch.mockImplementation(async (url, options) => options?.method === "POST" ? response({ schema: { sections: [] }, generated: { AIRBNB_TURNOVER: "new" } }) : options?.method === "PUT" ? response({ ok: true }) : response(fixture)); });
afterEach(() => vi.unstubAllGlobals());
it("saves property instruction,3-clean cadence,photo and service choices without approval", async () => {
 render(<PropertyChecklistProfile propertyId="p" />); await screen.findByText("Plant detail"); fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
 fireEvent.change(screen.getByLabelText("Property-specific instructions"), { target: { value: "Water only when soil is dry" } });
 fireEvent.change(screen.getByLabelText("Repeat after completed cleans"), { target: { value: "3" } });
 fireEvent.click(within(screen.getByLabelText("Property-specific instructions").parentElement!.parentElement!).getByRole("checkbox", { name: "Photo required" }));
 fireEvent.click(within(screen.getByLabelText("Property-specific instructions").parentElement!.parentElement!).getByRole("button", { name: "Airbnb Turnover" }));
 fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Checklist draft saved" }));
 const saved = m.fetch.mock.calls.find(([, options]) => options?.method === "PUT")!;
 expect(saved[0]).toBe(base); expect(JSON.parse(saved[1].body).selections.modules.room.items.plant).toMatchObject({ enabled: true, instructions: "Water only when soil is dry", rotationEveryNCleans: 3, requiresPhoto: true, jobTypes: [] });
 expect(m.fetch.mock.calls.some(([url, options]) => url === base && options?.method === "POST")).toBe(false);
});
it("toggling task and section preserves per-item configuration", async () => {
 render(<PropertyChecklistProfile propertyId="p" />); await screen.findByText("Plant detail");
 fireEvent.click(screen.getByLabelText("Plant detail")); fireEvent.click(screen.getByLabelText("Plant detail"));
 fireEvent.click(screen.getByLabelText(/Living/)); fireEvent.click(screen.getByLabelText(/Living/));
 fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Checklist draft saved" }));
 expect(JSON.parse(m.fetch.mock.calls.find(([, options]) => options?.method === "PUT")![1].body).selections.modules.room).toMatchObject({ enabled: true, items: { plant: { enabled: true } } });
});
it("failed draft save blocks approval publication", async () => {
 m.fetch.mockImplementation(async (_url, options) => options?.method === "PUT" ? response({ error: "Conflict" }, false) : response(fixture));
 render(<PropertyChecklistProfile propertyId="p" />); await screen.findByText("Plant detail");
 fireEvent.click(screen.getByRole("button", { name: "Approve & generate form" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Save failed", description: "Conflict" })));
 expect(m.fetch.mock.calls.some(([url, options]) => url === base && options?.method === "POST")).toBe(false);
});
it("approval publishes only after draft save resolves", async () => {
 render(<PropertyChecklistProfile propertyId="p" />); await screen.findByText("Plant detail"); fireEvent.click(screen.getByRole("button", { name: "Approve & generate form" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Checklist approved" })));
 const operations = m.fetch.mock.calls.filter(([url, options]) => url === base && options?.method).map(([, options]) => options.method);
 expect(operations).toEqual(["PUT", "POST"]);
});
it("every-clean tasks do not offer a completed-clean rotation control", async () => {
 const standard = { ...fixture, library: fixture.library.map(checklistModule => ({ ...checklistModule, items: checklistModule.items.map(item => ({ ...item, frequency: "EVERY_CLEAN" })) })) };
 m.fetch.mockResolvedValue(response(standard));
 render(<PropertyChecklistProfile propertyId="p" />); await screen.findByText("Plant detail"); fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
 expect(screen.queryByLabelText("Repeat after completed cleans")).not.toBeInTheDocument();
 expect(screen.getByLabelText("Property-specific instructions")).toBeInTheDocument();
});
