import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PropertyPhotoMemoryPanel } from "@/components/v2/admin/property-photo-memory";
const auth = vi.hoisted(() => ({ session: { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] }, impersonation: undefined as unknown } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: auth.session }) }));
const property = { id: "p1", name: "Harbour apartment" };
const item = { id: "m1", fieldId: "kitchen", fieldLabel: "Kitchen after", sectionLabel: "Kitchen", submittedAt: "2026-09-20T03:00:00Z", url: "https://media.invalid/photo.jpg", excluded: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const page = (overrides: Record<string, unknown> = {}) => ({ property, items: [item], nextOffset: null, training: null, modelConfigured: true, trainingEnabled: true, ...overrides });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { auth.session = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] }, impersonation: undefined }; fetcher = vi.fn(async (url: string) => json(url.includes("?q=") ? { properties: [property, { id: "p2", name: "Other property" }] } : page())); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function select() { await screen.findByRole("option", { name: property.name }); fireEvent.change(screen.getByLabelText("Property", { exact: true }), { target: { value: "p1" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
it("groups canonical labels and provenance, and writes only an explicit reasoned exclusion or restoration", async () => {
  let excluded = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { excluded = JSON.parse(init.body as string).excluded; return json({ ok: true }); }
    return json(url.includes("?q=") ? { properties: [property] } : page({ items: [{ ...item, excluded }] }));
  }); render(<PropertyPhotoMemoryPanel canEdit />); await select();
  await screen.findByText("Kitchen · Kitchen after"); expect(screen.getByText(/20 Sept 2026/)).toBeVisible(); expect(fetcher.mock.calls.every(call => !call[1]?.method)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Exclude example" })); fireEvent.click(screen.getByRole("button", { name: "Confirm exclusion" }));
  await screen.findByText(/Enter a reason between/); expect(excluded).toBe(false);
  fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Photo is labelled as the wrong room" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm exclusion" }));
  await screen.findByText("Excluded from memory"); expect(JSON.parse(fetcher.mock.calls.find(call => call[1]?.method === "PATCH")![1].body)).toEqual({ propertyId: "p1", mediaId: "m1", excluded: true, reason: "Photo is labelled as the wrong room" });
  fireEvent.click(screen.getByRole("button", { name: "Restore example" })); fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Label checked and confirmed" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm restoration" }));
  await screen.findByText("Not excluded from memory"); expect(fetcher.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(2);
});
it("keeps operations read-only even if an obsolete canEdit prop is true", async () => {
  auth.session.user = { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }; render(<PropertyPhotoMemoryPanel canEdit />); await select(); await screen.findByText("Kitchen · Kitchen after");
  expect(screen.queryByRole("button", { name: "Exclude example" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Train / update model" })).toBeDisabled();
});
it("does not fetch memory during impersonation", () => { auth.session.impersonation = { actorId: "admin", mode: "FULL" }; render(<PropertyPhotoMemoryPanel canEdit />); expect(screen.getByText(/Exit impersonation/)).toBeVisible(); expect(fetcher).not.toHaveBeenCalled(); });
it("blocks uncertain writes until refresh reveals the actual saved state", async () => {
  let excluded = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (init?.method === "PATCH") { excluded = true; throw new Error("Connection lost"); } return json(url.includes("?q=") ? { properties: [property] } : page({ items: [{ ...item, excluded }] })); });
  render(<PropertyPhotoMemoryPanel canEdit />); await select(); fireEvent.click(await screen.findByRole("button", { name: "Exclude example" })); fireEvent.change(screen.getByLabelText("Reason for this change"), { target: { value: "Wrong location" } }); fireEvent.click(screen.getByRole("button", { name: "Confirm exclusion" }));
  await screen.findByText(/Refresh before trying again/); expect(screen.getByRole("button", { name: "Confirm exclusion" })).toBeDisabled(); expect(fetcher.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh examples and model" })); await screen.findByText("Excluded from memory"); expect(screen.getByRole("button", { name: "Restore example" })).toBeEnabled();
});
it("ignores a late property response after switching selection", async () => {
  const pending = deferred<Response>(); fetcher.mockImplementation((url: string) => url.includes("?q=") ? Promise.resolve(json({ properties: [property, { id: "p2", name: "Other property" }] })) : url.includes("propertyId=p1") ? pending.promise : Promise.resolve(json(page({ property: { id: "p2", name: "Other property" }, items: [] }))));
  render(<PropertyPhotoMemoryPanel canEdit />); await select(); fireEvent.change(screen.getByLabelText("Property", { exact: true }), { target: { value: "p2" } }); await screen.findByText(/No valid labelled examples/);
  await act(async () => pending.resolve(json(page()))); expect(screen.queryByText("Kitchen · Kitchen after")).not.toBeInTheDocument();
});
it("loads the next page even when filtered records leave the first page empty", async () => {
  fetcher.mockImplementation(async (url: string) => json(url.includes("?q=") ? { properties: [property] } : url.includes("offset=60") ? page() : page({ items: [], nextOffset: 60 })));
  render(<PropertyPhotoMemoryPanel canEdit />); await select(); fireEvent.click(await screen.findByRole("button", { name: "Load more examples" })); await screen.findByText("Kitchen · Kitchen after"); expect(screen.queryByRole("button", { name: "Load more examples" })).not.toBeInTheDocument();
});
it("clears selected-property data when the actor changes", async () => {
  const view = render(<PropertyPhotoMemoryPanel canEdit />); await select(); await screen.findByText("Kitchen · Kitchen after");
  auth.session.user = { id: "another-admin", role: "ADMIN", heldRoles: ["ADMIN"] }; view.rerender(<PropertyPhotoMemoryPanel canEdit />); expect(screen.queryByText("Kitchen · Kitchen after")).not.toBeInTheDocument(); expect(screen.getByLabelText("Property", { exact: true })).toHaveValue("");
});
it("queues training only explicitly when enabled and refreshes versioned status", async () => {
  let queued = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (init?.method === "POST") { queued = true; return json({ ok: true }); } return json(url.includes("?q=") ? { properties: [property] } : page({ training: { status: queued ? "QUEUED" : "READY", modelVersion: "v3" } })); });
  render(<PropertyPhotoMemoryPanel canEdit />); await select(); await screen.findByText("Status: READY · Version v3"); expect(queued).toBe(false); fireEvent.click(screen.getByRole("button", { name: "Train / update model" })); await screen.findByText("Status: QUEUED · Version v3");
  expect(JSON.parse(fetcher.mock.calls.find(call => call[1]?.method === "POST")![1].body)).toEqual({ propertyId: "p1" });
});
it.each([{ modelConfigured: false }, { trainingEnabled: false }])("disables training when the server prerequisite is absent: %j", async override => {
  fetcher.mockImplementation(async (url: string) => json(url.includes("?q=") ? { properties: [property] } : page(override))); render(<PropertyPhotoMemoryPanel canEdit />); await select(); await screen.findByText("Kitchen · Kitchen after"); expect(screen.getByRole("button", { name: "Train / update model" })).toBeDisabled();
});
it("rejects a cross-property or unsafe image response and offers refresh", async () => {
  fetcher.mockImplementation(async (url: string) => json(url.includes("?q=") ? { properties: [property] } : page({ items: [{ ...item, url: "javascript:alert(1)" }] }))); render(<PropertyPhotoMemoryPanel canEdit />); await select(); await screen.findByText(/Photo memory could not be verified/); expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Exclude example" })).not.toBeInTheDocument();
});
