import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PeopleDirectory } from "@/components/v2/admin/people/people-directory";
import { TeamPanel } from "@/components/v2/admin/people/assistants/team-panel";
import type { AssistantTeam } from "@/lib/people/assistants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/v2/admin/accounts" }));

const counts = { clients: 3, cleaners: 14, office: 7, partners: 5, assistants: 2, invitationsOpen: 3, everyone: 46 };
const figures = { activeCleaners: 12, activeJobs: 4, owedApproved: 120, docsExpired: 1, docsExpiring: 2, docsPendingReview: 0, documentsRequested: 1, onboardingDonePercent: 80, kudosThisMonth: 3 };
const caps = { isAdmin: true, canWriteNotes: true, canMessageStaff: true, canSeeWorkforce: true, canViewAddresses: true };

const clientsBody = {
  rows: [
    { id: "c1", name: "Harbour View Stays", suburb: "Bondi Junction", email: null, phone: null, isActive: true, createdAt: "2024-03-01T00:00:00Z", properties: 6, logins: 2, loginsInvited: 0, assistants: 2, invoicesOpen: 3, owing: 3110, overdue: 640, overdueCount: 1, paidThisMonth: 0, lastCleanDay: "2026-11-12", attention: ["OVERDUE"] },
    { id: "c2", name: "Cronulla Sands", suburb: "Cronulla", email: null, phone: null, isActive: true, createdAt: "2024-03-01T00:00:00Z", properties: 0, logins: 0, loginsInvited: 0, assistants: 0, invoicesOpen: 0, owing: 0, overdue: 0, overdueCount: 0, paidThisMonth: 0, lastCleanDay: null, attention: ["NO_LOGIN"] },
  ],
  total: 2, page: 1, pageSize: 25, pageCount: 1, sort: "name", dir: "asc", filter: "active",
  counts: { all: 3, active: 2, inactive: 1, owing: 1, overdue: 1, "no-login": 1, assistants: 1, attention: 2 },
  figures: { totalClients: 3, activeProperties: 41, outstanding: 9860, overdue: 1240, paidThisMonth: 21470 },
  columns: { money: true },
};

const emailsBody = {
  rows: [
    { userId: "u1", name: "Lena Petrova", email: "lena@x.example", role: "CLEANER", context: null, kind: "INVITATION", sentAt: "2026-11-08T00:00:00Z", sentBy: "Hannah", sentById: "h", delivery: "NOT_RECORDED", expiresAt: "2026-11-15T00:00:00Z", expired: false, signedInAt: null, neverSignedIn: true, needsAction: true, nextStep: "RESEND_INVITATION", canResend: true, canCopyLink: true, refusal: null },
  ],
  total: 1, page: 1, pageSize: 25, pageCount: 1, sort: "sent", dir: "desc",
  kindCounts: { INVITATION: 1, ASSISTANT_ACCESS: 0, SIGNUP_CODE: 0, PASSWORD_RESET: 0, TEMPORARY_PASSWORD: 0, CLIENT_PORTAL: 0 },
  stateCounts: { all: 1, "needs-action": 1, "never-signed-in": 1, expired: 0, "not-sent": 0 },
  figures: { notAccepted: 1, expired: 0, neverSignedIn: 0, oldestNeverSignedInDays: null, passwordResets7d: 2, passwordResetsByOffice7d: 1 },
  senders: [{ id: "h", name: "Hannah" }],
  viewerRefusal: null,
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/admin/clients/directory")) return Promise.resolve(new Response(JSON.stringify(clientsBody), { status: 200 }));
    if (String(url).startsWith("/api/admin/users/account-emails")) return Promise.resolve(new Response(JSON.stringify(emailsBody), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ error: "not mocked" }), { status: 500 }));
  });
  window.history.replaceState(null, "", "/v2/admin/accounts");
});
afterEach(() => vi.unstubAllGlobals());

function renderPeople(tab: "clients" | "invitations", access = { clients: true }) {
  return render(<PeopleDirectory initialTab={tab} initialSearch={`?tab=${tab}`} access={access} capabilities={caps} counts={counts} cleanerFigures={figures} vaClients={[]} birthdays={[]} />);
}

describe("People directory", () => {
  it("draws one h1, the tabs with real counts and the summary line", async () => {
    renderPeople("clients");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("People");
    expect(screen.getByText(/3 clients · 14 cleaners · 7 office and other staff/)).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "People groups" });
    expect(within(tabs).getByRole("link", { name: "Clients 3" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Assistants 2" })).toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "Invitations 3" })).toBeInTheDocument();
    expect(await screen.findByText("Harbour View Stays")).toBeInTheDocument();
  });

  it("shows the Clients columns, overdue badge, header figures and 'Not recorded' for an unknown last clean", async () => {
    renderPeople("clients");
    await screen.findByText("Harbour View Stays");
    expect(screen.getByText("$3,110.00")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Overdue")).toBeInTheDocument();
    expect(within(table).getByText("Not recorded")).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Client figures" });
    expect(strip).toHaveTextContent("Outstanding receivables$9,860.00");
    expect(strip).toHaveTextContent("$1,240.00 overdue");
    expect(screen.getByRole("link", { name: "Export" }).getAttribute("href")).toContain("/api/admin/clients/directory?format=csv");
  });

  it("asks the server for the chip's filter and opens the bulk bar on selection", async () => {
    renderPeople("clients");
    await screen.findByText("Harbour View Stays");
    fireEvent.click(screen.getByRole("button", { name: /^Overdue 1/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("filter=overdue"))).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Harbour View Stays" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByRole("button", { name: "Send update" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Mark inactive" })).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Send portal invite" })).toHaveAttribute("href", "/v2/admin/clients/c1?tab=portal");
  });

  it("hides the Clients tab and New client from a viewer without the clients pack", () => {
    render(<PeopleDirectory initialTab="invitations" initialSearch="?tab=invitations" access={{ clients: false }} capabilities={caps} counts={counts} cleanerFigures={figures} vaClients={[]} birthdays={[]} />);
    expect(screen.queryByRole("link", { name: /^Clients/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New client" })).not.toBeInTheDocument();
  });

  it("lists account emails with honest delivery and Bounced as not recorded", async () => {
    renderPeople("invitations");
    expect(await screen.findByText("Lena Petrova")).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Account email figures" });
    expect(strip).toHaveTextContent("BouncedNot recorded");
    expect(within(screen.getByRole("table")).getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /SMS/ })).not.toBeInTheDocument();
  });

  it("keeps the error beside the page when the list cannot be read", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Could not load account emails." }), { status: 500 })));
    renderPeople("invitations");
    expect(await screen.findByText("Could not load account emails.")).toBeInTheDocument();
  });
});

const team: AssistantTeam = {
  id: "t1", name: "Front desk team", isActive: true, client: { id: "c1", name: "Harbour View Stays", propertyCount: 2 }, createdAt: "2026-07-14T00:00:00Z", createdByName: "Hannah Lee",
  permissions: { bookings: true, maintenance: true, reports: true, damage: false, invoicesView: true, messages: true, properties: false, tasksCreate: true, tasksEditOwn: true, tasksWithdrawOwn: true } as AssistantTeam["permissions"],
  grantedCount: 8, propertyIds: null, properties: [{ id: "p1", name: "Glebe House" }, { id: "p2", name: "Coogee Terrace" }],
  members: [{ id: "u1", name: "Grace Kim", email: "grace@x.example", status: "ACTIVE", invitedAt: null, inviteExpiresAt: null, lastSeenAt: null }], activity: [],
};

describe("Assistant team panel", () => {
  it("shows the never-allowed money rule and lets only an administrator edit", () => {
    const { rerender } = render(<TeamPanel team={team} canManage={false} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByText(/pay invoices/)).toBeInTheDocument();
    expect(screen.getByText(/No setting can switch them on/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Bookings/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save team" })).not.toBeInTheDocument();
    rerender(<TeamPanel team={team} canManage onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /Bookings/ })).toBeEnabled();
  });

  it("saves through the team route and keeps the draft when the save fails", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Property not found" }), { status: 400 })));
    render(<TeamPanel team={team} canManage onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Damage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save team" }));
    expect(await screen.findByText("Property not found")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/va-teams/t1", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ permissions: { damage: true }, propertyIds: [] });
    expect(screen.getByRole("checkbox", { name: /Damage/ })).toBeChecked();
  });
});
