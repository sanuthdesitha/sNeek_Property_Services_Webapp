import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EstateInvoices } from "@/components/v2/admin/finance/estate-invoices";
const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps selected period scope and explains included jobs versus existing invoice reservations", async () => {
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/generate")) { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "draft", generationSummary: { includedJobCount: 12, alreadyInvoicedJobCount: 3 } })); }
    return new Response(JSON.stringify({ clients: [{ id: "client", name: "Client", email: "client@example.test" }], properties: [{ id: "property", name: "House", suburb: "Sydney", clientId: "client" }], rates: [], invoices: [] }));
  }));
  render(<EstateInvoices/>);
  const launch = await screen.findByRole("button", { name: "Generate invoice" }); fireEvent.click(launch);
  const modal = within(screen.getByRole("dialog"));
  await waitFor(() => expect(modal.getAllByRole("combobox")[0]).toHaveValue("client"));
  const dates = screen.getByRole("dialog").querySelectorAll('input[type="date"]');
  fireEvent.change(dates[0], { target: { value: "2026-09-01" } }); fireEvent.change(dates[1], { target: { value: "2026-09-15" } });
  expect(modal.getByText(/Includes jobs that have started or finished/)).toHaveTextContent("including drafts");
  fireEvent.click(modal.getByRole("button", { name: "Generate draft invoice" }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invoice draft created", description: "12 job(s) included. 3 job(s) already on another non-void invoice, including drafts." })));
  expect(requests).toEqual([{ clientId: "client", periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-15T23:59:59.999Z", gstEnabled: true, periodBasis: "SCHEDULED" }]);
});
import { ClientInvoicesPage } from "@/components/admin/client-invoices-page";
it.each(["SCHEDULED", "SERVICE"])("classic invoice screen explicitly sends the selected %s period basis", async basis => {
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/generate")) { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify({ error: "Fixture validation response" }), { status: 400 }); }
    return new Response(JSON.stringify({ clients: [{ id: "client", name: "Client", email: "client@example.test" }], properties: [], rates: [], invoices: [] }));
  }));
  render(<ClientInvoicesPage/>);
  fireEvent.click(await screen.findByRole("button", { name: "Generate invoice" }));
  const modal = within(screen.getByRole("dialog"));
  expect(modal.getByLabelText("Bill jobs by")).toHaveValue("SCHEDULED");
  if (basis === "SERVICE") fireEvent.change(modal.getByLabelText("Bill jobs by"), { target: { value: basis } });
  await waitFor(() => expect(modal.getByRole("button", { name: "Generate draft invoice" })).toBeEnabled());
  fireEvent.click(modal.getByRole("button", { name: "Generate draft invoice" }));
  await waitFor(() => expect(requests).toHaveLength(1)); expect(requests[0].periodBasis).toBe(basis);
});
