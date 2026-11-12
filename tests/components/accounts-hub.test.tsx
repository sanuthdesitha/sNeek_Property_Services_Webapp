import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AccountsHub } from "@/components/v2/admin/accounts/hub/accounts-hub";
import { readAccountsView } from "@/components/v2/admin/accounts/hub/accounts-view";

const listBody = (columns: { pay: boolean; quality: boolean }) => ({
  rows: [
    {
      id: "u1", name: "Jane Cleaner", email: "jane@example.com", phone: null, role: "CLEANER", extraRoles: ["QA_INSPECTOR"], status: "ACTIVE", inviteAgeDays: null,
      emailVerified: true, twoFactorEnabled: true, clientName: null, documents: { kind: "OK", label: "Up to date" }, lastSeenAt: null, attention: [],
      ...(columns.pay ? { rate: 36.5 } : {}), ...(columns.quality ? { jobs30: 31, qa30: null } : {}),
    },
  ],
  total: 1, page: 1, pageSize: 25, pageCount: 1, sort: "name", dir: "asc", tab: "office",
  counts: { everyone: 31, cleaners: 14, office: 5, clients: 8, assistants: 2, partners: 2, attention: 3 },
  summary: { people: 31, invitesPending: 2, documentsExpiring: 1, documentsExpired: 0 },
  columns,
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/v2/admin/accounts?tab=team");
});
afterEach(() => vi.unstubAllGlobals());

function respond(columns: { pay: boolean; quality: boolean }) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(listBody(columns)), { status: 200 })));
}

describe("Accounts hub", () => {
  it("opens an old ?tab=team link on Office and shows real counts and the summary line", async () => {
    respond({ pay: true, quality: true });
    render(<AccountsHub initialView={readAccountsView("?tab=team")} capabilities={{ isAdmin: true, canWriteNotes: true }} birthdays={[]} vaClients={[]} />);
    expect(await screen.findByText("31 people · 2 invites not accepted · 1 document expiring")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Office and other staff 5" })).toHaveAttribute("aria-current", "page");
    expect(String(fetchMock.mock.calls[0][0])).toContain("tab=office");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("$36.50")).toBeInTheDocument();
    // A missing QA figure is a dash, never 0.
    expect(within(screen.getByRole("table")).getAllByText("–").length).toBeGreaterThan(0);
  });

  it("gives an operations manager no Invite person and only the bulk action they can use", async () => {
    respond({ pay: true, quality: false });
    render(<AccountsHub initialView={readAccountsView("")} capabilities={{ isAdmin: false, canWriteNotes: true }} birthdays={[]} vaClients={[]} />);
    await screen.findByText("Jane Cleaner");
    expect(screen.queryByRole("button", { name: "Invite person" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /QA, 30 d/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Jane Cleaner" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByRole("button", { name: "Resend invitation" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Change rate" })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("exports the current view", async () => {
    respond({ pay: true, quality: true });
    render(<AccountsHub initialView={readAccountsView("?tab=cleaners&status=active")} capabilities={{ isAdmin: true, canWriteNotes: true }} birthdays={[]} vaClients={[]} />);
    const link = await screen.findByRole("link", { name: "Export" });
    expect(link.getAttribute("href")).toContain("/api/admin/users/export?");
    expect(link.getAttribute("href")).toContain("tab=cleaners");
    expect(link.getAttribute("href")).toContain("status=active");
  });
});

describe("Accounts KPI strip (restored, parity audit 2026-11-12)", () => {
  it("shows Total staff, Active cleaners and Total clients, and no receivables", async () => {
    respond({ pay: true, quality: true });
    render(<AccountsHub initialView={readAccountsView("")} capabilities={{ isAdmin: true, canWriteNotes: true }} birthdays={[]} vaClients={[]} kpis={{ totalStaff: 18, activeCleaners: 12, totalClients: 9 }} />);
    const strip = screen.getByRole("region", { name: "Account figures" });
    expect(strip).toHaveTextContent("Total staff18");
    expect(strip).toHaveTextContent("Active cleaners12");
    expect(strip).toHaveTextContent("Total clients9");
    expect(screen.queryByText(/receivables/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows a count that could not be read as a dash, never 0", async () => {
    respond({ pay: true, quality: true });
    render(<AccountsHub initialView={readAccountsView("")} capabilities={{ isAdmin: true, canWriteNotes: true }} birthdays={[]} vaClients={[]} kpis={{ totalStaff: 18, activeCleaners: null, totalClients: 9 }} />);
    const strip = screen.getByRole("region", { name: "Account figures" });
    expect(strip).toHaveTextContent("Active cleaners–");
    expect(within(strip).getByRole("status")).toHaveTextContent("could not be read");
  });
});
