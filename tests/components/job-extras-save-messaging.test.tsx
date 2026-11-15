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
// Changed 2026-11 (board "Everyday dialogs and sheets"): the add form is the "Add an extra" window with
// "Email the client the new total", unticked by default.
async function fillCustom() {
 render(<JobExtrasPanel jobId="j" fixedPrice={120} />); await screen.findByText("Detail extra");
 fireEvent.click(screen.getByRole("button", { name: "Add an extra" }));
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "__custom__" } });
 fireEvent.change(field("What"), { target: { value: " Additional scope " } }); fireEvent.change(field("Price ex GST"), { target: { value: "20" } });
 fireEvent.change(field("Internal note, optional"), { target: { value: "Internal office record" } });
}
it("adding scope describes saved total without claiming an email was sent", async () => {
 await fillCustom(); expect(screen.getByText(/Saved without a client email unless you tick it/)).toBeVisible();
 expect(screen.getByRole("checkbox", { name: "Email the client the new total" })).not.toBeChecked();
 fireEvent.click(screen.getByRole("button", { name: "Add extra" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra added", description: "New total $140.00 · saved without sending a client email" }));
 const body = JSON.parse(m.mutate.mock.calls[0][0].body);
 expect(body).toMatchObject({ add: [{ label: "Additional scope", price: 20 }], note: "Internal office record" });
 expect(body).not.toHaveProperty("notifyClient");
 expect(m.refresh).toHaveBeenCalledOnce();
});
it("ticking Email the client the new total asks the server to email and reports the outcome", async () => {
 m.mutate.mockResolvedValue(response({ fixedPrice: 140, emailed: true, recipients: ["host@x"] }));
 await fillCustom(); fireEvent.click(screen.getByRole("checkbox", { name: "Email the client the new total" }));
 fireEvent.click(screen.getByRole("button", { name: "Add extra" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra added", description: "New total $140.00 · client emailed" }));
 expect(JSON.parse(m.mutate.mock.calls[0][0].body)).toMatchObject({ notifyClient: true });
});
it("a ticked email with no client address says it was not sent", async () => {
 m.mutate.mockResolvedValue(response({ fixedPrice: 140, emailed: false, recipients: [] }));
 await fillCustom(); fireEvent.click(screen.getByRole("checkbox", { name: "Email the client the new total" }));
 fireEvent.click(screen.getByRole("button", { name: "Add extra" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra added", description: "New total $140.00 · client not emailed: no client email on file" }));
});
it("failed extra save retains entered scope and internal note without successful refresh", async () => {
 m.mutate.mockResolvedValue(response({ error: "Invoice already locked" }, false)); await fillCustom(); fireEvent.click(screen.getByRole("button", { name: "Add extra" }));
 await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't add the extra" })));
 expect(screen.getByRole("alert")).toHaveTextContent("Not added: Invoice already locked");
 expect(field("What")).toHaveValue(" Additional scope "); expect(field("Internal note, optional")).toHaveValue("Internal office record"); expect(m.refresh).not.toHaveBeenCalled();
});
// Changed 2026-11-14: the PIN travels with the DELETE and the quote-extras route verifies it.
it.each([true, false])("removal sends the PIN for the server to verify and accurately describes saved-only outcome (%s)", async verified => {
 if (!verified) m.mutate.mockResolvedValue(response({ error: "INVALID_SECURITY_VERIFICATION" }, false));
 render(<JobExtrasPanel jobId="j" fixedPrice={120} />); await screen.findByText("Detail extra"); fireEvent.click(screen.getByRole("button", { name: "Remove Detail extra" }));
 expect(screen.getByText(/No client email is sent/)).toBeVisible();
 fireEvent.change(field("Your PIN"), { target: { value: "1234" } }); fireEvent.click(screen.getByRole("button", { name: "Remove extra" }));
 await waitFor(() => expect(m.mutate).toHaveBeenCalled());
 expect(m.mutate.mock.calls[0][0].method).toBe("DELETE"); expect(JSON.parse(m.mutate.mock.calls[0][0].body)).toEqual({ removeLabels: ["Detail extra"], security: { pin: "1234" } });
 expect(m.verify).not.toHaveBeenCalled();
 if (verified) await waitFor(() => expect(m.toast).toHaveBeenCalledWith({ title: "Extra removed", description: "New total $140.00 · saved without sending a client email" }));
 else await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't remove the extra", description: "That was not accepted. Check your PIN and try again." })));
});
