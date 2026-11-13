/**
 * Access and permissions on a phone (board "M-Permissions", 2026-11): people
 * list → person screen, one row per area with a level button opening a sheet,
 * the same draft and the same PUT payload as the desktop matrix, Review and
 * save with the editor's own PIN, "What X can do" as a full-screen sheet, and
 * nothing changed from 640px up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccessWorkspace } from "@/components/v2/admin/settings/access/access-workspace";
import type { AccessScreenData } from "@/lib/rbac/access-screen-types";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";

const policy: OpsPolicy = {
  revision: 2,
  presets: [],
  assignments: {
    priya: { presetId: "assistant-bookings", overrides: {} },
    chloe: { presetId: "coordinator", overrides: {} },
  },
};
const person = (id: string, name: string, role = "OPS_MANAGER") => ({ id, name, email: `${id}@example.invalid`, role, heldRoles: [role], twoFactorEnabled: true, createdAt: "2026-08-21T00:00:00.000Z" });
const screenData = (): AccessScreenData => ({
  policy: structuredClone(policy),
  people: [person("hannah", "Hannah Lee", "ADMIN"), person("priya", "Priya Nair"), person("chloe", "Chloe Martin")],
  ownPortalCounts: { CLEANER: 14 },
  assistantTeams: [{ id: "team", name: "Front desk", clientId: "client", clientName: "Harbour Stays", memberCount: 2, isActive: true }],
  history: [],
  viewer: { id: "hannah", isAdmin: true, grants: ["access.test_as", "access.edit_permissions"] },
  timeZone: "Australia/Sydney",
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetcher: ReturnType<typeof vi.fn>;

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/me/admin-pin") return json({ hasPin: true, lockedUntil: null, userId: "hannah" });
    if (init?.method === "PUT") return json({ policy: { ...JSON.parse(String(init.body)).policy, revision: 3 } });
    return json(screenData());
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function saveWithPin(): Promise<unknown> {
  fireEvent.click(screen.getByRole("button", { name: "Review and save" }));
  const dialog = await screen.findByRole("dialog", { name: /Review and save access/ });
  fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "1234" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  return JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1].body);
}

async function desktopPayload(): Promise<unknown> {
  setPhone(false);
  render(<AccessWorkspace />);
  await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
  fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
  await screen.findByRole("heading", { level: 2, name: "Priya Nair" });
  fireEvent.click(screen.getAllByRole("button", { name: /^Show \d areas?$/ }).find((button) => button.closest("tr")?.textContent?.includes("Finance and invoicing"))!);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Finance and invoicing level" })).getByRole("radio", { name: "View" }));
  const body = await saveWithPin();
  cleanup();
  fetcher.mockClear();
  return body;
}

describe("Access and permissions on a phone", () => {
  it("stacks the people list and the person, with back navigation", async () => {
    setPhone(true);
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
    expect(screen.getByRole("region", { name: "People with office access" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Priya Nair" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Priya Nair" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "People with office access" })).toBeNull();
    // No sideways-scrolling matrix on a phone.
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to people" }));
    expect(screen.getByRole("region", { name: "People with office access" })).toBeInTheDocument();
  });

  it("the level sheet saves exactly the payload the desktop matrix saves", async () => {
    const desktop = await desktopPayload();

    setPhone(true);
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
    fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
    await screen.findByRole("heading", { level: 2, name: "Priya Nair" });
    fireEvent.click(screen.getByRole("button", { name: /^Show \d areas? in Money$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finance and invoicing: Off. Change level" }));
    const sheet = await screen.findByRole("dialog", { name: "Finance and invoicing" });
    // The sheet holds the area's capabilities with the reason each is unavailable.
    expect(within(sheet).getAllByText(/Needs (Manage|Full)/).length).toBeGreaterThan(0);
    fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Finance and invoicing level" })).getByRole("radio", { name: "View" }));
    expect(sheet).toHaveTextContent(/Was Off for Priya, not saved yet/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Finance and invoicing: View, not saved. Change level" })).toBeInTheDocument();
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(bar).toHaveTextContent("Priya Nair: Finance and invoicing: Off → View");
    const phone = await saveWithPin();
    expect(phone).toEqual(desktop);
    expect(phone).toMatchObject({ security: { pin: "1234" }, policy: { assignments: { priya: { overrides: { finance: "read" } } } } });
  });

  it("keeps the unsaved bar on the list, the header actions in a menu, and What X can do as a sheet", async () => {
    setPhone(true);
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
    fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
    await screen.findByRole("heading", { level: 2, name: "Priya Nair" });
    fireEvent.click(screen.getByRole("button", { name: "Jobs and assignments: Manage. Change level" }));
    const sheet = await screen.findByRole("dialog", { name: "Jobs and assignments" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Cancel jobs/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /What Priya can do/ }));
    const summary = await screen.findByRole("dialog", { name: "What Priya can do" });
    expect(within(summary).getByRole("link", { name: "Test as Priya" })).toHaveAttribute("href", "/v2/admin/system/test-as?user=priya");
    fireEvent.click(within(summary).getByRole("button", { name: "Close what priya can do" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to people" }));
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("Switched off: Cancel jobs");
    fireEvent.click(screen.getByRole("button", { name: "More access actions" }));
    const menu = screen.getByRole("menu", { name: "More access actions" });
    expect(within(menu).getByRole("menuitem", { name: "Presets" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Give office access" })).toHaveAttribute("href", "/v2/admin/accounts");
  });

  it("By area uses the same level sheet per person", async () => {
    setPhone(true);
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
    fireEvent.click(screen.getByRole("tab", { name: "By area" }));
    fireEvent.click(screen.getByRole("button", { name: "Chloe Martin, Jobs and assignments: Manage. Change level" }));
    const sheet = await screen.findByRole("dialog", { name: "Chloe Martin" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "View" }));
    expect(within(sheet).getByRole("radio", { name: "View" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("Chloe Martin: Jobs and assignments: Manage → View");
  });

  it("from 640px up keeps the matrix, the side column and the inline header buttons", async () => {
    setPhone(false);
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
    fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
    await screen.findByRole("heading", { level: 2, name: "Priya Nair" });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "People with office access" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Effective access" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to people" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More access actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /What Priya can do/ })).toBeNull();
  });
});
