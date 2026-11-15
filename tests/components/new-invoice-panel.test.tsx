import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * New invoice panel (board "New invoice"): one h1 and three choices; the
 * period defaults from the server; the preview shows each job's charge source
 * and an unrated job as "No charge" (never $0) with its fixes; an unrated job
 * blocks Create until it is left off explicitly; Create sends one keyed
 * request even on a double click, and a retry reuses the key; phones dock it.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/v2/admin/finance/invoices/new", useSearchParams: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { NewInvoicePanel } from "@/components/v2/admin/finance/invoices/new-invoice/new-invoice-panel";

function phoneMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("min-width") ? !phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const context = {
  clients: [{ id: "c1", name: "Harbour View Stays", email: null }],
  properties: [{ id: "p1", name: "Bondi Beach House", suburb: "Bondi", clientId: "c1" }, { id: "p2", name: "Coogee Terrace", suburb: "Coogee", clientId: "c1" }],
};
const job = (id: string, extra: Record<string, unknown>) => ({ jobId: id, jobNumber: id, jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-02T01:00:00.000Z", propertyId: "p1", propertyName: "Bondi Beach House", source: "PROPERTY_RATE", amount: 165, lineDescription: "line", note: null, holidayRate: false, updatedAt: "2026-11-02T01:00:00.000Z", ...extra });
const preview = (unrated: boolean) => ({
  client: { id: "c1", name: "Harbour View Stays" }, propertyId: null, period: { start: null, end: null }, periodBasis: "SCHEDULED", gstEnabled: true,
  jobs: [
    job("J-1042", {}),
    job("J-1049", { propertyId: "p2", propertyName: "Coogee Terrace", source: "FIXED_JOB", amount: 180, note: "late checkout agreed" }),
    ...(unrated ? [job("J-1077", { propertyId: "p2", propertyName: "Coogee Terrace", jobType: "WINDOW_CLEAN", source: "MISSING", amount: null, lineDescription: null })] : []),
  ],
  unratedJobIds: unrated ? ["J-1077"] : [],
  otherLines: [], totals: { subtotal: 345, gstAmount: 34.5, totalAmount: 379.5 }, jobTotals: { subtotal: 345, gstAmount: 34.5, totalAmount: 379.5 }, chargedJobCount: 2, lineCount: 2,
  leftOut: [{ jobId: "J-1039", jobNumber: "J-1039", reason: "ALREADY_INVOICED", invoiceNumber: "INV-0418" }, { jobId: "J-1058", jobNumber: "J-1058", reason: "CANCELLED", invoiceNumber: null }],
});

let fetcher: ReturnType<typeof vi.fn>;
let createResponses: Array<() => Response>;
function routes(unrated: boolean) {
  createResponses = [];
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return (createResponses.shift() ?? (() => json({ id: "inv1", invoiceNumber: "INV-0432", totalAmount: 379.5, lineCount: 2, notBilled: unrated ? [{ jobId: "J-1077", jobNumber: "J-1077" }] : [], replayed: false })))();
    if (url.includes("view=period")) return json({ start: "2026-11-01", end: "2026-11-14", source: "LAST_INVOICE", lastInvoiceNumber: "INV-0418", lastPeriodEnd: "2026-10-31" });
    if (url.includes("view=preview")) return json(preview(unrated));
    if (url.includes("view=ready-to-bill")) return json({ total: 7820, jobs: 46, clients: 9, unratedJobs: 2, blockedClients: 2, byClient: [] });
    return json({});
  });
  vi.stubGlobal("fetch", fetcher);
}

async function mount(props: Partial<React.ComponentProps<typeof NewInvoicePanel>> = {}) {
  render(<NewInvoicePanel context={context} initialKind="jobs" initialClientId="" canManage canVoidCredit timeZone="Australia/Sydney" {...props} />);
}

async function chooseClient() {
  fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c1" } });
  await screen.findAllByText("J-1049");
}

beforeEach(() => phoneMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("New invoice panel", () => {
  it("has one heading, three choices and the batch beside it", async () => {
    routes(false);
    await mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toEqual([screen.getByRole("heading", { level: 1, name: "New invoice" })]);
    for (const name of [/From finished jobs/, /Blank invoice/, /Credit note/]) expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Create 7 drafts…" })).toBeInTheDocument();
  });

  it("fills the period from the client's last invoice and shows where each charge comes from", async () => {
    routes(true);
    await mount();
    await chooseClient();
    expect(screen.getByLabelText("Period from")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Period to")).toHaveValue("2026-11-14");
    expect(screen.getByText(/after INV-0418/)).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Jobs on the draft" });
    expect(within(table).getByText("Property rate")).toBeInTheDocument();
    expect(within(table).getByText('Fixed price · "late checkout agreed"')).toBeInTheDocument();
    const unratedRow = within(table).getByText("J-1077").closest("tr")!;
    expect(unratedRow).toHaveTextContent("No charge");
    expect(unratedRow).not.toHaveTextContent("$0");
    expect(within(unratedRow).getByRole("button", { name: "Set a rate" })).toBeInTheDocument();
    expect(within(unratedRow).getByRole("button", { name: "Give J-1077 a fixed price" })).toBeInTheDocument();
    expect(screen.getByText(/Left out: J-1058 \(cancelled\), J-1039 \(already on INV-0418\)\./)).toBeInTheDocument();
    const previewCall = fetcher.mock.calls.find(([url]) => String(url).includes("view=preview"));
    expect(String(previewCall![0])).toContain("from=2026-11-01");
  });

  it("blocks Create while a job has no rate, until it is left off explicitly", async () => {
    routes(true);
    await mount();
    await chooseClient();
    const create = screen.getByRole("button", { name: "Create draft" });
    expect(create).toBeDisabled();
    expect(screen.getByText("Cannot create yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Create without J-1077/ }));
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create draft" })); });
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toMatchObject({ clientId: "c1", periodStart: "2026-11-01", periodEnd: "2026-11-14", periodBasis: "SCHEDULED", gstEnabled: true, leaveOutUnratedJobIds: ["J-1077"], requestKey: expect.stringMatching(/^generate:/) });
    expect(await screen.findByText("Draft made")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open INV-0432" })).toHaveAttribute("href", "/v2/admin/finance/invoices/inv1");
    expect(screen.getByText(/Not billed: no rate — J-1077/)).toBeInTheDocument();
  });

  it("sends one request on a double click, keeps the selection after a failure and retries with the same key", async () => {
    routes(false);
    await mount();
    await chooseClient();
    createResponses.push(() => json({ error: "Some work was invoiced by another request. Refresh before generating again." }, 400));
    const button = screen.getByRole("button", { name: "Create draft" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("It was not created: Some work was invoiced by another request"));
    expect(posts()).toHaveLength(1);
    expect(screen.getByLabelText("Client")).toHaveValue("c1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse(posts()[1][1]!.body as string).requestKey).toBe(JSON.parse(posts()[0][1]!.body as string).requestKey);
  });

  it("keeps each choice's fields when switching, and refuses a credit note without the right", async () => {
    routes(false);
    await mount({ canVoidCredit: false });
    await chooseClient();
    fireEvent.click(screen.getByRole("radio", { name: /Credit note/ }));
    expect(screen.getByText(/sensitive action/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /From finished jobs/ }));
    expect(screen.getByLabelText("Client")).toHaveValue("c1");
  });

  it("docks Create draft on a phone", async () => {
    phoneMedia(true);
    routes(false);
    await mount();
    await chooseClient();
    const bar = screen.getByRole("region", { name: "New invoice actions" });
    expect(within(bar).getByRole("button", { name: "Create draft" })).toBeEnabled();
  });
});
