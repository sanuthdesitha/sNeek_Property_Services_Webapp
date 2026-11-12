/**
 * Owner decision 2026-11-12: Resolve, bulk Close and Reminder settings show
 * for whoever the server says may manage urgent stock (ADMIN, or an
 * operations manager with the inventory pack at manage), not by role name.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UrgentNeedsWorkspace } from "@/components/v2/admin/inventory/urgent/urgent-needs-workspace";
import { readUrgentView } from "@/components/v2/admin/inventory/urgent/urgent-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/v2/admin/inventory", useSearchParams: () => new URLSearchParams("tab=urgent-stock") }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubList() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 25, counts: {}, summary: { open: 0, properties: 0, dueSoon: 0 }, propertyOptions: [], timeZone: "Australia/Sydney" }))));
}

it("shows Reminder settings when the server allows managing urgent stock", async () => {
  stubList();
  render(<UrgentNeedsWorkspace initialView={readUrgentView("")} tabs={null} timeZone="Australia/Sydney" canResolve canEditReminders />);
  expect(await screen.findByRole("button", { name: "Reminder settings" })).toBeTruthy();
});

it("hides Reminder settings for read-only access", async () => {
  stubList();
  render(<UrgentNeedsWorkspace initialView={readUrgentView("")} tabs={null} timeZone="Australia/Sydney" canResolve={false} canEditReminders={false} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Report a need" })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Reminder settings" })).toBeNull();
});
