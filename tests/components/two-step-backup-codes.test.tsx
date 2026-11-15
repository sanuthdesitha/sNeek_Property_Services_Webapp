/**
 * Two-step backup codes in the browser (2026-11-17):
 *  - the one-time display: the codes, the plain warning, Copy / Download .txt /
 *    Print, and nothing kept once the person is done;
 *  - Your profile › Two-step: the status line never shows a code; "Make new
 *    backup codes…" is tier C and shows the new set once;
 *  - sign-in: "Use a backup code", the remaining count and the prompt at three
 *    or fewer, on a phone too.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/auth/biometric-sign-in-button", () => ({ BiometricSignInButton: () => null }));
vi.mock("@/lib/auth/credentials-sign-in", () => ({ signInWithCredentials: vi.fn(async () => ({ ok: true, url: "http://localhost/v2" })) }));
vi.mock("@/components/v2/shared/own-pin-fields", () => ({
  useOwnPinPrompt: () => ({ credentials: { pin: "1234" }, fieldProps: { status: "ready" }, noteFailure: vi.fn() }),
  OwnPinFields: () => <label>Your PIN<input aria-label="PIN" defaultValue="1234" /></label>,
}));

import { BackupCodesDisplay } from "@/components/v2/shared/backup-codes-display";
import { TwoStepCard } from "@/components/v2/admin/profile/two-step-card";
import LoginPageV2 from "@/app/v2/login/page";
import { signInWithCredentials } from "@/lib/auth/credentials-sign-in";

const CODES = ["ABCDE-FGHJK", "KMNPQ-RSTUV", "WXYZ2-34567", "89ABC-DEFGH", "JKMNP-QRSTU", "VWXYZ-23456", "789AB-CDEFG", "HJKMN-PQRST", "UVWXY-Z2345", "6789A-BCDEF"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("one-time display", () => {
  it("shows the ten codes with the plain warning, and Copy, Download and Print work", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const createObjectURL = vi.fn(() => "blob:codes");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const onDone = vi.fn();
    render(<BackupCodesDisplay codes={CODES} createdLabel="Tue 17 Nov 2026, 9:42 am" accountEmail="a@x.invalid" onDone={onDone} />);
    const list = screen.getByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(CODES);
    expect(screen.getByText(/Each code works once/)).toBeInTheDocument();
    expect(screen.getByText(/They will not be shown again/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as unknown as string;
    for (const code of CODES) expect(copied).toContain(code);
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download .txt" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Downloaded sneek-backup-codes.txt.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    fireEvent.click(screen.getByRole("button", { name: "I've saved them" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("says plainly when copying is not possible", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    render(<BackupCodesDisplay codes={CODES} createdLabel="today" accountEmail={null} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy did not work in this browser");
  });
});

describe("Your profile › Two-step sign-in", () => {
  type Call = { url: string; method: string; body: unknown };
  let calls: Call[];
  const status = (remaining: number) => ({
    enabled: true, method: "TOTP", backupCodesRemaining: remaining, hasPassword: true, email: "a@x.invalid",
    requirement: { kind: "met", required: true },
    backupCodes: { total: 10, remaining, createdAt: "2026-11-10T00:00:00.000Z", olderSet: false },
  });

  beforeEach(() => {
    calls = [];
  });

  function serve(remaining: number, makeNew: { status: number; body: unknown }) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === "/api/auth/2fa/backup-codes" && init?.method === "POST") return new Response(JSON.stringify(makeNew.body), { status: makeNew.status });
      return new Response(JSON.stringify(status(remaining)), { status: 200 });
    }));
  }

  it("shows how many are left and when they were made, never a code, and prompts at three or fewer", async () => {
    serve(2, { status: 200, body: {} });
    render(<TwoStepCard timeZone="Australia/Sydney" readOnlyReason={null} prompted={false} />);
    expect(await screen.findByText(/2 of 10 left · made 10 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText("Only 2 backup codes left")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Backup codes" })).toBeNull();
  });

  it("makes new codes with the person's own PIN and shows them once", async () => {
    serve(8, { status: 200, body: { ok: true, codes: CODES, createdAt: "2026-11-17T00:00:00.000Z", remaining: 10, total: 10 } });
    render(<TwoStepCard timeZone="Australia/Sydney" readOnlyReason={null} prompted={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make new backup codes…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Every code you have now stops working/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Make new codes" }));
    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ security: { pin: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "I've saved them" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Backup codes" })).toBeNull());
    expect(screen.queryByText("ABCDE-FGHJK")).toBeNull();
  });

  it("keeps the old codes and says why when the PIN is refused", async () => {
    serve(8, { status: 423, body: { error: "INVALID_SECURITY_VERIFICATION" } });
    render(<TwoStepCard timeZone="Australia/Sydney" readOnlyReason={null} prompted={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Make new backup codes…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Make new codes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No new codes were made; your old ones still work.");
    expect(screen.queryByRole("list", { name: "Backup codes" })).toBeNull();
  });

  it("is locked while testing as someone else", async () => {
    serve(8, { status: 200, body: {} });
    render(<TwoStepCard timeZone="Australia/Sydney" readOnlyReason="Stop testing as Sam to change your own settings." prompted={false} />);
    expect(await screen.findByRole("button", { name: "Make new backup codes…" })).toBeDisabled();
  });
});

describe("sign-in second step", () => {
  function serveSignIn(complete: { status: number; body: unknown }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/2fa/begin") return new Response(JSON.stringify({ required: true, method: "TOTP" }));
      if (url === "/api/auth/2fa/complete") return new Response(JSON.stringify(complete.body), { status: complete.status });
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function reachSecondStep() {
    render(<LoginPageV2 />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@x.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("Authenticator code");
  }

  beforeEach(() => vi.mocked(signInWithCredentials).mockClear());

  it("uses a backup code, shows how many remain and offers new codes at three or fewer", async () => {
    const fetchMock = serveSignIn({ status: 200, body: { ok: true, backupCode: { remaining: 3, makeNewSuggested: true, newCodesPath: "/v2/admin/profile?setup=two-step", settingsPath: "/v2/admin/profile?setup=two-step" } } });
    await reachSecondStep();
    fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
    const input = screen.getByLabelText("Backup code");
    expect(input).toHaveAttribute("autocomplete", "off");
    fireEvent.change(input, { target: { value: "abcde-fghjk" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Backup code accepted" })).toBeInTheDocument();
    expect(screen.getByText(/3 backup codes left/)).toBeInTheDocument();
    expect(screen.getByText("You are running low.")).toBeInTheDocument();
    expect(screen.queryByText(/abcde-fghjk/i)).toBeNull();
    const sent = JSON.parse(String((fetchMock.mock.calls.find(([url]) => String(url) === "/api/auth/2fa/complete")![1] as RequestInit).body));
    expect(sent).toMatchObject({ method: "backup", code: "abcde-fghjk" });
    expect(signInWithCredentials).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in and make new codes" }));
    await waitFor(() => expect(signInWithCredentials).toHaveBeenCalledWith(expect.objectContaining({ callbackUrl: "http://localhost:3000/v2/admin/profile?setup=two-step".replace("http://localhost:3000", window.location.origin) })));
  });

  it("shows the refusal and keeps the backup field on a wrong code", async () => {
    serveSignIn({ status: 401, body: { error: "That backup code was not accepted. Each code works once." } });
    await reachSecondStep();
    fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
    fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "zzzzz-zzzzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText("That backup code was not accepted. Each code works once.")).toBeInTheDocument();
    expect(screen.getByLabelText("Backup code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use your authenticator code instead" }));
    expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument();
  });

  it("on a phone: plenty left, one Continue, 44px switch target", async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
    serveSignIn({ status: 200, body: { ok: true, backupCode: { remaining: 7, makeNewSuggested: false, newCodesPath: null, settingsPath: "/v2/cleaner/profile" } } });
    await reachSecondStep();
    const toggle = screen.getByRole("button", { name: "Use a backup code" });
    expect(toggle.className).toContain("min-h-11");
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "ABCDE FGHJK" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText(/7 backup codes left/)).toBeInTheDocument();
    expect(screen.queryByText("You are running low.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(signInWithCredentials).toHaveBeenCalledTimes(1));
  });
});
