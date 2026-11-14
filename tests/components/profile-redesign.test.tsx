/**
 * Your profile (board "Your profile", 2026-11-16): one page of cards on
 * desktop, a section list on a phone where each section opens on its own,
 * the two-step requirement notice, the passkey card for office accounts
 * (listed even where this browser cannot add one), the sessions card with an
 * unrecorded sign-in, and every change refused while testing as someone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/v2/admin/profile",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => false,
  platformAuthenticatorIsAvailable: async () => false,
  startRegistration: vi.fn(),
  WebAuthnError: class extends Error {},
}));

import { ProfileWorkspace, type ProfileWorkspaceProps } from "@/components/v2/admin/profile/profile-workspace";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function respond(overrides: Record<string, unknown> = {}) {
  m.fetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path in overrides) return ok(overrides[path]);
    if (path === "/api/auth/2fa/settings") return ok({ enabled: false, method: null, backupCodesRemaining: 0, hasPassword: true, email: "hannah@x", requirement: { kind: "grace", deadline: "2026-11-28T00:00:00.000Z" } });
    if (path === "/api/me/admin-pin") return ok({ hasPin: true, updatedAt: "2026-10-03T03:10:00Z", lockedUntil: null, resetByAdministrator: false });
    if (path === "/api/auth/webauthn/credentials") return ok({ devices: [{ id: "pk1", deviceName: "MacBook Air · Touch ID", deviceType: "singleDevice", backedUp: false, createdAt: "2026-11-02T00:00:00Z", lastUsedAt: "2026-11-16T07:58:00Z" }] });
    if (path === "/api/me/notification-preferences") return ok({ impersonating: false, preferences: { jobs: { web: true, email: false, sms: false }, cases: { web: true, email: true, sms: false } }, hasPhone: false, phone: null });
    if (path === "/api/me/send-transports") return ok({ impersonating: false, readable: true, kinds: { document_request: { transports: ["INBOX", "EMAIL"], savedAt: "2026-11-09T00:00:00Z" } } });
    if (path === "/api/me/sessions") return ok({ impersonating: false, sessions: [{ id: "s2", device: null, deviceKind: "unknown", method: "PASSWORD", signedInAt: "2026-11-07T00:00:00Z", lastActiveAt: "2026-11-16T00:00:00Z", current: false }], currentUnrecorded: true, olderSignInsMayExist: true, sessionsValidFrom: null });
    return ok({ error: `unexpected ${path}` }, 404);
  });
}

const props = (overrides: Partial<ProfileWorkspaceProps> = {}): ProfileWorkspaceProps => ({
  details: { name: "Hannah Lee", email: "hannah@x", phone: "0412555204", address: "12 Ocean St", suburb: "Bondi", state: "NSW", postcode: "2026" },
  theme: "SYSTEM",
  density: "DEFAULT",
  passwordChanged: "3 Oct 2026",
  timeZone: "Australia/Sydney",
  categories: [{ key: "jobs", label: "Jobs & scheduling", description: "Offers" }, { key: "cases", label: "Cases & issues", description: "Damage" }],
  sendingKindLabels: { document_request: "Request document and expiring-document reminders" },
  summaries: { details: "Bondi · 0412555204", look: "Match system", password: "changed 3 Oct 2026", "own-pin": "Set", "two-step": "Off", passkeys: "1", sessions: "1", notifications: "10 kinds", sending: "1 saved" },
  testingAsName: null,
  twoStepPrompted: false,
  ...overrides,
});

beforeEach(() => {
  m.fetch.mockReset();
  vi.stubGlobal("fetch", m.fetch);
  respond();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Your profile on desktop", () => {
  beforeEach(() => setPhone(false));

  it("shows every card, the two-step requirement with its deadline, and the passkey list", async () => {
    render(<ProfileWorkspace {...props()} />);
    for (const title of ["Details", "Look and feel", "Password", "Two-step sign-in", "Passkeys and devices", "Notifications to you", "Your sending choices", "Signed-in sessions"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(await screen.findByText("Required for administrators")).toBeInTheDocument();
    expect(screen.getByText(/Turn it on by/)).toBeInTheDocument();
    expect(await screen.findByText("MacBook Air · Touch ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add this device/ })).toBeDisabled();
    expect(screen.getByText(/cannot be added here/)).toBeInTheDocument();
  });

  it("an unrecorded current sign-in is named, and Sign out everywhere else waits for a recorded one", async () => {
    render(<ProfileWorkspace {...props()} />);
    expect(await screen.findByText("This browser, device not recorded")).toBeInTheDocument();
    expect(screen.getByText("Browser, device not recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out everywhere else…" })).toBeDisabled();
  });

  it("SMS stays off without a mobile number and says why", async () => {
    render(<ProfileWorkspace {...props()} />);
    const sms = await screen.findByRole("checkbox", { name: "Jobs & scheduling: SMS" });
    expect(sms).toBeDisabled();
    expect(screen.getByText(/add a mobile number in Details first/i)).toBeInTheDocument();
  });

  it("freezes every change while testing as someone else", async () => {
    render(<ProfileWorkspace {...props({ testingAsName: "Chloe Martin" })} />);
    expect(screen.getAllByText(/Stop testing as Chloe Martin to change your own settings/).length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Full name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  });
});

describe("Your profile on a phone", () => {
  beforeEach(() => setPhone(true));

  it("opens on the section list with one-line states; a section opens alone with a way back", async () => {
    render(<ProfileWorkspace {...props()} />);
    const list = screen.getByRole("navigation", { name: "Profile sections" });
    expect(within(list).getByRole("button", { name: /Two-step sign-in\s*Off/ })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /Passkeys and devices/ }));
    expect(screen.getByRole("button", { name: "All sections" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Profile sections", hidden: true })).toHaveClass("hidden");
    expect(screen.getByRole("heading", { level: 2, name: "Details", hidden: true }).closest("div.hidden")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All sections" }));
    expect(screen.getByRole("navigation", { name: "Profile sections" })).not.toHaveClass("hidden");
  });

  it("opens straight on the two-step card from the sign-in prompt", async () => {
    render(<ProfileWorkspace {...props({ twoStepPrompted: true })} />);
    expect(screen.getByRole("heading", { level: 2, name: "Two-step sign-in" }).closest("div.hidden")).toBeNull();
  });
});
