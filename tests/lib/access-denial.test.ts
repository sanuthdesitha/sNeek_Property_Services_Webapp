// @vitest-environment node
/**
 * Access denied (board "Access denied", 2026-11-17): the page that refused
 * rides along only as a validated same-origin path, is never a redirect
 * target and is shown shortened (the AREA, never a record); office staff are
 * told which administrators can change it, portal people only "the office"
 * and the office phone number (or that none is set); the role-only variant
 * offers no "Ask"; a failed permission read is its own state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { displayFromPath, fromSearchParam, safeFromPath, withFrom } from "@/lib/access/return-path";
import {
  OFFICE_PAGE_NAMES,
  UNKNOWN_TITLE,
  denialPlainText,
  officeDenialView,
  officePageName,
  portalDenialView,
  unknownView,
  type DenialView,
  type OfficeDenialInput,
} from "@/lib/access/denial";

const text = (view: DenialView) => [view.title, view.intro ?? "", ...view.answers.map((answer) => `${answer.label}: ${denialPlainText(answer.text)} ${answer.path ?? ""}`)].join("\n");

describe("the page you came from", () => {
  it.each([
    ["/v2/admin/finance/invoices", "/v2/admin/finance/invoices"],
    ["/v2/admin/finance?tab=payroll", "/v2/admin/finance?tab=payroll"],
    ["/v2/cleaner", "/v2/cleaner"],
  ])("keeps a same-origin path %s", (raw, expected) => {
    expect(safeFromPath(raw)).toBe(expected);
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example",
    "https://evil.example/v2/admin",
    "javascript:alert(1)",
    "evil.example/v2",
    "/v2/admin/%0d%0aSet-Cookie:x",
    "/v2/admin/jobs\nx",
    "/v2/admin/jobs x",
    "/v2/admin/\u0000",
    "/api/admin/users",
    "/unauthorized",
    "/v2/admin/access-denied?reason=role",
    `/${"a".repeat(600)}`,
    "",
  ])("refuses %j (open redirect, header injection, API, loops, oversize)", (raw) => {
    const result = safeFromPath(raw);
    // Percent-encoded line breaks stay encoded text, never a real break.
    if (result !== null) expect(result).not.toMatch(/[\r\n]/);
    if (raw !== "/v2/admin/%0d%0aSet-Cookie:x") expect(result).toBeNull();
  });

  it("reads Next search params safely and builds the denial query", () => {
    expect(fromSearchParam(["/v2/admin/jobs", "/x"])).toBe("/v2/admin/jobs");
    expect(fromSearchParam(undefined)).toBeNull();
    expect(withFrom("/v2/admin/access-denied?reason=role", "/v2/admin/activity")).toBe("/v2/admin/access-denied?reason=role&from=%2Fv2%2Fadmin%2Factivity");
    expect(withFrom("/unauthorized", "https://evil.example")).toBe("/unauthorized");
  });

  it("shows the area, never a record: ids are cut, the query is dropped", () => {
    expect(displayFromPath("/v2/admin/jobs/cm9x1abc23def/edit?tab=billing")).toBe("/v2/admin/jobs/…");
    expect(displayFromPath("/v2/admin/finance/invoices")).toBe("/v2/admin/finance/invoices");
    expect(displayFromPath("/v2/admin/payroll/42")).toBe("/v2/admin/payroll/…");
    expect(displayFromPath("//evil")).toBeNull();
  });
});

describe("office page names follow the admin rail", () => {
  it("names every rail destination exactly as the rail labels it", () => {
    const layout = readFileSync(join(process.cwd(), "app/v2/admin/layout.tsx"), "utf8");
    const entries = Array.from(layout.matchAll(/\{ href: "(\/v2\/admin[^"]*)", label: "([^"]+)"/g), (match) => [match[1], match[2]] as const);
    expect(entries.length).toBeGreaterThan(20);
    for (const [href, label] of entries) expect(officePageName(href), href).toBe(label);
  });

  it("covers old URLs that are now tabs, and v1 paths", () => {
    expect(officePageName("/v2/admin/payroll")).toBe("Invoices and pay");
    expect(officePageName("/admin/finance")).toBe("Invoices and pay");
    expect(officePageName("/v2/admin/system/test-as")).toBe("Test as");
    expect(officePageName("/v2/admin/nowhere")).toBeNull();
    expect(Object.keys(OFFICE_PAGE_NAMES).length).toBeGreaterThan(30);
  });
});

const office = (overrides: Partial<OfficeDenialInput> = {}): DenialView =>
  officeDenialView({
    reason: "feature",
    from: "/v2/admin/finance/invoices",
    viewer: { name: "Chloe Martin", isAdministrator: false },
    facts: { kind: "area", area: "finance", level: "off", presetName: "Coordinator", presetAudience: "manager", setOnPerson: false },
    administrators: ["Hannah Lee", "Ravi Mehta"],
    grantLabel: null,
    impersonating: false,
    ...overrides,
  });

describe("office denial (operations managers)", () => {
  it("answers what, why and who in the board's words, naming the administrators", () => {
    const view = office();
    expect(view.title).toBe("You can't open Invoices and pay yet");
    const all = text(view);
    expect(all).toContain("What you tried: Invoices and pay /v2/admin/finance/invoices");
    expect(all).toContain('Why not: You are an operations manager with the Coordinator access. In it, "Finance and invoicing" is set to Off.');
    expect(all).toContain("Who can change it: An administrator: Hannah Lee or Ravi Mehta, in Settings › Access and permissions.");
    expect(view.historyBack).toBe(true);
    expect(view.back).toEqual({ label: "Go to Command", href: "/v2/admin" });
    expect(view.ask).toMatchObject({ kind: "offered", area: "finance", areaLabel: "Finance and invoicing", fromLabel: "Invoices and pay", viewerName: "Chloe Martin" });
  });

  it("says when the person's own setting (not the preset) turns the area off, and an assistant is called one", () => {
    expect(denialPlainText(office({ facts: { kind: "area", area: "finance", level: "off", presetName: "Assistant: bookings", presetAudience: "assistant", setOnPerson: true } }).answers[1].text))
      .toBe('You are an office assistant with the Assistant: bookings access. Your own setting turns "Finance and invoicing" Off.');
  });

  it("does not offer Ask while testing as someone (it would go out in their name)", () => {
    expect(office({ impersonating: true }).ask).toMatchObject({ kind: "not_offered" });
  });

  it("role-only variant: no Ask, and the line says why", () => {
    const view = office({ reason: "role", from: "/v2/admin/activity", facts: { kind: "unknown_page" } });
    expect(view.title).toBe("This page is for administrators");
    expect(text(view)).toContain("Only an administrator can make you an administrator.");
    expect(view.ask).toEqual({ kind: "not_offered", reason: expect.stringContaining("role change") });
  });

  it("names the grant when an administrator can give one (Test as)", () => {
    const view = office({ reason: "role", from: "/v2/admin/system/test-as", facts: { kind: "unknown_page" }, grantLabel: "Test as another person" });
    expect(text(view)).toContain("Only an administrator can give you Test as another person, in Settings › Access and permissions.");
  });

  it("explains an unmapped page without inventing an area, and offers no Ask", () => {
    const view = office({ facts: { kind: "unmapped" }, from: "/v2/admin/brand-new" });
    expect(text(view)).toContain("has not been given an area");
    expect(view.ask).toMatchObject({ kind: "not_offered" });
  });
});

describe("portal denial (cleaner, client, laundry, QA, maintenance)", () => {
  const viewer = { name: "Marco Rossi", organisation: null };

  it("cleaner: the office and its phone number, never administrator names", () => {
    const view = portalDenialView({ portal: "cleaner", from: "/v2/admin/payroll", viewer, officePhone: "02 9000 0000", impersonating: false });
    expect(view.title).toBe("This page isn't in your cleaner app");
    const all = text(view);
    expect(all).toContain("What you tried: An office page /v2/admin/payroll");
    expect(all).toContain("You're signed in as Marco Rossi, cleaner. Office pages are for sNeek staff.");
    expect(all).toContain("Who can help: The office: Message the office or call 02 9000 0000.");
    expect(all).not.toMatch(/administrator/i);
    expect(view.back).toEqual({ label: "Back to Today", href: "/v2/cleaner" });
    expect(view.signOut).toBe(true);
    expect(view.ask).toBeNull();
  });

  it("says so when no office phone number is set, rather than a blank", () => {
    const view = portalDenialView({ portal: "laundry", from: "/v2/admin/jobs/abc123", viewer: { name: "CleanCo Laundry", organisation: null }, officePhone: "  ", impersonating: false });
    const all = text(view);
    expect(all).toContain("No office phone number is set in company details yet.");
    expect(all).toContain("/v2/admin/jobs/…");
    expect(all).not.toContain("abc123");
  });

  it("client: the office page variant, with the client account's name", () => {
    const view = portalDenialView({ portal: "client", from: "/v2/admin/jobs/j-123", viewer: { name: "Priya", organisation: "Northside Lets" }, officePhone: "02 9000 0000", impersonating: false });
    expect(view.title).toBe("This page is for the sNeek office");
    expect(text(view)).toContain("You're signed in as Priya, Northside Lets. Your cleans, reports and invoices are in your portal.");
    expect(text(view)).toContain("sNeek: send us a message or call 02 9000 0000. We reply within business hours.");
    expect(view.back.label).toBe("Back to my properties");
  });

  it.each([
    ["qa", "This page isn't in your QA app", "Back to Today's reviews"],
    ["laundry", "This page isn't in your laundry portal", "Back to Runs"],
    ["maintenance", "This page isn't in your maintenance app", "Back to My items"],
  ] as const)("%s keeps its own title and way back", (portal, title, back) => {
    const view = portalDenialView({ portal, from: "/v2/admin", viewer, officePhone: "02 9000 0000", impersonating: false });
    expect(view.title).toBe(title);
    expect(view.back.label).toBe(back);
  });

  it("while testing as the person: their answer, no sign-out (it would sign out the administrator)", () => {
    const view = portalDenialView({ portal: "cleaner", from: "/v2/admin", viewer, officePhone: null, impersonating: true });
    expect(view.signOut).toBe(false);
    expect(view.footnote).toContain("exactly the answer they would see");
  });
});

describe("could not be checked", () => {
  it("is its own state, never worded as a refusal", () => {
    const view = unknownView("admin");
    expect(view.state).toBe("unknown");
    expect(view.title).toBe(UNKNOWN_TITLE);
    expect(`${view.title} ${view.message}`).not.toMatch(/can't open|not allowed|denied/i);
  });
});
