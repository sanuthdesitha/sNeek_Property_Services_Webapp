import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("@/components/v2/admin/laundry/laundry-live", () => ({ LaundryLive: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-reports", () => ({ LaundryReports: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-new-run", () => ({ LaundryNewRun: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-edit-dialog", () => ({ LaundryEditDialog: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-suppliers", () => ({ LaundrySuppliers: () => null }));
vi.mock("@/components/v2/laundry/laundry-delete-dialog", () => ({ useLaundryDeleteDialog: () => ({ requestDelete: vi.fn(), modal: null }) }));
vi.mock("@/components/shared/media-gallery", () => ({ MediaGallery: () => null }));
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";

// Changed on purpose with the redesign: "Investigate property" is now the
// "By property" tab, fed by the shared week feed (loaded once, only when a tab
// that needs it is open) instead of the old Active runs list.
it("opens By property from the Estate workspace using the existing read-only feed", async () => {
  const feed = [{ id: "r", property: { id: "p", name: "P11" }, status: "CONFIRMED", pickupDate: "2026-10-04", dropoffDate: "2026-10-06" }];
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).startsWith("/api/laundry/week") ? feed : { error: "n/a" }) }));
  vi.stubGlobal("fetch", fetcher);
  try {
    render(<LaundryWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "By property" }));
    await screen.findByRole("option", { name: "P11" });
    fireEvent.change(screen.getByLabelText("Property"), { target: { value: "p" } });
    expect(screen.getByRole("article", { name: "Laundry run r" })).toBeInTheDocument();
    const feedCalls = fetcher.mock.calls.filter(([url]) => String(url).startsWith("/api/laundry/week"));
    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).startsWith("/api/admin/laundry/pipeline"))).toBe(true));
  } finally {
    vi.unstubAllGlobals();
  }
});
