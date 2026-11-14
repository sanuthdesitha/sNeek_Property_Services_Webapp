import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), phone: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn() }), usePathname: () => "/v2/admin/hiring", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/v2/ui/use-phone", () => ({ useIsPhone: () => nav.phone }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({
  EAddressInput: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => <input aria-label="Billing address" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { InvitePersonPage } from "@/components/v2/admin/accounts/invite/invite-person-page";
import { StageMoveFlow } from "@/components/v2/admin/hiring/stage-move";
import { HiringPipeline } from "@/components/v2/admin/hiring/pipeline/hiring-pipeline";
import { NewClientForm } from "@/components/v2/admin/clients/new-client-form";
import type { HubCard } from "@/lib/hiring/hub-data";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  nav.push.mockReset();
  nav.refresh.mockReset();
  nav.phone = false;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const inviteProps = {
  initialKind: "CLEANER" as const,
  clients: [{ id: "c1", name: "Harbour View Stays" }],
  partners: [],
  opsAreas: [{ key: "jobs", label: "Jobs & assignments" }, { key: "finance", label: "Finance & invoicing" }],
  smsReady: true,
  timeZone: "Australia/Sydney",
  prefill: null,
};

describe("Invite person page", () => {
  it("starts with role cards, SMS unticked, and posts the one create request without SMS", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/users/email-check")) return json({ checked: true, inUse: false });
      return json({ outcome: { user: { id: "u1", name: "Rosa Martinez", email: "rosa@example.invalid", role: "CLEANER" }, replayed: false, signIn: "INVITATION", invitation: { expiresAt: "2026-11-21T00:00:00Z" }, email: { state: "ACCEPTED", error: null }, sms: { state: "NOT_REQUESTED", error: null } } }, 201);
    });
    render(<InvitePersonPage {...inviteProps} />);
    expect(screen.getByRole("heading", { level: 1, name: "Invite person" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Cleaner/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rosa Martinez" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: "rosa@example.invalid" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "0438112905" } });
    const sms = screen.getByRole("checkbox", { name: /SMS with the link/ });
    expect(sms).not.toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "Create and invite" })[0]);
    await waitFor(() => expect(screen.getByText(/queued with the email provider/)).toBeInTheDocument());
    const create = fetchMock.mock.calls.find(([url]) => url === "/api/admin/users");
    expect(JSON.parse(create![1].body)).toMatchObject({ role: "CLEANER", invite: true, sendSms: false, idempotencyKey: expect.any(String) });
    expect(screen.getByText("Email queued")).toBeInTheDocument();
  });

  it("an ops manager shows packs with nothing ticked; SMS needs a phone", () => {
    render(<InvitePersonPage {...inviteProps} initialKind="OPS_MANAGER" />);
    const packs = screen.getByRole("heading", { name: /Starting permission packs/ }).closest("section")!;
    for (const box of within(packs).getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /SMS with the link/ })).toBeDisabled();
    expect(screen.getByText("Add a phone number to send the link by SMS.")).toBeInTheDocument();
  });

  it("an email already in use refuses with the reason and a link to the account", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/users/email-check")) return json({ checked: true, inUse: false });
      return json({ error: "rosa@example.invalid already has an account (Cleaner, deactivated). Open that account to reactivate it instead.", code: "EMAIL_IN_USE", existing: { id: "old" } }, 409);
    });
    render(<InvitePersonPage {...inviteProps} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Rosa" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: "rosa@example.invalid" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create and invite" })[0]);
    await waitFor(() => expect(screen.getByText("Email already used")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open that account" })).toHaveAttribute("href", "/v2/admin/accounts/users/old");
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Rosa");
  });
});

describe("stage moves never send silently", () => {
  it("moving to Interview opens the email preview; Move without email moves only", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/email")) return json({ subject: "Interview", html: "<p>Hi</p>", to: "g@example.invalid" });
      if (url.endsWith("/stage")) return json({ id: "a1", from: "SCREENING", to: "INTERVIEW", body: init?.body });
      return json({});
    });
    const finished = vi.fn();
    render(<StageMoveFlow move={{ applicationId: "a1", name: "Grace Liu", from: "SCREENING", to: "INTERVIEW" }} onFinished={finished} onMessage={vi.fn()} />);
    await screen.findByRole("button", { name: "Move without email" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/stage"))).toBe(false);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/email") && !JSON.parse(String((init as RequestInit).body)).preview)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Move without email" }));
    await waitFor(() => expect(finished).toHaveBeenCalledWith(true));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stage"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/email") && !JSON.parse(String((init as RequestInit).body)).preview)).toHaveLength(0);
  });

  it("moving to Hired opens the account step instead", () => {
    const finished = vi.fn();
    render(<StageMoveFlow move={{ applicationId: "a9", name: "Noah", from: "OFFER", to: "HIRED" }} onFinished={finished} onMessage={vi.fn()} />);
    expect(nav.push).toHaveBeenCalledWith("/v2/admin/hiring/applications/a9?hire=1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const card = (id: string, status: string, name: string): HubCard => ({
  id, name, email: `${id}@example.invalid`, phone: null, status, positionId: "p1", positionTitle: "Estate Cleaner",
  subtitle: "Estate Cleaner · 2 d ago", tone: status === "INTERVIEW" ? "info" : null, pill: status === "INTERVIEW" ? "Booked" : null,
  test: { text: "Test 84%", tone: "ok" }, detail: "", testScore: 84, testPassed: true, testDone: true,
});

describe("Hiring board", () => {
  const props = {
    cards: [card("a1", "NEW", "Grace Liu"), card("a2", "INTERVIEW", "Ben O'Neill")],
    roles: [{ id: "p1", title: "Estate Cleaner", slug: "estate-cleaner", subtitle: "Casual", isPublished: true, applications: 2, open: 2, test: "On · pass 70% · 12 questions", hiresBecome: "Cleaner accounts", hiresBecomeSet: true }],
    figures: [
      { label: "Open roles", value: "1", note: "accepting" },
      { label: "In the pipeline", value: "2", note: "across 1 role" },
      { label: "Need a first look", value: "1", note: "oldest 2 d" },
      { label: "Interviews this week", value: "1", note: "next Thu" },
      { label: "Hired, 90 days", value: "0", note: "0 still onboarding" },
    ],
    closedCounts: { rejected: 0, withdrawn: 0 },
    capped: false,
    careersUrl: "https://app.example.invalid/v2/careers",
  };

  it("has five stage columns, a keyboard Move to… menu per card, and the roles table with Hires become", () => {
    render(<HiringPipeline {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Hiring" })).toBeInTheDocument();
    for (const stage of ["New", "Screening", "Interview", "Offer", "Hired"]) expect(screen.getByRole("heading", { level: 2, name: new RegExp(`^${stage}`) })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Move Grace Liu" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "Hires become" })).toBeInTheDocument();
    expect(screen.getAllByText("Cleaner accounts").length).toBeGreaterThan(0);
  });

  it("on a phone shows one stage at a time behind a stage chip row", () => {
    nav.phone = true;
    render(<HiringPipeline {...props} />);
    const chips = screen.getByRole("group", { name: "Stage" });
    expect(within(chips).getByRole("button", { name: /Interview/ })).toBeInTheDocument();
  });
});

describe("Add client", () => {
  it("validates at the field and in the summary, and warns about a similar client without blocking", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/clients/duplicates")) return json({ matches: [{ id: "c9", name: "Seaside Stays", sentence: "Seaside Stays, 2 properties, same email domain." }] });
      return json({ id: "new", name: "Seaside Hosting", login: null }, 201);
    });
    render(<NewClientForm defaultTermsDays={14} canEditTerms xeroConnected={false} loginRefusal={null} />);
    fireEvent.change(screen.getByLabelText(/^Client name/), { target: { value: "Seaside Hosting" } });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    expect((await screen.findAllByText("A portal login needs an email. Add one, or switch the login off.")).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/clients")).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "priya@seasidehosting.com.au" } });
    await screen.findByText(/Seaside Stays, 2 properties, same email domain/, undefined, { timeout: 2000 });
    expect(screen.getByRole("combobox", { name: /Xero contact/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    await screen.findByText("Added");
    const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/admin/clients")![1].body);
    expect(body).toMatchObject({ sendPortalInvite: true, notifications: { jobUpdates: true, enRoute: true, startFinish: true, liveLocation: false }, idempotencyKey: expect.any(String) });
  });
});
