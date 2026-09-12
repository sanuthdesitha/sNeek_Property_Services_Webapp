import React from "react";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPageV2 from "@/app/v2/login/page";
import { signInWithCredentials } from "@/lib/auth/credentials-sign-in";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/auth/biometric-sign-in-button", () => ({
  BiometricSignInButton: ({ disabled }: { disabled: boolean }) => <button disabled={disabled}>Passkey</button>,
}));
vi.mock("@/lib/auth/credentials-sign-in", () => ({ signInWithCredentials: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(signInWithCredentials).mockReset();
  fetchMock = vi.fn(async (url: string) => ({ json: async () => url === "/api/auth/2fa/begin"
    ? { required: true, method: "TOTP" }
    : {} }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("v2 login hydration", () => {
  it("renders credential fields and submit disabled before client effects run", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<LoginPageV2 />);
    expect(container.querySelector("#email")).toBeDisabled();
    expect(container.querySelector("#password")).toBeDisabled();
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enables the mounted form and sends the first submission to the second-factor check", async () => {
    render(<LoginPageV2 />);
    expect(screen.getByLabelText("Email")).toBeEnabled();
    expect(screen.getByLabelText("Password")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "fixture@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("Authenticator code");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/2fa/begin")).toHaveLength(1);
    expect(signInWithCredentials).not.toHaveBeenCalled();
  });

  it("keeps maintenance sign-in disabled after mount", async () => {
    fetchMock.mockImplementation(async () => ({ json: async () => ({ maintenanceEnabled: true, allowLogin: false }) }));
    render(<LoginPageV2 />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled());
    expect(signInWithCredentials).not.toHaveBeenCalled();
  });
});
