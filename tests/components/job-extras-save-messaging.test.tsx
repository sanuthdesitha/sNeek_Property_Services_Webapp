import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), refresh: vi.fn(), mutate: vi.fn(), verify: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
import { JobExtrasPanel } from "@/components/v2/admin/jobs/job-extras-panel";
const response = (body: any, ok = true) => ({ ok, json: async () => body });
const fixture = { extras: [{ id: "extra", label: "Detail extra", instructions: "Dust high shelves", price: 20 }], effectivePrice: 120, fixedPrice: 120 };
const field = (name: string) => screen.getByText(name, { selector: "label" }).parentElement!.querySelector("input")!;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch); m.mutate.mockResolvedValue(response({ fixedPrice: 140, emailed: false })); m.verify.mockResolvedValue(response({ ok: true })); m.fetch.mockImplementation(async (url, options) => url === "/api/admin/security/verify" ? m.verify() : options?.method ? m.mutate(options) : response(fixture)); });
afterEach(() => vi.unstubAllGlobals());
async function fillCustom() {
 render(<JobExtrasPanel jobId="j" fixedPrice={120} />); await screen.findByText("Detail extra");
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
 fireEvent.change(field("Label"), { target: { value: " Additional scope " } }); fireEvent.change(field("Price (ex GST)"), { target: { value: "20" } });
 fireEvent.change(field("Internal change note (optional)"), { target: { value: "Internal office record" } });
}
it("adding scope describes saved total without claiming an email was sent", async () => {
 await fillCustom(); expect(screen.getByText(/Changes and the updated total are saved without sending a client email/)).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Add extra & update price" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra added", description: "New total $140.00 · saved without sending a client email" }));
 expect(JSON.parse(m.mutate.mock.calls[0][0].body)).toMatchObject({ add: [{ label: "Additional scope", price: 20 }], note: "Internal office record" });
 expect(m.refresh).toHaveBeenCalledOnce();
});
it("failed extra save retains entered scope and internal note without successful refresh", async () => {
 m.mutate.mockResolvedValue(response({ error: "Invoice already locked" }, false)); await fillCustom(); fireEvent.click(screen.getByRole("button", { name: "Add extra & update price" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't add the extra" })));
 expect(field("Label")).toHaveValue(" Additional scope "); expect(field("Internal change note (optional)")).toHaveValue("Internal office record"); expect(m.refresh).not.toHaveBeenCalled();
});
it.each([true, false])("removal requires verified security and accurately describes saved-only outcome (%s)", async verified => {
 if (!verified) m.verify.mockResolvedValue(response({ error: "Denied" }, false));
 render(<JobExtrasPanel jobId="j" fixedPrice={120} />); await screen.findByText("Detail extra"); fireEvent.click(screen.getByRole("button", { name: "Remove Detail extra" }));
 expect(screen.getByText(/No client email is sent/)).toBeVisible();
 fireEvent.change(field("Security PIN"), { target: { value: "1234" } }); fireEvent.click(screen.getByRole("button", { name: "Remove extra" }));
 if (verified) {
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra removed", description: "New total $140.00 · saved without sending a client email" }));
  expect(m.mutate.mock.calls[0][0].method).toBe("DELETE"); expect(JSON.parse(m.mutate.mock.calls[0][0].body)).toEqual({ removeLabels: ["Detail extra"] });
 } else { await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't remove the extra" }))); expect(m.mutate).not.toHaveBeenCalled(); }
});
