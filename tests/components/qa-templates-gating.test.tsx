import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: async () => null }));
vi.mock("@/lib/forms/library-tab-counts", () => ({ getFormsTabCounts: async () => ({ forms: 0, qa: 1, messages: null }) }));
vi.mock("@/components/v2/admin/forms/library/form-stats-panel", () => ({ FormStatsPanel: () => null }));
vi.mock("@/components/v2/admin/forms/library/forms-subviews", () => ({ ChecklistBlocksTab: () => null, MessageTemplatesTab: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admin/forms", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=qa") }));

import EstateFormsPage from "@/app/v2/admin/forms/page";
import { QaTemplatesManager } from "@/components/v2/admin/qa/qa-templates-manager";

const schema = { sections: [{ id: "k", label: "Kitchen", fields: [{ id: "b", label: "Benches", type: "rating", weight: 1, max: 5, required: true }] }] };
const qaTemplate = { id: "q1", name: "Default QA", serviceType: "AIRBNB_TURNOVER", propertyId: null, property: null, version: 2, isActive: true, schema, updatedAt: "2026-11-10T00:00:00.000Z", revisions: 4, inspections30d: 12 };
const overlapping = { ...qaTemplate, id: "q2", name: "Default QA, detailed", version: 1, revisions: 0, inspections30d: 0 };

function answer(templates: unknown[]) {
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { ok: true, status: 200, json: async () => ({ ...qaTemplate, revision: 5 }) };
    return { ok: true, status: 200, json: async () => ({ templates, properties: [], jobTypes: [] }) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  answer([qaTemplate]);
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function desktopTable() {
  return screen.getByRole("region", { name: "QA templates" });
}

it("hides create, reset and delete, locks the switch and opens the editor read only when the API would refuse the write", async () => {
  render(<QaTemplatesManager canWrite={false} />);
  await screen.findAllByText("Default QA");
  const table = desktopTable();
  expect(screen.queryByRole("button", { name: /New QA template/ })).toBeNull();
  expect(within(table).queryByRole("button", { name: /More actions/ })).toBeNull();
  expect(within(table).getByRole("switch")).toBeDisabled();
  fireEvent.click(within(table).getByRole("button", { name: "View Default QA" }));
  expect(await screen.findByRole("heading", { name: "Viewing Default QA" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Save as revision/ })).toBeNull();
  expect(screen.getByLabelText("Template name")).toBeDisabled();
});

// Board "QA templates" (2026-11-17): Edit is the row's own button; Duplicate,
// Reset to detailed default… and Delete… are in the row menu. "Used by" counts
// inspections in the last 30 days.
it("keeps every control for admins and shows Used by", async () => {
  render(<QaTemplatesManager canWrite />);
  await screen.findAllByText("Default QA");
  const table = desktopTable();
  expect(screen.getByRole("button", { name: /New QA template/ })).toBeEnabled();
  expect(within(table).getByText("12 inspections, 30 days")).toBeVisible();
  fireEvent.click(within(table).getByRole("button", { name: "More actions for Default QA" }));
  for (const name of ["Duplicate", "Reset to detailed default…", "Delete…"]) expect(screen.getByRole("menuitem", { name })).toBeVisible();
  expect(within(table).getByRole("switch")).toBeEnabled();
});

it("Reset is tier A and Delete is tier B with the switched-off rule written in the dialog", async () => {
  render(<QaTemplatesManager canWrite />);
  await screen.findAllByText("Default QA");
  fireEvent.click(within(desktopTable()).getByRole("button", { name: "More actions for Default QA" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/switched off instead so those inspections keep their template/)).toBeVisible();
  expect(within(dialog).getByText("Removes something")).toBeVisible();
});

it("names an overlap in one band and per row, and lets the editor save anyway (warns, never blocks)", async () => {
  answer([qaTemplate, overlapping]);
  render(<QaTemplatesManager canWrite />);
  await screen.findAllByText("Default QA, detailed");
  expect(screen.getByRole("heading", { name: "Two active templates share a job type and scope" })).toBeVisible();
  const table = desktopTable();
  expect(within(table).getByText("In use (overlap)")).toBeVisible();
  expect(within(table).getByText("Overlaps, not used")).toBeVisible();
  fireEvent.click(within(table).getByRole("button", { name: "Edit Default QA" }));
  expect(await screen.findByText(/Saving is still allowed/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Default QA v2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as revision 5" }));
  await waitFor(() => expect(m.fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const patch = m.fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(String(patch[1].body))).toMatchObject({ name: "Default QA v2", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" });
});

it("keeps the draft and offers their version when someone saved first (409)", async () => {
  render(<QaTemplatesManager canWrite />);
  await screen.findAllByText("Default QA");
  m.fetch.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "PATCH"
      ? { ok: false, status: 409, json: async () => ({ error: "Someone else saved this QA template.", current: { ...qaTemplate, name: "Theirs" } }) }
      : { ok: true, status: 200, json: async () => ({ templates: [qaTemplate], properties: [] }) },
  );
  fireEvent.click(within(desktopTable()).getByRole("button", { name: "Edit Default QA" }));
  fireEvent.change(await screen.findByLabelText("Template name"), { target: { value: "Mine" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as revision 5" }));
  expect(await screen.findByRole("button", { name: "Load their version" })).toBeVisible();
  expect(screen.getByLabelText("Template name")).toHaveValue("Mine");
});

it("never shows an unknown Used by as zero", async () => {
  answer([{ ...qaTemplate, inspections30d: null }]);
  render(<QaTemplatesManager canWrite />);
  await screen.findAllByText("Default QA");
  expect(within(desktopTable()).queryByText(/None in 30 days|0 inspections/)).toBeNull();
});

it.each([
  [{ role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }, false],
  [{ role: "ADMIN" }, true],
] as const)("the QA templates tab decides write controls from the server-side role %j", async (user, writes) => {
  m.role.mockResolvedValue({ user });
  render(await EstateFormsPage({ searchParams: { tab: "qa" } }));
  await screen.findAllByText("Default QA");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(Boolean(screen.queryByRole("button", { name: /New QA template/ }))).toBe(writes);
});
