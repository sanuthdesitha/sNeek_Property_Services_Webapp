/**
 * Settings > Access and permissions (replaces tests/components/ops-permissions.test.tsx,
 * keeping its guarantees: a failed or conflicting save keeps the draft and never
 * overwrites another administrator's work; custom presets save with their levels).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  viewer: { id: "hannah", isAdmin: true, grants: ["accounts.reset_password", "accounts.reset_two_step", "access.test_as", "access.edit_permissions"] },
  timeZone: "Australia/Sydney",
});

let fetcher: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  fetcher = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "PUT" ? json({ error: "unexpected" }, 500) : json(screenData())));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

async function openPriya() {
  render(<AccessWorkspace />);
  await screen.findByRole("heading", { level: 1, name: "Access and permissions" });
  fireEvent.click(screen.getByRole("button", { name: /Priya Nair/ }));
  await screen.findByRole("heading", { level: 2, name: "Priya Nair" });
}
function financeLevel(name: "Off" | "View" | "Manage" | "Full") {
  return within(screen.getByRole("radiogroup", { name: "Finance and invoicing level" })).getByRole("radio", { name });
}
async function unfoldMoney() {
  fireEvent.click(screen.getAllByRole("button", { name: /^Show \d areas?$/ }).find((button) => button.closest("tr")?.textContent?.includes("Finance and invoicing"))!);
}

describe("access matrix", () => {
  it("groups people, folds Off areas, and marks an unsaved level with its old value", async () => {
    await openPriya();
    expect(screen.getByText(/Administrators 1/)).toBeInTheDocument();
    expect(screen.getByText(/Office assistants 1/)).toBeInTheDocument();
    expect(screen.getByText(/Operations managers 1/)).toBeInTheDocument();
    expect(screen.getByText("Assistant: bookings · 11 of 34 areas")).toBeInTheDocument();
    await unfoldMoney();
    fireEvent.click(financeLevel("View"));
    expect(financeLevel("View")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Was Off · not saved")).toBeInTheDocument();
    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(bar).toHaveTextContent("1 unsaved change");
    expect(bar).toHaveTextContent("Priya Nair: Finance and invoicing: Off → View");
  });

  it("writes what the person can do and marks new lines", async () => {
    await openPriya();
    const panel = screen.getByRole("complementary", { name: "Effective access" });
    expect(within(panel).getByText("Create, reschedule and assign jobs")).toBeInTheDocument();
    await unfoldMoney();
    fireEvent.click(financeLevel("Manage"));
    const line = within(panel).getByText("Work on client invoices and subscriptions");
    expect(line.closest("li")).toHaveTextContent("New");
  });

  it("shows capabilities with what each needs, and switches one off", async () => {
    await openPriya();
    fireEvent.click(screen.getByRole("button", { name: "Show Jobs and assignments capabilities" }));
    expect(screen.getByRole("checkbox", { name: /Delete jobs/ })).toBeDisabled();
    expect(screen.getAllByText("Needs Full").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /Cancel jobs/ }));
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent("Switched off: Cancel jobs");
  });

  it("shows administrators as full access that cannot be limited here", async () => {
    render(<AccessWorkspace />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Hannah Lee/ }));
    expect(await screen.findByText(/Full access \(administrator\)\./)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("copy access", () => {
  it("fills the person's draft from another person, without saving", async () => {
    await openPriya();
    fireEvent.click(screen.getAllByRole("button", { name: "Copy access from…" })[1]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Chloe Martin/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy access" }));
    expect(screen.getByLabelText("Start from")).toHaveValue("coordinator");
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toHaveTextContent(/Started from Coordinator/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });
});

describe("saving", () => {
  it("asks for the PIN, keeps the draft on a conflict and shows both versions before anything is overwritten", async () => {
    await openPriya();
    await unfoldMoney();
    fireEvent.click(financeLevel("View"));
    const theirs: OpsPolicy = { ...structuredClone(policy), revision: 3, assignments: { ...policy.assignments, chloe: { presetId: "observer", overrides: {} } } };
    fetcher.mockImplementationOnce(async () => json({ error: "Someone else saved", code: "OPS_POLICY_CONFLICT", current: theirs }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Your PIN or password"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByText("Someone else saved first");
    const body = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1].body);
    expect(body).toMatchObject({ security: { pin: "1234" }, policy: { revision: 2 } });
    expect(screen.getByRole("dialog")).toHaveTextContent("Chloe Martin: Started from Read only (was Coordinator)");
    expect(screen.getByRole("dialog")).toHaveTextContent("Priya Nair: Finance and invoicing: Off → View");
    fireEvent.click(screen.getByRole("button", { name: "Put my changes on top" }));
    await screen.findByText("Review and save access");
    expect(financeLevel("View")).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the draft after a failed save and freezes nothing afterwards", async () => {
    await openPriya();
    await unfoldMoney();
    fireEvent.click(financeLevel("View"));
    fireEvent.click(screen.getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Your PIN or password"), { target: { value: "hunter2-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("unexpected");
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1].body).security).toEqual({ password: "hunter2-password" });
    expect(financeLevel("View")).toHaveAttribute("aria-checked", "true");
  });

  it("creates a custom preset and saves its levels with the assignment", async () => {
    await openPriya();
    fireEvent.click(screen.getByRole("tab", { name: /Presets/ }));
    fireEvent.click(screen.getByRole("button", { name: "New preset" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dispatch team" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Dispatch team, Jobs and assignments level" })).getByRole("radio", { name: "View" }));
    fetcher.mockImplementationOnce(async (_url: string, init?: RequestInit) => json({ policy: { ...JSON.parse(String(init?.body)).policy, revision: 3 } }));
    fireEvent.click(screen.getByRole("button", { name: "Review and save" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Your PIN or password"), { target: { value: "1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const payload = JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1].body).policy;
    expect(payload.presets[0]).toMatchObject({ name: "Dispatch team", levels: { jobs: "read" } });
  });
});
