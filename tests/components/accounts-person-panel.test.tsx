import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { ContactSection } from "@/components/v2/admin/accounts/person/contact-access-sections";
import { PersonPanel } from "@/components/v2/admin/accounts/person/person-panel";
import { PersonTabsView } from "@/components/v2/admin/accounts/person/person-view";
import { PersonActions } from "@/components/v2/admin/accounts/person/person-actions";

const ADMIN: PersonCapabilities = { isAdmin: true, canWriteNotes: true, canUploadDocuments: true, canResendInvite: true };
const OPS: PersonCapabilities = { isAdmin: false, canWriteNotes: true, canUploadDocuments: false, canResendInvite: true };

function profile(overrides: Partial<PersonProfile> = {}): PersonProfile {
  return {
    id: "p1", name: "Jane Cleaner", email: "jane@example.com", emailVerified: "2025-03-01T00:00:00.000Z", phone: "0400000002", image: null,
    role: "CLEANER", roleLabel: "Cleaner", isActive: true, status: "ACTIVE", inviteAgeDays: null, invitationExpiresAt: null,
    twoFactorEnabled: true, profileEditingEnabled: true, profileEditOverride: null, roleEditDefault: null,
    createdAt: "2025-03-01T00:00:00.000Z", hireDate: null, employmentType: null, birthday: null, lastSeenAt: null, availability: "Fixed · 3 weekly days",
    location: { suburb: "Bondi Junction", state: "NSW", postcode: null, address: null }, client: null, hourlyRate: 36.5,
    extraRoles: [], ownNotes: null, adminNotes: "Prefers eastern suburbs.",
    payroll: { editable: { businessName: null, abn: null, address: null, contactNumber: null, jobTitle: null, department: null, baseLocation: null, bankDetails: null },
      display: { businessName: null, abn: null, fullAddress: null, bankLine: null, profileBankLine: null, payoutMethod: null, department: null, baseLocation: null, jobTitle: null, emergencyContact: null } },
    credentials: [], documents: [], missingDocuments: [],
    summary: { userId: "p1", jobsCompletedTotal: 3, jobsCompletedThisMonth: 1, assignmentsTotal: 3, hoursLoggedTotal: 6, hoursLoggedThisMonth: 2, approvedPayTotal: 0, approvedPayCount: 0,
      pendingPayAdjustments: 0, pendingTimeAdjustments: 0, estimatedEarnings: null, documentsCurrent: 0, documentsExpired: 0, documentsTotal: 0, recognitionCount: 0,
      recentJobs: [], recentPayAdjustments: [], recentRecognitions: [], jobsTrend: [] },
    figures: { jobs30: 31, reviewed30: 10, qa30: 94 }, performance: null, isFieldRole: true, vaAccess: null, testable: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("a section edited in place", () => {
  it("keeps the draft and shows the server's message when the save fails", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ error: "Email is already in use." }, 409));
    const onChanged = vi.fn();
    render(<ContactSection profile={profile()} caps={ADMIN} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "taken@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email is already in use.");
    expect(screen.getByLabelText("Email")).toHaveValue("taken@example.com");
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("freezes the fields while saving", async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    render(<ContactSection profile={profile()} caps={ADMIN} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    await act(async () => resolve(new Response("{}", { status: 200 })));
  });
});

describe("the person panel", () => {
  it("never fills one person's panel with a late answer for another", async () => {
    const pending = new Map<string, (value: Response) => void>();
    fetchMock.mockImplementation((url: string) => {
      const id = decodeURIComponent(String(url).split("/api/admin/users/")[1] ?? "");
      return new Promise<Response>((resolve) => pending.set(id, resolve));
    });
    const { rerender } = render(<PersonPanel userId="a" onClose={vi.fn()} onListChanged={vi.fn()} />);
    rerender(<PersonPanel userId="b" onClose={vi.fn()} onListChanged={vi.fn()} />);
    await act(async () => pending.get("b")?.(new Response(JSON.stringify({ profile: profile({ id: "b", name: "Bea" }), capabilities: ADMIN }), { status: 200 })));
    await act(async () => pending.get("a")?.(new Response(JSON.stringify({ profile: profile({ id: "a", name: "Aiko" }), capabilities: ADMIN }), { status: 200 })));
    expect(await screen.findByRole("heading", { level: 2, name: /Bea/ })).toBeInTheDocument();
    expect(screen.queryByText("Aiko")).not.toBeInTheDocument();
  });

  it("shows an operations manager only the controls their role can use", () => {
    render(<PersonTabsView profile={profile()} caps={OPS} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit pay" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit office notes, private" })).toBeInTheDocument();
  });

  it("gives an operations manager no Test as and no admin-only menu items", () => {
    const { container } = render(<PersonActions profile={profile({ emailVerified: null })} caps={OPS} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "Test as" })).not.toBeInTheDocument();
    fireEvent.click(within(container).getByRole("button", { name: /More actions/ }));
    expect(screen.getByRole("menuitem", { name: "Resend invite" })).toBeInTheDocument();
    for (const name of ["Reset password", "Reset 2FA", "Disable", "Delete"]) expect(screen.queryByRole("menuitem", { name })).not.toBeInTheDocument();
  });

  it("gives an admin Test as and every action", () => {
    const { container } = render(<PersonActions profile={profile()} caps={ADMIN} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Test as" })).toHaveAttribute("href", "/v2/admin/system/test-as?user=p1");
    fireEvent.click(within(container).getByRole("button", { name: /More actions/ }));
    for (const name of ["Reset password", "Reset 2FA", "Disable", "Delete"]) expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
  });

  it("sends the viewer's own PIN with Reset 2FA so the server can verify it", async () => {
    // The prompt first reads the viewer's own PIN state (2026-11-13: own PINs).
    fetchMock.mockImplementation((url: string) => jsonResponse(url === "/api/me/admin-pin" ? { hasPin: true, lockedUntil: null, userId: "admin-1" } : { ok: true }));
    const { container } = render(<PersonActions profile={profile()} caps={ADMIN} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(within(container).getByRole("button", { name: /More actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/users/p1/disable-2fa")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/admin/users/p1/disable-2fa")!;
    expect(JSON.parse(String(init.body)).security).toEqual({ pin: "1234" });
  });

  it("asks a viewer with no PIN yet for their password and a new PIN, and sends them together", async () => {
    fetchMock.mockImplementation((url: string) => jsonResponse(url === "/api/me/admin-pin" ? { hasPin: false, lockedUntil: null, userId: "admin-1" } : { ok: true }));
    const { container } = render(<PersonActions profile={profile()} caps={ADMIN} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(within(container).getByRole("button", { name: /More actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/You have no PIN yet/);
    const confirm = within(dialog).getByRole("button", { name: "Reset 2FA" });
    fireEvent.change(within(dialog).getByLabelText("Account password"), { target: { value: "secret-pass" } });
    fireEvent.change(within(dialog).getByLabelText("Choose your PIN"), { target: { value: "4826" } });
    fireEvent.change(within(dialog).getByLabelText("Confirm your PIN"), { target: { value: "4827" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Confirm your PIN"), { target: { value: "4826" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/users/p1/disable-2fa")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/admin/users/p1/disable-2fa")!;
    expect(JSON.parse(String(init.body)).security).toEqual({ password: "secret-pass", newPin: "4826" });
  });

  it("offers an administrator Reset PIN only on an administrator or operations manager, sent with the viewer's own PIN", async () => {
    fetchMock.mockImplementation((url: string) => jsonResponse(url === "/api/me/admin-pin" ? { hasPin: true, lockedUntil: null, userId: "admin-1" } : { ok: true }));
    const view = render(<PersonActions profile={profile()} caps={ADMIN} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(within(view.container).getByRole("button", { name: /More actions/ }));
    expect(screen.queryByRole("menuitem", { name: "Reset PIN" })).not.toBeInTheDocument();
    view.unmount();
    const ops = render(<PersonActions profile={{ ...profile(), role: "OPS_MANAGER" } as never} caps={ADMIN} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(within(ops.container).getByRole("button", { name: /More actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset PIN" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/never see or choose their PIN/);
    fireEvent.change(within(dialog).getByLabelText("Your PIN"), { target: { value: "1357" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset PIN" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/users/p1/reset-pin")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/admin/users/p1/reset-pin")!;
    expect(JSON.parse(String(init.body)).security).toEqual({ pin: "1357" });
  });

  it("gives a client login a profile without pay or staff roles", () => {
    render(
      <PersonTabsView
        profile={profile({ role: "CLIENT", roleLabel: "Client", client: { id: "c1", name: "Harbour Co" }, hourlyRate: null, figures: null, isFieldRole: false, testable: true })}
        caps={ADMIN}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Harbour Co")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Contact" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pay" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Also works as/i)).not.toBeInTheDocument();
  });
});
