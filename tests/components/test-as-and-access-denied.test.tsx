/**
 * Boards "Test as" and "Access denied" (2026-11-17), component level:
 * - Test as: grouped list with search and chips, folded groups, tier A
 *   confirmation for full access with the end time, the PIN step on a lapsed
 *   unlock, the mode table from the real rules, and the banner (mode in words,
 *   end time, Stop testing, "Could not stop. Try again.", the phone banner).
 * - Access denied: one h1, the answers, Ask an administrator through a tier A
 *   confirmation (failure keeps the dialog), "could not be checked" with Try
 *   again and never "You can't open…", and the portal look (no names).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TestAsPicker, type TestAsCandidate } from "@/components/admin/test-as-picker";
import { TestAsModeTable } from "@/components/admin/test-as-mode-table";
import { ImpersonationBar } from "@/components/admin/impersonation-bar";
import { DenialPage } from "@/components/v2/access/denial-view";
import { officeDenialView, portalDenialView, unknownView } from "@/lib/access/denial";
import { TEST_AS_RULES } from "@/lib/auth/test-as-rules";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const person = (id: string, name: string, role: TestAsCandidate["role"], extra: Partial<TestAsCandidate> = {}): TestAsCandidate => ({
  id, name, email: `${id}@example.invalid`, role, clientName: null, lastSeenLabel: "last seen today 09:40", ...extra,
});

const PEOPLE: TestAsCandidate[] = [
  person("marco", "Marco Rossi", "CLEANER"),
  person("aiko", "Aiko Tanaka", "CLEANER", { lastSeenLabel: "last seen Fri 13 Nov" }),
  person("ana", "Ana Lima", "CLEANER"),
  person("priya", "Priya Natarajan", "CLIENT", { clientName: "Northside Lets" }),
  person("dana", "Dana Whitfield", "QA_INSPECTOR"),
  person("linen", "Linen Lab", "LAUNDRY"),
  person("ben", "Ben Doyle", "OPS_MANAGER"),
];

let calls: Array<{ url: string; init?: RequestInit }> = [];
let respond: (url: string, init?: RequestInit) => Response = () => new Response(JSON.stringify({ ok: true }));
const assign = vi.fn();

beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify({ ok: true }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }));
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign, href: "http://localhost/v2/admin/system/test-as", reload: vi.fn() } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Test as list", () => {
  it("groups people by portal, shows email, client and last seen, and folds the smaller portals", () => {
    render(<TestAsPicker people={PEOPLE} timeZone="Australia/Sydney" />);
    expect(screen.getByRole("region", { name: "Cleaners" })).toBeInTheDocument();
    expect(screen.getByText("Marco Rossi")).toBeInTheDocument();
    expect(screen.getByText("marco@example.invalid · last seen today 09:40")).toBeInTheDocument();
    expect(screen.getByText("Northside Lets · priya@example.invalid · last seen today 09:40")).toBeInTheDocument();
    // Two cleaners shown, the third behind "1 more cleaners Show".
    expect(screen.queryByText("Ana Lima")).toBeNull();
    fireEvent.click(within(screen.getByRole("region", { name: "Cleaners" })).getByRole("button", { name: "Show" }));
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
    // Laundry and Ops managers fold into one row until shown.
    expect(screen.getByText("Laundry · Ops managers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View only as Linen Lab" })).toBeNull();
    expect(screen.getByText("Administrators cannot be tested as. Only active accounts are listed.")).toBeInTheDocument();
  });

  it("searches name and email across every portal, and filters by chip", () => {
    render(<TestAsPicker people={PEOPLE} timeZone="Australia/Sydney" />);
    fireEvent.change(screen.getByLabelText("Search name or email"), { target: { value: "linen" } });
    expect(screen.getByRole("button", { name: "View only as Linen Lab" })).toBeInTheDocument();
    expect(screen.queryByText("Marco Rossi")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search name or email"), { target: { value: "nobody" } });
    expect(screen.getByText("No one matches “nobody”.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search name or email"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /QA inspectors/ }));
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
    expect(screen.queryByText("Marco Rossi")).toBeNull();
  });

  it("starts view only at once, the safe default", async () => {
    respond = () => new Response(JSON.stringify({ home: "/v2/cleaner" }));
    render(<TestAsPicker people={PEOPLE} timeZone="Australia/Sydney" />);
    fireEvent.click(screen.getByRole("button", { name: "View only as Marco Rossi" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ userId: "marco", mode: "READ_ONLY" });
  });

  it("asks a tier A confirmation for full access that lists what stays blocked and when it ends", async () => {
    render(<TestAsPicker people={PEOPLE} timeZone="Australia/Sydney" />);
    fireEvent.click(screen.getByRole("button", { name: "Full access as Marco Rossi…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Full access as Marco Rossi?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Actions that ask for a PIN, their devices, notification choices and location stay blocked\. It ends by itself at \d\d:\d\d\./)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    respond = () => new Response(JSON.stringify({ error: "That account is deactivated — reactivate it first." }), { status: 400 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start full access" }));
    // A failure keeps the dialog open with the reason.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("It did not start: That account is deactivated");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ userId: "marco", mode: "FULL" });
  });

  it("returns to the PIN step with the person kept when the 15-minute unlock lapsed", async () => {
    respond = () => new Response(JSON.stringify({ code: "TEST_AS_LOCKED", error: "Confirm your password to start a test session." }), { status: 403 });
    render(<TestAsPicker people={PEOPLE} timeZone="Australia/Sydney" />);
    fireEvent.click(screen.getByRole("button", { name: "View only as Aiko Tanaka" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/v2/admin/system/test-as?chosen=aiko&relock=1"));
  });
});

describe("What each mode can do", () => {
  it("renders one row per real rule with both answers in words", () => {
    render(<TestAsModeTable />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(TEST_AS_RULES.length);
    expect(within(rows[1]).getByText("Refused")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Yes, real, in their name")).toBeInTheDocument();
    expect(screen.getByText("Refused: it needs your own PIN")).toBeInTheDocument();
  });
});

describe("the banner while testing", () => {
  const props = { targetName: "Marco Rossi", targetShortName: "Marco R.", targetRoleLabel: "cleaner", endsAtLabel: "15:42" };

  it("says the mode in words with the end time, desktop and phone", () => {
    render(<ImpersonationBar {...props} mode="READ_ONLY" />);
    const region = screen.getByRole("region", { name: "Testing as someone else" });
    expect(region).toHaveTextContent("Testing as Marco Rossi · cleaner");
    expect(region).toHaveTextContent("View only · changes are blocked");
    expect(region).toHaveTextContent("ends 15:42");
    // Phone: shorter words, the same mode word, Stop always visible and 44px tall.
    expect(region).toHaveTextContent("As Marco R. · View only");
    const stop = screen.getByRole("button", { name: /Stop/ });
    expect(stop.className).toContain("h-11");
  });

  it("full access reads as real changes", () => {
    render(<ImpersonationBar {...props} mode="FULL" />);
    expect(screen.getByRole("region", { name: "Testing as someone else" })).toHaveTextContent("Full access · changes are real");
  });

  it("stays and says so when stopping fails", async () => {
    respond = () => new Response("{}", { status: 500 });
    render(<ImpersonationBar {...props} mode="READ_ONLY" />);
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Could not stop. Try again.");
    expect(calls[0]).toMatchObject({ url: "/api/admin/impersonate", init: { method: "DELETE" } });
  });
});

const officeView = officeDenialView({
  reason: "feature",
  from: "/v2/admin/finance/invoices",
  viewer: { name: "Chloe Martin", isAdministrator: false },
  facts: { kind: "area", area: "finance", level: "off", presetName: "Coordinator", presetAudience: "manager", setOnPerson: false },
  administrators: ["Hannah Lee", "Ravi Mehta"],
  grantLabel: null,
  impersonating: false,
});

describe("access denied page", () => {
  it("office: one heading, the answers, and Ask an administrator through tier A", async () => {
    respond = () => new Response(JSON.stringify({ outcome: { state: "sent", askedAtLabel: "10:12 am", recipients: 2, inInbox: 2, queued: 0 } }));
    render(<DenialPage view={officeView} fromPath="/v2/admin/finance/invoices" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You can't open Invoices and pay yet");
    expect(screen.getByText("Hannah Lee")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to where you were" })).toHaveAttribute("href", "/v2/admin");
    expect(screen.getByRole("link", { name: "Go to Command" })).toHaveAttribute("href", "/v2/admin");
    fireEvent.click(screen.getByRole("button", { name: "Ask an administrator…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ask for Finance and invoicing?")).toBeInTheDocument();
    expect(within(dialog).getByText(/It does not change your access/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sent to 2 administrators at 10:12 am. It is in their inbox.");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ area: "finance", from: "/v2/admin/finance/invoices" });
  });

  it("office: a refused request keeps the dialog open with the reason", async () => {
    respond = () => new Response(JSON.stringify({ error: "the notification queue is unavailable." }), { status: 503 });
    render(<DenialPage view={officeView} fromPath="/v2/admin/finance/invoices" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask an administrator…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("It was not sent: the notification queue is unavailable.");
  });

  it("could not be checked: Try again, never worded as a refusal", () => {
    render(<DenialPage view={unknownView("admin")} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Permissions are temporarily unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/can't open/);
  });

  it("portal look: the office and phone, no administrator names, full-width way back on a phone", () => {
    render(<DenialPage view={portalDenialView({ portal: "cleaner", from: "/v2/admin/payroll", viewer: { name: "Marco Rossi", organisation: null }, officePhone: "02 9000 0000", impersonating: false })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This page isn't in your cleaner app");
    expect(screen.getByRole("link", { name: "Message the office" })).toHaveAttribute("href", "/v2/cleaner/hub?tab=chat");
    expect(screen.getByText("02 9000 0000")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: "Back to Today" });
    expect(back.className).toContain("w-full");
    expect(screen.getByRole("link", { name: "Sign in as someone else" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/administrator/i);
    expect(screen.queryByRole("button", { name: /Ask an administrator/ })).toBeNull();
  });
});
