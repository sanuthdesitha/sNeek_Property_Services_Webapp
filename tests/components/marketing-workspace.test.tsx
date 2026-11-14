import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ phone: false }));
vi.mock("@/components/v2/ui/use-phone", () => ({ useIsPhone: () => env.phone }));
vi.mock("@/components/v2/admin/marketing/email-block-editor", () => ({ EmailBlockEditor: () => <div>Blocks</div>, EmailPreview: () => <div>Preview</div> }));

import { EmailCampaignsManager } from "@/components/v2/admin/marketing/email-campaigns-manager";
import { AssetLibrary } from "@/components/v2/admin/marketing/asset-library";
import type { EmailCampaignRow } from "@/lib/marketing/workspace-types";

const fetchMock = vi.fn();
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const segments = [
  { id: "all_active_clients", label: "All active clients", description: "", count: 284 },
  { id: "clients_with_job_last_90d", label: "Serviced", description: "", count: 211 },
  { id: "dormant_90d", label: "Dormant", description: "", count: 37 },
  { id: "airbnb_property_clients", label: "Airbnb", description: "", count: 168 },
  { id: "clients_with_active_recurring", label: "Recurring", description: "", count: 64 },
  { id: "leads_only", label: "Leads", description: "", count: 52 },
];
const base: EmailCampaignRow = {
  id: "draft-1", name: "December turnover dates", subject: "Lock in your Christmas turnovers", htmlBody: "", audience: { type: "segment", filters: { segmentId: "airbnb_property_clients" } },
  status: "draft", scheduledAt: null, sentAt: null, recipientCount: null, createdAt: "2026-11-14T00:00:00Z", updatedAt: "2026-11-13T23:20:00Z", sends: { sent: 0, failed: 0, skipped: 0 }, report: null,
};
const failedRow: EmailCampaignRow = { ...base, id: "failed-1", name: "Linen hire launch", status: "failed", sends: { sent: 58, failed: 6, skipped: 2 }, report: null };
const sentRow: EmailCampaignRow = { ...base, id: "sent-1", name: "Summer turnover offer", status: "sent", sentAt: "2026-11-03T22:02:00Z", sends: { sent: 286, failed: 0, skipped: 0 }, report: { delivered: 279, opened: 141, clicked: 38, bounced: 4 } };

beforeEach(() => {
  env.phone = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/v2/admin/marketing");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes(reach: unknown, reachStatus = 200) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("segments")) return ok({ segments });
    if (url.includes("/reach")) return ok(reach, reachStatus);
    if (url.endsWith("/retry")) return ok({ sent: 6, failed: 0, suppressed: 0, retried: 6 });
    return ok({ campaign: { ...base, status: "scheduled" } });
  });
}

describe("email campaigns", () => {
  it("shows figures honestly: 'not recorded' until the service reports, a banded partly failed row with Retry the N", async () => {
    routes({ reach: { withEmail: 1, willSend: 1, unsubscribed: 0, bounceList: 0, noEmail: 0 } });
    render(<EmailCampaignsManager initialCampaigns={[base, failedRow, sentRow]} onToast={vi.fn()} brand={{ companyName: "sNeek", logoUrl: "" }} />);
    const table = screen.getByRole("region", { name: "Email campaigns" });
    expect(within(table).getAllByText("not recorded")).toHaveLength(4);
    expect(within(table).getByText("279")).toBeInTheDocument();
    expect(within(table).getByText("Partly failed")).toBeInTheDocument();
    expect(within(table).getByText("58 sent, 6 failed")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Retry the 6" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Only those 6 people/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry the 6" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/admin/email-campaigns/failed-1/retry" && init?.method === "POST")).toBe(true));
  });

  it("shows audience counts beside each option and skipped addresses before scheduling; tier A states the count", async () => {
    routes({ reach: { withEmail: 168, willSend: 161, unsubscribed: 5, bounceList: 2, noEmail: 3 } });
    render(<EmailCampaignsManager initialCampaigns={[base]} onToast={vi.fn()} brand={{ companyName: "sNeek", logoUrl: "" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "December turnover dates" })[0]!);
    const who = screen.getByRole("region", { name: "Who gets it" });
    expect(await within(who).findByText("284")).toBeInTheDocument();
    expect(within(who).getByText("168")).toBeInTheDocument();
    expect(within(who).getByRole("radio", { name: /Airbnb and short-stay hosts/ })).toBeChecked();
    expect(await within(who).findByText("161")).toBeInTheDocument();
    expect(within(who).getByText("Unsubscribed, skipped").nextSibling).toHaveTextContent("5");
    expect(within(who).getByText("On bounce list, skipped").nextSibling).toHaveTextContent("2");
    expect(within(who).getByText("No email address, skipped").nextSibling).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("radio", { name: "Schedule" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2099-11-17" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:00" } });
    expect(screen.getByText(/leaves between 09:00 and 09:05/)).toBeInTheDocument();
    expect(screen.getByText(/Goes to 161 people by email only. No SMS, no app alerts./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Schedule for / }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/goes to 161 Airbnb and short-stay hosts by email/);
    expect(dialog).toHaveTextContent(/10 addresses are skipped/);
    expect(fetchMock.mock.calls.some(([url, init]) => url.startsWith("/api/admin/email-campaigns/draft-1") && init?.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: /^Schedule for / }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/admin/email-campaigns/draft-1" && init?.method === "PATCH")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, init]) => url === "/api/admin/email-campaigns/draft-1" && init?.method === "PATCH")!;
    expect(JSON.parse(init.body)).toMatchObject({ status: "scheduled", scheduledAt: "2099-11-16T22:00:00.000Z", audience: { type: "segment", filters: { segmentId: "airbnb_property_clients" } } });
  });

  it("when the count fails, scheduling waits: 'Count not available'", async () => {
    routes({ error: "x" }, 500);
    render(<EmailCampaignsManager initialCampaigns={[base]} onToast={vi.fn()} brand={{ companyName: "sNeek", logoUrl: "" }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "December turnover dates" })[0]!);
    expect(await screen.findByText("Count not available. Scheduling waits until it loads.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Send now" }));
    expect(screen.getByRole("button", { name: "Send now" })).toBeDisabled();
  });

  it("on a phone the list becomes cards and New email campaign docks at the bottom", () => {
    env.phone = true;
    routes({ reach: { withEmail: 0, willSend: 0, unsubscribed: 0, bounceList: 0, noEmail: 0 } });
    render(<EmailCampaignsManager initialCampaigns={[base, failedRow]} onToast={vi.fn()} brand={{ companyName: "sNeek", logoUrl: "" }} />);
    expect(screen.getByRole("list", { name: "Email campaigns" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Campaign actions" })).getByRole("button", { name: "New email campaign" })).toBeInTheDocument();
  });
});

describe("images", () => {
  it("shows where an image is used before it is removed", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/usage") ? ok({ status: "known", uses: [{ kind: "email_campaign", label: "Email campaign: Summer offer", href: "/x" }, { kind: "website", label: "Website pages", href: "/v2/admin/website" }] }) : ok({ ok: true })
    );
    render(<AssetLibrary initialAssets={[{ id: "a1", name: "bondi.jpg", url: "https://example.invalid/bondi.jpg", mediaType: "IMAGE", createdAt: "2026-11-01T00:00:00Z" }]} onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveTextContent("It is used in: Email campaign: Summer offer; Website pages."));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from library" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/admin/marketing/assets/a1" && init?.method === "DELETE")).toBe(true));
  });
});
