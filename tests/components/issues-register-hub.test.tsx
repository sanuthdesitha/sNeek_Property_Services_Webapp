/** The "All issues" tab: only where the pilot is on, unknown sources named, the log draft kept. */
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const m = vi.hoisted(() => ({ role: vi.fn(), ops: vi.fn(), settings: vi.fn(), pilot: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/pilots/state", () => ({ isPilotOn: m.pilot }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
}));

import Page from "@/app/v2/admin/quality/page";
import { QualityHub } from "@/components/v2/admin/quality/hub/quality-hub";
import type { HubContext } from "@/components/v2/admin/quality/hub/hub-types";

type RegisterContext = { props: { context: { register: { visible: boolean; canLog: boolean } } } };

const REGISTER_BODY = {
  rows: [
    {
      key: "STOCK:s1", source: "STOCK", recordId: "s1", date: "2026-11-27T00:00:00Z", title: "Low or out: Toilet paper", detail: null,
      propertyId: "p1", propertyName: "Harbour View", clientId: "c1", clientName: "Acme", cleaners: [], jobId: null, jobNumber: null,
      category: "stock-supplies", categoryLabel: "Supplies", severity: null, severityLabel: null, open: true, statusLabel: "Reported",
      closedAt: null, closedBy: null, href: "/v2/admin/inventory?propertyId=p1", overdue: false, ageHours: 20,
    },
  ],
  total: 1, page: 1, pageSize: 25, pageCount: 1, sort: "date", dir: "desc",
  stats: { total: 1, open: 1, overdue: 0, averageFixHours: null, fixTimesKnown: 0, fixTimesUnknown: 0, byCategory: [], bySource: [], byCleaner: [], byProperty: [], repeats: [], months: [] },
  sources: [
    { source: "STOCK", state: "ok", read: 1, truncated: false },
    { source: "DAMAGE", state: "failed", read: null, truncated: false },
  ],
  facets: { properties: [], cleaners: [], clients: [], categories: [] },
  period: { key: "30d", fromKey: "2026-10-30", toKey: "2026-11-28" },
  timeZone: "Australia/Sydney",
};

const context = (register?: HubContext["register"]): HubContext => ({ canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: 10, register });

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/quality/register/options")) return Promise.resolve(Response.json({ properties: [{ id: "p1", label: "Harbour View" }], cleaners: [], categories: [{ id: "bathroom", label: "Bathroom" }] }));
    if (url.startsWith("/api/admin/quality/register")) return Promise.resolve(Response.json(REGISTER_BODY));
    if (url.startsWith("/api/admin/quality/options")) return Promise.resolve(Response.json({ cleaners: [], properties: [], inspectors: [], categories: [] }));
    return Promise.resolve(Response.json({ rows: [], total: 0 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("server page decides the tab per person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.settings.mockResolvedValue({ timezone: "Australia/Sydney", accountability: { scoring: { falseConfirmationExtraDeduction: 10 } } });
    m.ops.mockResolvedValue(null);
  });

  it("pilot off: hidden for everyone (the hub as before)", async () => {
    m.pilot.mockResolvedValue(false);
    m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    expect(((await Page()) as unknown as RegisterContext).props.context.register).toEqual({ visible: false, canLog: false });
    expect(m.pilot).toHaveBeenCalledWith("issues-register", { userId: "a" });
  });

  it("pilot on: ADMIN can log; a read-only or cases-less ops manager can only read; never while testing as someone; never a QA inspector", async () => {
    m.pilot.mockResolvedValue(true);
    m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    expect(((await Page()) as unknown as RegisterContext).props.context.register).toEqual({ visible: true, canLog: true });
    m.role.mockResolvedValue({ user: { id: "o", role: "OPS_MANAGER" } });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), quality: "manage" });
    expect(((await Page()) as unknown as RegisterContext).props.context.register).toEqual({ visible: true, canLog: false });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), quality: "manage", cases: "manage" });
    expect(((await Page()) as unknown as RegisterContext).props.context.register).toEqual({ visible: true, canLog: true });
    m.role.mockResolvedValue({ user: { id: "a", role: "ADMIN" }, impersonation: { actorId: "a" } });
    m.ops.mockResolvedValue(null);
    expect(((await Page()) as unknown as RegisterContext).props.context.register.canLog).toBe(false);
    m.role.mockResolvedValue({ user: { id: "q", role: "QA_INSPECTOR" } });
    expect(((await Page()) as unknown as RegisterContext).props.context.register.visible).toBe(false);
  });
});

describe("the hub", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("no All issues tab while the pilot is off", async () => {
    stubFetch();
    window.history.replaceState(null, "", "/v2/admin/quality?tab=register");
    render(<QualityHub context={context({ visible: false, canLog: false })} />);
    expect(screen.queryByRole("link", { name: /All issues/ })).toBeNull();
    // A stale ?tab=register link falls back to the default tab.
    expect(screen.getByRole("link", { name: /Cleaners/ })).toHaveAttribute("aria-current", "page");
  });

  it("names a source that could not load instead of counting it as zero; the log draft survives closing", async () => {
    stubFetch();
    window.history.replaceState(null, "", "/v2/admin/quality?tab=register");
    render(<QualityHub context={context({ visible: true, canLog: true })} />);
    expect(screen.getByRole("link", { name: /All issues/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText(/Could not load: Damage/)).toBeInTheDocument();
    expect(screen.getByText("Low or out: Toilet paper")).toBeInTheDocument();
    expect(screen.getByText("Not graded")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Log an issue/ }));
    const description = await screen.findByLabelText("What happened");
    fireEvent.change(description, { target: { value: "Client says towels were left on the floor" } });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByLabelText("What happened")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Log an issue/ }));
    expect(await screen.findByLabelText("What happened")).toHaveValue("Client says towels were left on the floor");
  });
});
