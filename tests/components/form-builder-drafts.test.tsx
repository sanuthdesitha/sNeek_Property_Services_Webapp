// Builder step (2026-11): the builder now autosaves the DRAFT (no "Save draft"
// button) and publishes through a dialog ("Publish vN"). The intent of the
// original tests is kept: every save goes to the draft with the edit token,
// never the live PATCH, and publishing sends the current token and is not
// possible while edits are unsaved.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }), usePathname: () => "/v2/admin/forms/t/edit", useSearchParams: () => new URLSearchParams() }));

import { EstateFormBuilder } from "@/components/v2/admin/forms/builder/form-builder";
import type { FormSchema } from "@/lib/forms/types";

const schema: FormSchema = {
  standardSections: false,
  sections: [{ id: "s", title: "Kitchen", fields: [{ id: "f", type: "checkbox", label: "Bins" }, { id: "g", type: "yesno", label: "Oven cleaned", required: true }] }],
};

function renderBuilder(options: { hasDraft?: boolean; schema?: FormSchema } = {}) {
  return render(
    <EstateFormBuilder
      templateId="t"
      initialName="Turnover"
      initialKind="CUSTOM"
      initialServiceType="AIRBNB_TURNOVER"
      initialVersion={4}
      initialSchema={options.schema ?? schema}
      initialIsActive
      initialArchived={false}
      initialUpdatedAt="2026-11-01T00:00:00.000Z"
      initialHasDraft={options.hasDraft ?? false}
      usage={{ usage: { kind: "default", properties: 21 }, neverAnswered: [], usageSample: 0, timezone: "Australia/Sydney" }}
    />,
  );
}

const calls = (fragment: string, method?: string) =>
  m.fetch.mock.calls.filter(([url, init]) => String(url).includes(fragment) && (!method || (init?.method ?? "GET") === method));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let draftResponse: () => unknown;
beforeEach(() => {
  vi.clearAllMocks();
  draftResponse = () => ok({ updatedAt: "2026-11-02T00:00:00.000Z", editToken: "2026-11-02T00:00:00.000Z" });
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (String(url).endsWith("/t/draft") && method === "PUT") return draftResponse();
    if (String(url).endsWith("/publish")) return ok({ template: { isActive: true, archivedAt: null, version: 5 }, archivedPrevious: 0, publishedVersion: 5, editToken: "2026-11-03T00:00:00.000Z" });
    if (String(url).endsWith("/t/duplicate")) return { ok: true, status: 201, json: async () => ({ template: { id: "copy" } }) };
    if (String(url).endsWith("/copy/draft")) return ok({ editToken: "x" });
    return { ok: false, status: 404, json: async () => ({ error: `unexpected ${method} ${url}` }) };
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const addTick = () => fireEvent.click(screen.getByRole("button", { name: "Tick" }));

it("renders the design's page: one h1 with the state pill, real usage, and no second main landmark", () => {
  const { container } = renderBuilder();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Turnover");
  expect(screen.getByText("Live v4")).toBeVisible();
  expect(screen.getByText(/v4 is live on 21 properties/)).toBeVisible();
  expect(container.querySelector("main")).toBeNull();
  expect(screen.getByRole("link", { name: "← Forms" })).toHaveAttribute("href", "/v2/admin/forms");
});

it("autosaves edits to the draft version with the edit token, never the live template", async () => {
  renderBuilder();
  addTick();
  expect(screen.getByText("Draft of v5")).toBeVisible();
  await waitFor(() => expect(calls("/t/draft", "PUT")).toHaveLength(1), { timeout: 4000 });
  const body = JSON.parse(String(calls("/t/draft", "PUT")[0][1].body));
  expect(body.expectedUpdatedAt).toBe("2026-11-01T00:00:00.000Z");
  expect(body.schema.sections[0].fields).toHaveLength(3);
  expect(m.fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  expect(await screen.findByText(/draft saved/)).toBeVisible();
});

it("publishes with the current token, and only after the edits are saved", async () => {
  renderBuilder({ hasDraft: true });
  addTick();
  fireEvent.click(screen.getByRole("button", { name: "Publish v5" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Publish v5" }));
  await waitFor(() => expect(calls("/publish")).toHaveLength(1), { timeout: 4000 });
  // The pending edit was saved first; publish carries the token that save returned.
  expect(calls("/t/draft", "PUT")).toHaveLength(1);
  expect(JSON.parse(String(calls("/publish")[0][1].body))).toEqual({ action: "publish", expectedUpdatedAt: "2026-11-02T00:00:00.000Z" });
  expect(await screen.findByText("Live v5")).toBeVisible();
});

it("blocks publishing while a check error exists", async () => {
  const broken: FormSchema = { standardSections: false, sections: [{ id: "s", title: "Kitchen", fields: [{ id: "dup", type: "checkbox", label: "A" }, { id: "dup", type: "checkbox", label: "B" }] }] };
  renderBuilder({ hasDraft: true, schema: broken });
  fireEvent.click(screen.getByRole("button", { name: "Publish v5" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/Fix \d+ problem/)).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Publish v5" })).toBeDisabled();
  expect(calls("/publish")).toHaveLength(0);
});

it("stops autosave on a stale-write conflict and offers Reload theirs / Keep mine as a copy", async () => {
  draftResponse = () => ({ ok: false, status: 409, json: async () => ({ code: "STALE_TEMPLATE", error: "This template changed since you opened it." }) });
  renderBuilder();
  addTick();
  expect(await screen.findByText(/changed in another tab/, undefined, { timeout: 4000 })).toBeVisible();
  addTick();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  expect(calls("/t/draft", "PUT")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Reload theirs" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep mine as a copy" }));
  await waitFor(() => expect(m.push).toHaveBeenCalledWith("/v2/admin/forms/copy/edit"));
  const copyBody = JSON.parse(String(calls("/copy/draft")[0][1].body));
  expect(copyBody.schema.sections[0].fields).toHaveLength(4);
  expect(copyBody.expectedUpdatedAt).toBeUndefined();
}, 10000);

it("keeps edits after a failed save and retries on request", async () => {
  draftResponse = () => ({ ok: false, status: 500, json: async () => ({ error: "Database unavailable." }) });
  renderBuilder();
  addTick();
  expect(await screen.findByText("The draft was not saved.", undefined, { timeout: 4000 })).toBeVisible();
  expect(screen.getByText("draft NOT saved")).toBeVisible();
  draftResponse = () => ok({ editToken: "2026-11-02T00:00:00.000Z" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(calls("/t/draft", "PUT")).toHaveLength(2));
  expect(JSON.parse(String(calls("/t/draft", "PUT")[1][1].body)).schema.sections[0].fields).toHaveLength(3);
});

it("undoes and redoes edits with the buttons and the scoped keyboard shortcut", () => {
  const { container } = renderBuilder();
  addTick();
  expect(screen.getAllByRole("checkbox", { name: /^Select "/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getAllByRole("checkbox", { name: /^Select "/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.getAllByRole("checkbox", { name: /^Select "/ })).toHaveLength(3);
  const root = container.firstElementChild as HTMLElement;
  fireEvent.keyDown(root, { key: "z", ctrlKey: true });
  expect(screen.getAllByRole("checkbox", { name: /^Select "/ })).toHaveLength(2);
  // Inside a text input the browser's own undo is left alone.
  const search = document.createElement("input");
  root.appendChild(search);
  fireEvent.keyDown(search, { key: "z", ctrlKey: true, shiftKey: true });
  expect(screen.getAllByRole("checkbox", { name: /^Select "/ })).toHaveLength(2);
});

it("edits several questions together: mixed values shown, only the changed setting written", async () => {
  renderBuilder();
  fireEvent.click(screen.getByRole("checkbox", { name: 'Select "Bins"' }));
  fireEvent.click(screen.getByRole("checkbox", { name: 'Select "Oven cleaned"' }));
  expect(screen.getByText("Editing 2 questions together")).toBeVisible();
  expect(screen.getByText("(mixed)")).toBeVisible();
  expect(screen.getByText("2 questions selected")).toBeVisible();
  fireEvent.click(screen.getByLabelText(/^Required/));
  await waitFor(() => expect(calls("/t/draft", "PUT")).toHaveLength(1), { timeout: 4000 });
  const fields = JSON.parse(String(calls("/t/draft", "PUT")[0][1].body)).schema.sections[0].fields;
  expect(fields).toEqual([
    { id: "f", type: "checkbox", label: "Bins", required: true },
    { id: "g", type: "yesno", label: "Oven cleaned", required: true },
  ]);
});
