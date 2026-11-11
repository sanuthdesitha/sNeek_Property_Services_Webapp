import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: async () => null }));
vi.mock("@/lib/forms/library-tab-counts", () => ({ getFormsTabCounts: async () => ({ forms: 0, qa: 1 }) }));
vi.mock("@/components/v2/admin/forms/library/form-stats-panel", () => ({ FormStatsPanel: () => null }));
vi.mock("@/components/v2/admin/forms/library/forms-subviews", () => ({ ChecklistBlocksTab: () => null, MessageTemplatesTab: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admin/forms", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=qa") }));

import EstateFormsPage from "@/app/v2/admin/forms/page";
import { QaTemplatesManager } from "@/components/v2/admin/qa/qa-templates-manager";

const qaTemplate = { id: "q1", name: "Default QA", serviceType: "AIRBNB_TURNOVER", propertyId: null, property: null, version: 2, isActive: true, schema: { sections: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  m.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ templates: [qaTemplate], properties: [], jobTypes: [] }) }));
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("hides create, edit and reset and locks the switch when the API would refuse the write", async () => {
  render(<QaTemplatesManager canWrite={false} />);
  expect(await screen.findByText("Default QA")).toBeVisible();
  for (const name of [/New template/, /Edit/, /Reset/, /More actions/]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.getByText("Read only")).toBeVisible();
  expect(screen.getByRole("switch")).toBeDisabled();
});

// 2026-11 builder step: Edit and Reset moved into the row's "More actions"
// menu beside Duplicate and Delete; the admin still gets every control.
it("keeps every control for admins", async () => {
  render(<QaTemplatesManager canWrite />);
  expect(await screen.findByText("Default QA")).toBeVisible();
  expect(screen.getByRole("button", { name: /New template/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "More actions for Default QA" }));
  for (const name of ["Edit", "Duplicate", "Reset to default", "Delete"]) expect(screen.getByRole("menuitem", { name })).toBeVisible();
  expect(screen.getByRole("switch")).toBeEnabled();
});

it.each([
  [{ role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }, false],
  [{ role: "ADMIN" }, true],
] as const)("the QA templates tab decides write controls from the server-side role %j", async (user, writes) => {
  m.role.mockResolvedValue({ user });
  render(await EstateFormsPage({ searchParams: { tab: "qa" } }));
  expect(await screen.findByText("Default QA")).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(Boolean(screen.queryByRole("button", { name: /New template/ }))).toBe(writes);
});
