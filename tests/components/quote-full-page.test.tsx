/**
 * Quote full page (board "Quote full page: detail and edit combined"): one
 * page, primary action from status through the existing routes, Convert to
 * job disabled until won, client add-ons accepted / dismissed through the
 * requested-addons route, a converted quote read-only with the reason, and
 * the New quote prefill selecting the client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({
  EAddressInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="Service address input" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { QuoteFullPage } from "@/components/v2/admin/quotes/full/quote-full-page";
import { QuoteBuilder } from "@/components/v2/admin/quotes/quote-builder";
import { snapshotFromRecord } from "@/lib/quotes/quote-record";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

function snapshot(status: string, extra: Record<string, unknown> = {}) {
  return snapshotFromRecord({
    id: "quote-000230",
    status,
    serviceType: "DEEP_CLEAN",
    subtotal: 480,
    gstAmount: 48,
    totalAmount: 528,
    notes: 'Deep clean.\n[[META:{"extras":[],"quoteHeading":"Oven and window deep clean","pricingSource":"rate-card"}]]',
    validUntil: "2026-11-23T12:59:59.000Z",
    createdAt: "2026-11-09T03:48:00.000Z",
    clientId: "c1",
    client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au" },
    publicToken: status === "DRAFT" ? null : "tok",
    lineItems: [{ label: "Deep clean, 2 bed 1 bath", unitPrice: 480, qty: 1, total: 480 }],
    requestedAddOns: [{ id: "r1", label: "Fridge clean inside", price: 45, requestedAt: "2026-11-10T08:12:00.000Z" }],
    ...extra,
  });
}

const options = {
  leads: [],
  clients: [{ id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au", suburb: "Coogee" }],
  services: [{ jobType: "DEEP_CLEAN", label: "Deep clean", model: "HOURLY" as const, itemLabel: null, unitLabel: null, bands: [] }],
  gstEnabled: true,
  pricingVariables: [],
};

function renderPage(status: string, extra: Record<string, unknown> = {}) {
  return render(<QuoteFullPage initial={snapshot(status, extra)} builderOptions={options} marginModel={{ costShare: 0.55, floorPercent: 40 }} timezone="Australia/Sydney" fromCase={null} />);
}

beforeEach(() => {
  calls = [];
  push.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (data: unknown, ok = true) => ({ ok, json: async () => data, blob: async () => new Blob() });
      if (url.startsWith("/api/admin/checklists")) return json({ checklist: null });
      if (url.startsWith("/api/admin/properties")) return json([]);
      if (url.startsWith("/api/admin/quotes/quote-000230/events")) return json({ events: [] });
      if (url.includes("/requested-addons")) return json({ ok: true, requestedAddOns: [], totalAmount: 577.5 });
      if (url === "/api/admin/quotes/quote-000230" && method === "PATCH") return json({ id: "quote-000230" });
      if (url === "/api/admin/quotes/quote-000230") return json({ id: "quote-000230", status: "ACCEPTED", serviceType: "DEEP_CLEAN", lineItems: [], clientId: "c1", client: { id: "c1", name: "Harbour View Stays", email: "a@x" } });
      return json({});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Quote full page", () => {
  it("shows one heading, the stage strip and the status primary action", async () => {
    renderPage("SENT");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Oven and window deep clean.*Sent/);
    expect(screen.getByRole("list", { name: "Quote progress" }).textContent).toMatch(/2 Sent to client/);
    expect(screen.getAllByRole("button", { name: "Resend" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Mark won" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && JSON.stringify(c.body) === JSON.stringify({ status: "ACCEPTED" }))).toBe(true));
  });

  it("keeps Convert to job disabled until the quote is won", () => {
    renderPage("SENT");
    const convert = screen.getByRole("region", { name: "Convert to job" });
    expect(within(convert).getByRole("button", { name: "Convert to job" }).hasAttribute("disabled")).toBe(true);
    expect(convert.textContent).toMatch(/Available once won or accepted/);
    cleanup();
    renderPage("ACCEPTED");
    const ready = screen.getByRole("region", { name: "Convert to job" });
    expect(within(ready).getByRole("button", { name: "Convert to job" }).hasAttribute("disabled")).toBe(false);
  });

  it("offers Review and send on a draft", () => {
    renderPage("DRAFT");
    expect(screen.getByRole("button", { name: "Review and send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("adds or dismisses a client-requested add-on through the existing route", async () => {
    renderPage("SENT");
    const card = screen.getByRole("region", { name: "Client requested add-ons" });
    fireEvent.click(within(card).getByRole("button", { name: "Add to quote" }));
    await waitFor(() => expect(calls.find((c) => c.url.includes("requested-addons"))?.body).toEqual({ action: "accept", items: [{ id: "r1", label: "Fridge clean inside", price: 45 }] }));
  });

  it("dismisses a request", async () => {
    renderPage("SENT");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Fridge clean inside" }));
    await waitFor(() => expect(calls.find((c) => c.url.includes("requested-addons"))?.body).toEqual({ action: "dismiss", items: [{ id: "r1", label: "Fridge clean inside" }] }));
  });

  it("makes a converted quote read-only with the reason and opens its job", () => {
    renderPage("CONVERTED", { convertedJobId: "job-1066" });
    expect(screen.getByText(/converted to a job, so its service, pricing and presentation can no longer be edited/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open job" }).getAttribute("href")).toBe("/v2/admin/jobs/job-1066");
    const builder = screen.getByRole("region", { name: "Quote builder" });
    expect((builder.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });
});

describe("New quote on the full page", () => {
  it("preselects the prefilled client and offers Create draft / Create and send", () => {
    render(<QuoteBuilder {...options} recipientPrefill={{ clientId: "c1" }} />);
    expect((screen.getByLabelText("Client") as HTMLSelectElement).value).toBe("c1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/New quote/);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create and send" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Convert to job" }).textContent).toMatch(/once the quote is created/);
  });
});
