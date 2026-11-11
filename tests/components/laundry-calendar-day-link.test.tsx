import { expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
vi.mock("@/components/v2/admin/laundry/laundry-live", () => ({ LaundryLive: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-reports", () => ({ LaundryReports: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-new-run", () => ({ LaundryNewRun: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-edit-dialog", () => ({ LaundryEditDialog: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-suppliers", () => ({ LaundrySuppliers: () => null }));
vi.mock("@/components/v2/laundry/laundry-delete-dialog", () => ({ useLaundryDeleteDialog: () => ({ requestDelete: vi.fn(), modal: null }) }));
vi.mock("@/components/shared/media-gallery", () => ({ MediaGallery: () => null }));
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";

it("opens the one day a Calendar laundry-run link names (?date=)", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => [] }));
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState(null, "", "/v2/admin/laundry?date=2026-11-12");
  try {
    render(<LaundryWorkspace />);
    // Sydney midnight of 12 Nov (AEDT) is 13:00 UTC on the 11th; one day only.
    await waitFor(() => expect(fetcher.mock.calls.map((call) => String((call as unknown[])[0]))).toContain("/api/laundry/week?start=2026-11-11T13:00:00.000Z&days=1"));
  } finally {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  }
});
