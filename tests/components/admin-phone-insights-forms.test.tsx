/**
 * Insights, the Forms library and the template builder on a phone (board
 * "M-InsightsForms", 2026-11; owner decision: the builder is fully editable
 * on a phone). Insights keeps the period and client controls and moves Export
 * and the monthly email into "⋯"; Forms moves Import into "⋯", docks New form
 * and puts groups behind the "All forms" picker; the builder becomes stacked
 * screens (outline, questions, question editor, preview) whose edits go
 * through the same operations, so the saved draft is the same as on desktop.
 * Nothing changes from 640px up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/v2/admin/forms",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/v2/admin/reports/reports-manager", () => ({ ReportsManager: () => null }));

import { InsightsPage } from "@/components/v2/admin/insights/insights-page";
import { FormsHeaderActions } from "@/components/v2/admin/forms/library/forms-header-actions";
import { FormsGroupsPicker, groupsPickerLabel } from "@/components/v2/admin/forms/library/forms-groups-picker";
import { EstateFormBuilder } from "@/components/v2/admin/forms/builder/form-builder";
import { moveSectionBy } from "@/lib/forms/builder-ops";
import type { FormSchema } from "@/lib/forms/types";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  m.fetch.mockReset();
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (String(url).endsWith("/t/draft") && method === "PUT") return ok({ updatedAt: "2026-11-02T00:00:00.000Z", editToken: "2026-11-02T00:00:00.000Z" });
    return { ok: false, status: 404, json: async () => ({ error: `unexpected ${method} ${url}` }) };
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Insights on a phone", () => {
  const context = { access: { finance: true }, canManageReports: true, timeZone: "Australia/Sydney", monthlyEmail: { enabled: true, canConfigure: true } };

  it("keeps the period and client controls and moves Export and the monthly email into the header menu", async () => {
    setPhone(true);
    render(<InsightsPage context={context} />);
    expect(screen.getByRole("group", { name: /Period/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Client: all" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Export/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More Insights actions" }));
    const sheet = await screen.findByRole("dialog", { name: "Insights" });
    expect(within(sheet).getByRole("link", { name: /Export/ }).getAttribute("href")).toMatch(/^\/api\/admin\/insights\/export\?/);
    expect(within(sheet).getByRole("link", { name: /Email monthly/ }).getAttribute("href")).toBe("/v2/admin/settings?tab=insights-email");
  });

  it("from 640px up keeps Export and Email monthly in the header", () => {
    setPhone(false);
    render(<InsightsPage context={context} />);
    expect(screen.getByRole("link", { name: /Export/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Email monthly/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More Insights actions" })).toBeNull();
  });
});

describe("Forms library on a phone", () => {
  it("moves Import into the header menu (same dialog) and docks New form with the same items", async () => {
    setPhone(true);
    render(<FormsHeaderActions canImport canQa canMessages />);
    const bar = screen.getByRole("region", { name: "Forms actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "New form" }));
    expect(await screen.findByRole("menuitem", { name: "Job form (blank, starter or copy)" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "QA template" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More forms actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Import forms…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Import forms")).toBeTruthy();
  });

  it("from 640px up keeps Import and New form in the header", () => {
    setPhone(false);
    render(<FormsHeaderActions canImport canQa canMessages />);
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New form" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Forms actions" })).toBeNull();
  });

  it("names the current group in the All forms picker and opens the same groups panel", () => {
    const groups = [{ id: "g1", name: "Airbnb", formCount: 4, sortOrder: 0 }];
    const counts = { active: 18, drafts: 2, archived: 3, problems: 1, byGroup: { g1: 4 }, tags: [] };
    expect(groupsPickerLabel({ groups, counts, scope: "active", group: "" } as never)).toEqual({ label: "All forms", count: 18 });
    expect(groupsPickerLabel({ groups, counts, scope: "active", group: "g1" } as never)).toEqual({ label: "Airbnb", count: 4 });
    expect(groupsPickerLabel({ groups, counts, scope: "drafts", group: "" } as never)).toEqual({ label: "Drafts", count: 2 });
    const onSelect = vi.fn();
    render(<FormsGroupsPicker groups={groups as never} groupsError={null} counts={counts as never} scope="active" group="" tag="" canWrite onSelect={onSelect} onTag={vi.fn()} onGroupsChanged={vi.fn()} />);
    const picker = screen.getByRole("button", { name: /Groups: All forms/ });
    fireEvent.click(picker);
    expect(picker).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Archived/ }));
    expect(onSelect).toHaveBeenCalledWith({ scope: "archived", group: "" });
    expect(picker).toHaveAttribute("aria-expanded", "false");
  });
});

const SCHEMA: FormSchema = {
  standardSections: false,
  sections: [
    { id: "s1", title: "Arrival", fields: [{ id: "a", type: "checkbox", label: "Keys collected" }] },
    { id: "s2", title: "Kitchen", fields: [{ id: "f", type: "checkbox", label: "Bins" }, { id: "g", type: "yesno", label: "Oven cleaned", required: true }] },
  ],
};

function renderBuilder() {
  return render(
    <EstateFormBuilder
      templateId="t"
      initialName="Turnover"
      initialKind="CUSTOM"
      initialServiceType="AIRBNB_TURNOVER"
      initialVersion={4}
      initialSchema={SCHEMA}
      initialIsActive
      initialArchived={false}
      initialUpdatedAt="2026-11-01T00:00:00.000Z"
      usage={{ usage: { kind: "default", properties: 21 }, neverAnswered: [], usageSample: 0, timezone: "Australia/Sydney" }}
    />,
  );
}

const draftPuts = () => m.fetch.mock.calls.filter(([url, init]) => String(url).endsWith("/t/draft") && init?.method === "PUT");
async function savedSchema(): Promise<FormSchema> {
  await waitFor(() => expect(draftPuts().length).toBeGreaterThan(0), { timeout: 4000 });
  return JSON.parse(String(draftPuts()[draftPuts().length - 1][1].body)).schema as FormSchema;
}

describe("the template builder on a phone", () => {
  it("is stacked screens: outline, then a section's questions, then the question editor, and back", async () => {
    setPhone(true);
    renderBuilder();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Builder panes" })).toBeNull();
    const outline = await screen.findByRole("region", { name: "Outline" });
    fireEvent.click(within(outline).getByRole("button", { name: /^Kitchen/ }));
    const questions = await screen.findByRole("region", { name: "Section questions" });
    expect(within(questions).getByRole("heading", { name: "Kitchen" })).toBeTruthy();
    fireEvent.click(within(questions).getByRole("button", { name: "Oven cleaned" }));
    const editor = await screen.findByRole("region", { name: "Question settings" });
    expect(within(editor).getByRole("heading", { name: "Oven cleaned" })).toBeTruthy();
    expect(within(editor).getByText("Kitchen · question 2 of 2")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: /Move down/ })).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "Back to questions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to outline" }));
    expect(await screen.findByRole("region", { name: "Outline" })).toBeTruthy();
  });

  it("moves a section with the existing reorder (no dragging)", async () => {
    setPhone(true);
    renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: "Move Arrival down" }));
    expect((await savedSchema()).sections).toEqual(moveSectionBy(SCHEMA, "s1", 1).sections);
    expect(screen.getByRole("button", { name: "Move Arrival up" })).not.toBeDisabled();
  });

  it("moves a question with the question editor's Move up", async () => {
    setPhone(true);
    renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oven cleaned" }));
    fireEvent.click(await screen.findByRole("button", { name: /Move up/ }));
    const saved = await savedSchema();
    expect(saved.sections[1].fields.map((field) => field.id)).toEqual(["g", "f"]);
  });

  it("saves the same draft from the phone question editor as from the desktop pane for the same edit", async () => {
    async function editLabel(): Promise<FormSchema> {
      const label = await screen.findByDisplayValue("Oven cleaned");
      fireEvent.change(label, { target: { value: "Oven cleaned inside" } });
      return savedSchema();
    }
    setPhone(true);
    renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oven cleaned" }));
    const fromPhone = await editLabel();
    cleanup();
    m.fetch.mockClear();

    setPhone(false);
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Oven cleaned" }));
    const fromDesktop = await editLabel();
    expect(fromPhone).toEqual(fromDesktop);
    expect(fromPhone.sections[1].fields[1].label).toBe("Oven cleaned inside");
  });

  it("keeps every header action: Undo, Redo, Versions and the More items in one menu, Test and Publish at the bottom", async () => {
    setPhone(true);
    renderBuilder();
    const bar = screen.getByRole("region", { name: "Test and publish" });
    expect(within(bar).getByRole("button", { name: "Test as cleaner" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Published" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "More form actions" }));
    for (const name of ["Undo", "Redo", "Versions", "Form settings (name, service type, theme)", "Duplicate form", "Archive", "Discard unpublished changes"]) {
      expect(await screen.findByRole("menuitem", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })).toBeTruthy();
    }
  });

  it("offers every question type, headings, dividers and saved blocks in the Add a question sheet", async () => {
    setPhone(true);
    renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add a question to Kitchen" }));
    const sheet = await screen.findByRole("dialog", { name: "Add to Kitchen" });
    for (const name of ["Tick", "Scan", "Heading", "Divider", "Insert saved block…"]) expect(within(sheet).getByRole("button", { name })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Tick" }));
    expect(await screen.findByRole("region", { name: "Question settings" })).toBeTruthy();
    expect((await savedSchema()).sections[1].fields).toHaveLength(3);
  });

  // Owner's phone screenshots (2026-11-13): a question row put handle,
  // checkbox, type, wording, pills, chevron and menu on one line, so the
  // wording collapsed to one letter per line.
  it("lays a question row out as a two-line card on a phone: the wording alone on line 1, type and pills on line 2", async () => {
    setPhone(true);
    renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: /^Kitchen/ }));
    const questions = await screen.findByRole("region", { name: "Section questions" });
    const wording = within(questions).getByRole("button", { name: "Oven cleaned" });
    const row = wording.closest("[data-question-row-layout]") as HTMLElement;
    expect(row.className).toMatch(/max-sm:grid\b/);
    expect(row.className).toMatch(/max-sm:grid-cols-\[2\.75rem_2\.75rem_auto_minmax\(0,1fr\)_2\.75rem\]/);
    // Line 1: the wording spans the type and pills columns; never squeezed by them.
    expect(wording.className).toMatch(/max-sm:row-start-1/);
    expect(wording.className).toMatch(/max-sm:col-span-2/);
    expect(wording.className).toMatch(/min-w-0/);
    expect(wording.className).toMatch(/max-sm:line-clamp-3/);
    // Line 2: type and pills.
    const type = row.querySelector("[data-question-row-type]") as HTMLElement;
    expect(type.textContent).toBe("Yes / No");
    expect(type.className).toMatch(/max-sm:row-start-2/);
    expect(within(row).getByText("Required").closest("span.flex")?.className).toMatch(/max-sm:row-start-2/);
    // Controls are 44px targets.
    for (const name of [/^Drag "Oven cleaned"/, /^Expand "Oven cleaned"/, /^More actions for "Oven cleaned"/]) {
      expect(within(row).getByRole("button", { name }).className).toMatch(/max-sm:(size-11|h-11)/);
    }
    expect(within(row).getByRole("checkbox", { name: 'Select "Oven cleaned"' }).closest("label")?.className).toMatch(/max-sm:size-11/);
    // From 640px up the row is the one-line flex row it was.
    expect(row.className).toMatch(/(^| )flex( |$)/);
    expect(row.className).toMatch(/sm:flex-nowrap/);
  });

  it("keeps the question editor in normal flow on a phone (the page scrolls), names the question once, and clears the docked bars", async () => {
    setPhone(true);
    const { container } = renderBuilder();
    fireEvent.click(await screen.findByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Oven cleaned" }));
    const editor = await screen.findByRole("region", { name: "Question settings" });
    const frame = editor.querySelector("[data-builder-editor-frame]") as HTMLElement;
    expect(frame.className).toMatch(/max-sm:max-h-none/);
    expect(frame.className).toMatch(/max-sm:overflow-visible/);
    const body = editor.querySelector("[data-properties-panel-body]") as HTMLElement;
    expect(body.className).toMatch(/max-sm:overflow-visible/);
    // The last controls of the screen come after the editor, inside the same flow.
    const moveDown = within(editor).getByRole("button", { name: /Move down/ });
    expect(frame.compareDocumentPosition(moveDown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Shown once in full: the title bar wraps instead of truncating, and the panel header hides its copy on a phone.
    expect((editor.querySelector("[data-builder-question-title]") as HTMLElement).className).toMatch(/whitespace-normal/);
    const panelName = within(editor).getAllByText("Oven cleaned").find((node) => node.tagName === "P");
    expect(panelName?.className).toMatch(/max-sm:hidden/);
    // The action bar and its spacer come at the END of the page, after a safe-area clearance.
    const bar = screen.getByRole("region", { name: "Test and publish" });
    const clearance = container.querySelector("[data-builder-dock-clearance]") as HTMLElement;
    expect(clearance.className).toMatch(/safe-area-inset-bottom/);
    expect(editor.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-builder-phone-header]")?.nextElementSibling?.getAttribute("aria-hidden")).not.toBe("true");
  });

  it("from 640px up bounds the editor frame as a flex column so the settings panel scrolls to its last field", () => {
    setPhone(false);
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: /^Kitchen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Oven cleaned" }));
    const aside = screen.getByRole("complementary", { name: "Settings for selection" });
    const frame = aside.querySelector("[data-builder-editor-frame]") as HTMLElement;
    expect(frame.className).toMatch(/(^| )flex( |$)/);
    expect(frame.className).toMatch(/flex-col/);
    expect(frame.className).toMatch(/lg:max-h-\[calc\(100vh-14rem\)\]/);
    expect((aside.querySelector("[data-properties-panel]") as HTMLElement).className).toMatch(/min-h-0/);
    expect((aside.querySelector("[data-properties-panel-body]") as HTMLElement).className).toMatch(/overflow-y-auto/);
  });

  it("from 640px up keeps the three panes and the pane tabs", () => {
    setPhone(false);
    const { container } = renderBuilder();
    expect(screen.getByRole("navigation", { name: "Builder panes" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Outline" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Settings for selection" })).toBeTruthy();
    expect(container.querySelector("[data-builder-phone-screen]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Test and publish" })).toBeNull();
    expect(screen.getByRole("link", { name: "← Forms" })).toBeTruthy();
  });
});
