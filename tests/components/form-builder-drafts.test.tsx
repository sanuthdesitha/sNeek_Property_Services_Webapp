import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: m.refresh }), usePathname: () => "/v2/admin/forms/t/edit", useSearchParams: () => new URLSearchParams() }));

import { EstateFormBuilder } from "@/components/v2/admin/forms/builder/form-builder";

const schema = { standardSections: false as const, sections: [{ id: "s", title: "Kitchen", fields: [{ id: "f", type: "checkbox" as const, label: "Bins" }] }] };

function renderBuilder(hasDraft: boolean) {
  return render(
    <EstateFormBuilder
      templateId="t"
      initialName="Turnover"
      initialKind="CUSTOM"
      initialServiceType="AIRBNB_TURNOVER"
      initialVersion={4}
      initialSchema={schema}
      initialIsActive
      initialArchived={false}
      initialUpdatedAt="2026-11-01T00:00:00.000Z"
      initialHasDraft={hasDraft}
    />,
  );
}

const calls = (fragment: string) => m.fetch.mock.calls.filter(([url]) => String(url).includes(fragment));

beforeEach(() => {
  vi.clearAllMocks();
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/draft")) return { ok: true, status: 200, json: async () => ({ updatedAt: "2026-11-02T00:00:00.000Z", editToken: "2026-11-02T00:00:00.000Z" }) };
    if (String(url).endsWith("/publish")) return { ok: true, status: 200, json: async () => ({ template: { isActive: true, archivedAt: null }, archivedPrevious: 0, publishedVersion: 5, editToken: "2026-11-03T00:00:00.000Z" }) };
    return { ok: false, status: 404, json: async () => ({ error: `unexpected ${init?.method ?? "GET"}` }) };
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("saves to the draft version with the edit token, never the live template", async () => {
  renderBuilder(false);
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Turnover v2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(calls("/draft")).toHaveLength(1));
  const [, init] = calls("/draft")[0];
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toMatchObject({ name: "Turnover v2", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" });
  expect(m.fetch.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
  expect(await screen.findByText("Unpublished changes")).toBeVisible();
});

it("publishes a saved draft with the current token, and not while edits are unsaved", async () => {
  renderBuilder(true);
  const publish = screen.getByRole("button", { name: "Publish changes" });
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Edited" } });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish changes" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Publish changes" }));
  await waitFor(() => expect(calls("/publish")).toHaveLength(1));
  expect(JSON.parse(calls("/publish")[0][1].body)).toEqual({ action: "publish", expectedUpdatedAt: "2026-11-02T00:00:00.000Z" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Publish changes" })).toBeNull());
});
