/**
 * Delivery profiles screen (board "Delivery profiles", 2026-11-16): dashed
 * fallback chips, bounce marks, results never "delivered", auto-send shown as
 * "Not in use" and impossible to turn on, the "Changed elsewhere" choices, a
 * read-only manager, and the phone layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/v2/admin/delivery-profiles",
}));

import { DeliveryProfilesScreen } from "@/components/v2/admin/delivery-profiles/delivery-profiles-screen";
import type { DeliveryOverview } from "@/lib/commercial/delivery-model";

function overview(canEdit = true): DeliveryOverview {
  return {
    timeZone: "Australia/Sydney",
    canEdit,
    readOnlyReason: canEdit ? null : "Your access to Notifications is view only, so recipients are read only.",
    rows: [
      {
        client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au", propertyCount: 6, portalUsers: [{ name: "Olivia Grant", email: "olivia@harbourview.com.au" }] },
        profile: { reportRecipients: ["olivia@harbourview.com.au"], invoiceRecipients: [], autoSendReports: true, autoSendInvoices: true, updatedAt: "2026-11-11T00:00:00.000Z", updatedBy: { id: "u1", name: "Hannah Lee" } },
        reports: { custom: [{ email: "olivia@harbourview.com.au", source: "profile", bounce: null }], fallback: [{ email: "accounts@harbourview.com.au", source: "client_email", bounce: null }] },
        invoices: { custom: [], fallback: [{ email: "accounts@harbourview.com.au", source: "client_email", bounce: null }] },
        problems: [],
        lastSent: { at: "2026-11-12T05:02:00.000Z", subject: "Invoice INV-2049", address: "accounts@harbourview.com.au", result: "queued" },
      },
      {
        client: { id: "c2", name: "Inner West Short Stays", email: null, propertyCount: 5, portalUsers: [] },
        profile: { reportRecipients: [], invoiceRecipients: ["billing@iwss.com.au"], autoSendReports: false, autoSendInvoices: false, updatedAt: null, updatedBy: null },
        reports: { custom: [], fallback: [] },
        invoices: { custom: [{ email: "billing@iwss.com.au", source: "profile", bounce: { reason: "HARD_BOUNCE", since: null } }], fallback: [] },
        problems: ["bounce", "no_report_address"],
        lastSent: null,
      },
    ],
  };
}

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown };
function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  search = new URLSearchParams();
  replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Delivery profiles", () => {
  it("shows the fallback as a dashed chip, bounce marks, and never calls queued delivered", async () => {
    setPhone(false);
    stubFetch(() => ({ body: overview() }));
    render(<DeliveryProfilesScreen />);
    await screen.findAllByText("Harbour View Stays");
    const row = document.querySelector('[data-client-row="c1"]') as HTMLElement;
    expect(row).toHaveTextContent("fallback");
    expect(row).toHaveTextContent("Queued");
    expect(document.body).not.toHaveTextContent("Delivered");
    const bounced = document.querySelector('[data-client-row="c2"]') as HTMLElement;
    expect(bounced).toHaveTextContent("on bounce list");
    expect(bounced).toHaveTextContent("Bounced");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/"Auto-send" switches are saved but nothing reads them/)).toBeInTheDocument();
  });

  it("opens a client from ?client= with the switches Not in use and impossible to turn on", async () => {
    setPhone(false);
    search = new URLSearchParams("client=c1");
    stubFetch((url) => (url.includes("/sends") ? { body: { sends: [] } } : { body: overview() }));
    render(<DeliveryProfilesScreen />);
    const panel = await screen.findByRole("complementary", { name: "Client delivery" });
    const switches = panel.querySelectorAll('[data-auto-send="not-in-use"] input[type="checkbox"]');
    expect(switches).toHaveLength(2);
    switches.forEach((input) => expect(input).toBeDisabled());
    expect(panel).toHaveTextContent("Stored value: on.");
    expect(within(panel).getByText(/Preview: sending an invoice now goes to/)).toBeInTheDocument();
    expect(await screen.findByText(/No email to these addresses is in the sending log yet/)).toBeInTheDocument();
  });

  it("keeps a bad address in the box and Save waits; a newer save offers keep mine or load theirs", async () => {
    setPhone(false);
    search = new URLSearchParams("client=c1");
    const fetchMock = stubFetch((url, init) => {
      if (url.includes("/sends")) return { body: { sends: [] } };
      if (init?.method === "PATCH") {
        return { status: 409, body: { code: "STALE_WRITE", error: "changed", current: { reportRecipients: ["front@harbourview.com.au"], invoiceRecipients: [], autoSendReports: true, autoSendInvoices: true, updatedAt: "2026-11-16T00:12:00.000Z", updatedBy: { id: "u9", name: "Ravi Mehta" } } } };
      }
      return { body: overview() };
    });
    render(<DeliveryProfilesScreen />);
    const input = await screen.findByLabelText("Invoices go to");
    fireEvent.change(input, { target: { value: "not-an-email" } });
    expect(await screen.findByText(/is not an email address/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save Harbour View Stays" });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "accounts2@harbourview.com.au" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(await screen.findByText(/Ravi Mehta changed this/)).toBeInTheDocument();
    const body = JSON.parse(String(fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH")![1]!.body));
    expect(body).toMatchObject({ clientId: "c1", invoiceRecipients: ["accounts2@harbourview.com.au"], expectedUpdatedAt: "2026-11-11T00:00:00.000Z" });
    expect(body).not.toHaveProperty("autoSendInvoices");
    // The draft stays until a choice is made.
    expect((screen.getByLabelText("Invoices go to") as HTMLInputElement).value).toBe("accounts2@harbourview.com.au");
    fireEvent.click(screen.getByRole("button", { name: "Load theirs" }));
    expect(screen.getByText("front@harbourview.com.au")).toBeInTheDocument();
  });

  it("a view-only manager sees the panel read only", async () => {
    setPhone(false);
    search = new URLSearchParams("client=c1");
    stubFetch((url) => (url.includes("/sends") ? { body: { sends: [] } } : { body: overview(false) }));
    render(<DeliveryProfilesScreen />);
    expect(await screen.findByText(/recipients are read only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save / })).toBeNull();
    expect(screen.getByLabelText("Invoices go to")).toBeDisabled();
  });

  it("a failed load never shows a fallback row", async () => {
    setPhone(false);
    stubFetch(() => ({ status: 500, body: { error: "x" } }));
    render(<DeliveryProfilesScreen />);
    expect(await screen.findByText("Delivery profiles could not be loaded.")).toBeInTheDocument();
    expect(document.querySelector("[data-client-row]")).toBeNull();
  });

  it("on a phone the rows are cards and Export CSV docks at the bottom", async () => {
    setPhone(true);
    stubFetch(() => ({ body: overview() }));
    render(<DeliveryProfilesScreen />);
    const bar = await screen.findByRole("region", { name: "Delivery profiles actions" });
    expect(within(bar).getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Client delivery profiles" }).length).toBe(1);
  });
});
