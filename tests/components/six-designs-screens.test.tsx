/**
 * Screens of the six designs built 2026-11-17: the phone-safe checks button
 * with its tier A sheet, message templates (states, variable warning and
 * replace, tier B delete with "Switch off instead", read only), the property
 * form's unsaved-changes bar and stale-write recovery, checklist coverage
 * (unknown is "–", never 0; tier A before drafts) and report themes.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admin/forms", useRouter: () => ({ push: m.push, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { ValidationEnforcementCard } from "@/components/v2/admin/forms/library/validation-enforcement-card";
import { MessageTemplatesWorkspace } from "@/components/v2/admin/templates/message-templates-workspace";
import { PropertyFormEditor } from "@/components/v2/admin/settings/property-form-editor";
import { EstateChecklistCoverage } from "@/components/v2/admin/checklists/checklist-coverage";
import { ThemeManager } from "@/components/v2/admin/reports/theme-manager";

type Answer = { status?: number; body: unknown };
function route(handler: (url: string, init?: RequestInit) => Answer | Promise<Answer>) {
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const answer = await handler(String(url), init);
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })) as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("checks card", () => {
  it('reads "Start rejecting…" and moves the full sentence into a tier A confirmation', async () => {
    route((_url, init) =>
      init?.method === "PUT"
        ? { body: { ok: true } }
        : { body: { setting: { enforceExtended: false, enforcedSince: null }, rules: ["range", "details"], stats: null, statsError: "The counts could not be read." } },
    );
    render(<ValidationEnforcementCard canWrite timezone="Australia/Sydney" />);
    const button = await screen.findByRole("button", { name: "Start rejecting…" });
    expect(screen.queryByRole("button", { name: /Start rejecting submissions/ })).toBeNull();
    // Counts that could not be read are "–", never 0.
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0$/)).toBeNull();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Start rejecting submissions that break these checks?" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start rejecting" }));
    await waitFor(() => expect(m.fetch.mock.calls.some(([, init]) => init?.method === "PUT" && JSON.parse(String(init.body)).enforce === true)).toBe(true));
  });

  it("offers no button without write access", async () => {
    route(() => ({ body: { setting: { enforceExtended: false }, rules: [], stats: null, statsError: null } }));
    render(<ValidationEnforcementCard canWrite={false} timezone="Australia/Sydney" />);
    await screen.findByText("Off: recorded as warnings");
    expect(screen.queryByRole("button", { name: /rejecting/ })).toBeNull();
  });
});

const template = { id: "t1", name: "Booking confirmed", triggerType: "MANUAL", jobType: null, channel: "EMAIL", category: "OPERATIONAL", subject: "Booked", body: "Hi {{client.firstName}}, your cleaner is {{cleaner_name}}.", isActive: true, updatedAt: "2026-11-10T00:00:00.000Z" };
const usage = { t1: { automations: [{ ruleId: "r1", clientId: "c1", clientName: "Northside Lets", triggerType: "POST_JOB_NEXT_CLEAN", delayMinutes: 120, isEnabled: true }], campaigns: [] } };

describe("message templates", () => {
  it("shows loading, then a failure that never looks like an empty list", async () => {
    route((url) => (url.includes("/usage") ? { body: { usage: {} } } : { status: 500, body: { error: "boom" } }));
    render(<MessageTemplatesWorkspace />);
    expect(screen.getByText("Loading message templates…")).toBeVisible();
    expect(await screen.findByText("Message templates could not be loaded. Try again.")).toBeVisible();
    expect(screen.queryByText(/No message templates yet/)).toBeNull();
  });

  it("groups by category, warns about an old name, replaces it, and says where it is used", async () => {
    route((url, init) => {
      if (url.includes("/usage")) return { body: { usage } };
      if (url.includes("/messages/preview")) return { body: { subject: "Booked", body: "Hi Priya, your cleaner is [not filled]." } };
      if (init?.method === "PATCH") return { body: { ...template, body: JSON.parse(String(init.body)).body, updatedAt: "2026-11-15T00:00:00.000Z" } };
      return { body: [template] };
    });
    render(<MessageTemplatesWorkspace />);
    expect(await screen.findByRole("heading", { name: "Operational · 1" })).toBeVisible();
    expect(await screen.findByText(/\{\{cleaner_name\}\} is not filled where this template is used/)).toBeVisible();
    expect(screen.getByText(/Northside Lets: “Next clean” after each job, 120 min delay|Northside Lets: "Next clean" after each job/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Replace it" }));
    expect(screen.getByLabelText("Message")).toHaveValue("Hi {{client.firstName}}, your cleaner is {{cleaner.name}}.");
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(m.fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patch = m.fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1].body))).toMatchObject({ category: "OPERATIONAL", expectedUpdatedAt: template.updatedAt });
    expect(await screen.findByText("Hi Priya, your cleaner is [not filled].")).toBeVisible();
  });

  it("offers Switch off instead in the tier B delete and counts SMS characters", async () => {
    route((url) => (url.includes("/usage") ? { body: { usage } } : url.includes("/preview") ? { body: { body: "x" } } : { body: [template] }));
    render(<MessageTemplatesWorkspace />);
    await screen.findByRole("heading", { name: "Booking confirmed" });
    fireEvent.click(screen.getByRole("radio", { name: "SMS" }));
    expect(screen.queryByLabelText("Subject")).toBeNull();
    expect(screen.getByText(/characters · 1 text/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Booking confirmed" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 client automation uses it and will stop sending/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Switch off instead" })).toBeVisible();
  });

  it("is read only without write access: preview and where it is used stay", async () => {
    route((url) => (url.includes("/usage") ? { body: { usage } } : url.includes("/preview") ? { body: { body: "x" } } : { body: [template] }));
    render(<MessageTemplatesWorkspace canWrite={false} />);
    await screen.findByRole("heading", { name: "Booking confirmed" });
    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull();
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Where it is used" })).toBeVisible();
  });
});

describe("property form settings", () => {
  const config = { version: 1 as const, systemFields: {}, customFields: [] };

  it("lists unsaved changes in one bar, keeps them on a 409 and offers their version", async () => {
    route(() => ({ status: 409, body: { error: "Someone else saved the property form.", current: { ...config, systemFields: { notes: { required: true } }, revision: "r2" } } }));
    render(<PropertyFormEditor initialConfig={config} initialRevision="r1" />);
    const postcode = screen.getByRole("radiogroup", { name: "Postcode: required, optional or hidden" });
    fireEvent.click(within(postcode).getByRole("radio", { name: "Required" }));
    expect(screen.getByText(/Postcode: Optional → Required/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));
    expect(await screen.findByRole("button", { name: /Load their version/ })).toBeVisible();
    expect(screen.getByText(/Postcode: Optional → Required/)).toBeVisible();
    const body = JSON.parse(String(m.fetch.mock.calls[0][1].body));
    expect(body.expectedRevision).toBe("r1");
  });

  it("shows the form and the preview with no controls when read only", () => {
    render(<PropertyFormEditor initialConfig={config} canWrite={false} />);
    expect(screen.queryByRole("radiogroup", { name: /Postcode/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add custom field/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Preview: New property" })).toBeVisible();
  });
});

describe("checklist coverage", () => {
  const rows = [
    { id: "p1", name: "Paddington Row", suburb: "Paddington", clientName: "Private client", bedrooms: 3, bathrooms: 2, hasBalcony: true, hasFeatures: false, checklistStatus: "NONE", approvedAt: null, clientHasEmail: true },
    { id: "p2", name: "Coogee Terrace", suburb: "Coogee", clientName: "Harbour View Stays", bedrooms: 0, bathrooms: 2, hasBalcony: false, hasFeatures: true, checklistStatus: "APPROVED", approvedAt: "2026-11-02T00:00:00Z", clientHasEmail: true },
  ];

  it("shows – on every tile while loading and an alert (no 0) when it fails", async () => {
    route(() => ({ status: 500, body: { error: "down" } }));
    render(<EstateChecklistCoverage />);
    expect(screen.getAllByRole("button", { pressed: true })[0]).toHaveTextContent("–");
    expect(await screen.findByText("Coverage could not be loaded. Try again.")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Filter by status" })).queryByText("0")).toBeNull();
  });

  it("filters by tile, reads Bedrooms not set, and asks tier A before creating drafts", async () => {
    route((_url, init) => (init?.method === "POST" ? { body: { created: 1, skipped: 0, results: [{ propertyId: "p1", outcome: "created" }], createdBy: "Hannah Lee", at: "2026-11-14T23:42:00Z" } } : { body: { properties: rows } }));
    render(<EstateChecklistCoverage />);
    const table = await screen.findByRole("region", { name: "Checklist coverage" });
    expect(within(table).getByText("Bedrooms not set · 2 bath")).toBeVisible();
    expect(within(table).getAllByRole("link", { name: "Open forms" })[0]).toHaveAttribute("href", "/v2/admin/properties/p1?tab=checklist");
    fireEvent.click(screen.getByRole("button", { name: /No checklist yet/ }));
    expect(within(table).queryByText("Coogee Terrace")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create drafts for the 1 with none…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Create 1 draft checklist?" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create drafts" }));
    expect(await screen.findByText("1 draft checklist created, 0 skipped")).toBeVisible();
  });
});

describe("report themes", () => {
  it("says there is no per-client theme, checks readability and previews without saving", async () => {
    const theme = { id: "th1", name: "Estate", kind: "ESTATE", isDefault: true, isActive: true, layout: { sections: [], photoSize: "medium", density: "default", template: "estate" }, logoUrl: null, primaryColorHsl: "158 42% 20%", accentColorHsl: "41 42% 57%", titleTemplate: "{{property.name}}", footerHtml: null, updatedAt: "2026-11-10T00:00:00Z", _count: { reports: 3 } };
    route((url) => {
      if (url.includes("preview-jobs")) return { body: { jobs: [{ id: "j1", jobNumber: "J-1031", propertyName: "Glebe House" }] } };
      if (url.includes("/preview")) return { body: { html: "<p>report</p>" } };
      return { body: { themes: [theme] } };
    });
    render(<ThemeManager />);
    expect(screen.getByText("No per-client theme today")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Edit Estate" })).toBeVisible();
    expect(screen.getByText(/White text on the main colour/)).toBeVisible();
    expect(screen.getByText("Readable")).toBeVisible();
    await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => String(url).includes("/report-themes/preview") && !String(url).includes("jobs"))).toBe(true), { timeout: 3000 });
    expect(m.fetch.mock.calls.every(([url, init]) => !(String(url).includes("/report-themes/th1") && init?.method))).toBe(true);
  });
});
