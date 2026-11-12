import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  findInvite: vi.fn(),
  biometric: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }), useSearchParams: () => mocks.params }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/auth/biometric-sign-in-button", () => ({
  BiometricSignInButton: (props: { layout?: string }) => {
    mocks.biometric(props);
    return <button type="button">Passkey</button>;
  },
}));
vi.mock("@/lib/auth/credentials-sign-in", () => ({ signInWithCredentials: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { userInvitation: { findUnique: mocks.findInvite } } }));

import LoginPageV2 from "@/app/v2/login/page";
import AcceptInvitePage from "@/app/accept-invite/[token]/page";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import { firstStepWithMissing, onboardingSteps } from "@/lib/onboarding/steps";
import { PUBLIC_MENU_GROUPS } from "@/components/v2/public/public-menu";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
  mocks.params = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sign in, passkey first", () => {
  it("puts the passkey above the same email and password form", async () => {
    render(<LoginPageV2 />);
    const passkey = screen.getByRole("button", { name: "Passkey" });
    const email = screen.getByLabelText("Email");
    expect(passkey.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.biometric).toHaveBeenCalledWith(expect.objectContaining({ layout: "first" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByText(/Invited but never set a password\?/)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to your portal" })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});

describe("invitation link", () => {
  const user = { id: "u1", email: "lena@example.invalid", name: "Lena", role: "CLEANER", isActive: true };
  const future = new Date(Date.now() + 86_400_000);

  it.each([
    [null, "Invalid invitation"],
    [{ acceptedAt: new Date(), expiresAt: future, user }, "Already accepted"],
    [{ acceptedAt: null, expiresAt: new Date(Date.now() - 1000), user }, "Invitation expired"],
    [{ acceptedAt: null, expiresAt: future, user: { ...user, isActive: false } }, "Account unavailable"],
    // Owner decision 2026-11-13: a revoked link has its own state, even when it has also lapsed.
    [{ acceptedAt: null, revokedAt: new Date(), expiresAt: future, user }, "Invitation withdrawn"],
    [{ acceptedAt: null, revokedAt: new Date(), expiresAt: new Date(Date.now() - 1000), user }, "Invitation withdrawn"],
  ])("explains a broken link with one way out (%#)", async (invite, title) => {
    mocks.findInvite.mockResolvedValue(invite);
    render(await AcceptInvitePage({ params: { token: "tok" } }));
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("keeps the same fields, checks and request body", async () => {
    render(<AcceptInviteForm token="t/1" user={{ email: user.email, name: "Lena", role: "CLEANER" }} expiresAt={future.toISOString()} />);
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "long-enough-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-enough-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and continue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/accept-invite/t%2F1", expect.objectContaining({
      method: "POST", body: JSON.stringify({ password: "long-enough-1" }),
    }));
    expect(await screen.findByRole("heading", { name: "Password set" })).toBeVisible();
  });
});

describe("password reset", () => {
  it("sends the same body and says when the link is incomplete", async () => {
    render(<ResetPasswordPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("incomplete or invalid");
    cleanup();
    mocks.params = new URLSearchParams({ email: "a@example.invalid", token: "abc" });
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-password-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "new-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/reset-password", expect.objectContaining({
      body: JSON.stringify({ email: "a@example.invalid", token: "abc", password: "new-password-1" }),
    })));
  });
});

describe("onboarding steps and public menu", () => {
  it("shows only the steps a role needs", () => {
    expect(onboardingSteps("CLEANER").map((step) => step.label)).toEqual(["Your details", "Bank for pay", "Finish"]);
    expect(onboardingSteps("CLIENT").map((step) => step.label)).toEqual(["Your details", "Business", "Finish"]);
    expect(onboardingSteps("LAUNDRY").map((step) => step.key)).toEqual(["details", "business", "bank", "finish"]);
    expect(onboardingSteps("ADMIN").map((step) => step.key)).toEqual(["details", "finish"]);
    expect(firstStepWithMissing(onboardingSteps("CLEANER"), ["bankDetails", "contactNumber"])).toBe("details");
  });

  it("lists the drawn public pages in the phone menu", () => {
    const hrefs = PUBLIC_MENU_GROUPS.flat().map((link) => link.href);
    for (const href of ["/v2/home", "/v2/services", "/v2/airbnb-hosting", "/v2/subscriptions", "/v2/compare", "/v2/why-us", "/v2/faq", "/v2/blog", "/v2/careers", "/v2/contact", "/v2/privacy", "/v2/terms"]) {
      expect(hrefs).toContain(href);
    }
  });
});
