import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admin/properties/property", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({ EAddressInput: () => null }));
vi.mock("@/components/v2/admin/properties/property-cover-image", () => ({ PropertyCoverImage: () => null }));
vi.mock("@/components/v2/admin/properties/nfc-tags-card", () => ({ NfcTagsCard: () => null }));
vi.mock("@/components/v2/admin/properties/property-inventory-add", () => ({ PropertyInventoryAdd: () => null }));
vi.mock("@/components/v2/admin/properties/property-deep-clean-planning", () => ({ PropertyDeepCleanPlanning: () => <div>Deep-clean planning mounted</div> }));
vi.mock("@/components/v2/admin/properties/property-cadence-ledger", () => ({ PropertyCadenceLedger: () => <div>Cadence ledger mounted</div> }));
vi.mock("@/components/v2/admin/properties/property-jobs-history", () => ({ PropertyJobsHistory: () => null }));
vi.mock("@/components/v2/admin/properties/property-stats-strip", () => ({ PropertyStatsStrip: () => null }));
vi.mock("@/components/v2/admin/properties/property-billing-rates", () => ({ PropertyBillingRates: () => null }));
vi.mock("@/components/v2/admin/properties/property-checklist-profile", () => ({ PropertyChecklistProfile: () => null, PropertyFormOverrides: () => null }));
vi.mock("@/components/v2/admin/properties/property-access-guide-editor", () => ({ PropertyAccessGuideEditor: () => null }));
vi.mock("@/components/v2/admin/properties/property-setup-guide-editor", () => ({ PropertySetupGuideEditor: () => null, LaundryBagColorPicker: () => null }));
import { PropertyDetail } from "@/components/v2/admin/properties/property-detail";
const response = (body: any, ok = true) => ({ ok, json: async () => body });
const taskUrl = "/api/admin/properties/p/pending-tasks";
beforeEach(() => {
 vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch); m.post.mockResolvedValue(response({ id: "created" }));
 m.fetch.mockImplementation(async (url, options) => {
  if (url === taskUrl && options?.method === "POST") return m.post(JSON.parse(options.body));
  if (url === "/api/admin/properties/p") return response({ id: "p", name: "Test home", propertyStock: [] });
  return response([]);
 });
});
afterEach(() => vi.unstubAllGlobals());
async function openTask() { render(<PropertyDetail propertyId="p" />); await screen.findByText("Test home"); fireEvent.click(screen.getByRole("button", { name: /^Checklist/ })); fireEvent.click(screen.getByRole("button", { name: "Add task" })); }
const title = () => screen.getByPlaceholderText("e.g. Replace batteries in smoke alarm");
const submit = () => fireEvent.click(screen.getAllByRole("button", { name: "Add task" }).at(-1)!);
it("new tasks default to mandatory photo proof and opt-in conditional status; successful creation resets defaults", async () => {
 await openTask(); expect(screen.getByRole("switch", { name: "Requires photo" })).toHaveAttribute("aria-checked", "true");
 const optional = screen.getByRole("switch", { name: /Allow not applicable/ }); expect(optional).toHaveAttribute("aria-checked", "false"); fireEvent.click(optional);
 fireEvent.change(title(), { target: { value: " Check plant soil " } }); submit();
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Task added" })));
 expect(m.post.mock.calls[0][0]).toMatchObject({ title: "Check plant soil", requiresPhoto: true, requiresNote: false, allowNotApplicable: true, requestId: expect.any(String) });
 const firstId = m.post.mock.calls[0][0].requestId;
 fireEvent.click(screen.getByRole("button", { name: "Add task" })); expect(title()).toHaveValue(""); expect(screen.getByRole("switch", { name: /Allow not applicable/ })).toHaveAttribute("aria-checked", "false"); expect(screen.getByRole("switch", { name: "Requires photo" })).toHaveAttribute("aria-checked", "true");
 fireEvent.change(title(), { target: { value: "Second task" } }); submit(); await waitFor(() => expect(m.post).toHaveBeenCalledTimes(2)); expect(m.post.mock.calls[1][0].requestId).not.toBe(firstId);
});
it("HTTP failure keeps typed work and request identity; retry does not create a new request token", async () => {
 m.post.mockResolvedValueOnce(response({ error: "Conflict" }, false)).mockResolvedValue(response({ id: "created" }));
 await openTask(); fireEvent.change(title(), { target: { value: "Skirting detail" } });
 fireEvent.change(screen.getByText("Description", { selector: "label" }).parentElement!.querySelector("textarea")!, { target: { value: "Include behind door" } }); submit();
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to add task", description: "Conflict" })));
 expect(title()).toHaveValue("Skirting detail"); expect(screen.getByDisplayValue("Include behind door")).toBeInTheDocument();
 submit(); await waitFor(() => expect(m.post).toHaveBeenCalledTimes(2)); expect(m.post.mock.calls[1][0]).toEqual(m.post.mock.calls[0][0]);
});
it("Jobs tab mounts the read-only evidence ledger; task controls cannot submit an empty title", async () => {
 await openTask(); expect(screen.getAllByRole("button", { name: "Add task" }).at(-1)).toBeDisabled();
 fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: /^Jobs & history/ }));
 expect(screen.getByText("Cadence ledger mounted")).toBeInTheDocument(); expect(screen.getByText("Deep-clean planning mounted")).toBeInTheDocument(); expect(m.post).not.toHaveBeenCalled();
});
