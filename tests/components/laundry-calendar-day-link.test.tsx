import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
vi.mock("@/components/v2/admin/laundry/laundry-live", () => ({ LaundryLive: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-reports", () => ({ LaundryReports: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-new-run", () => ({ LaundryNewRun: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-edit-dialog", () => ({ LaundryEditDialog: () => null }));
vi.mock("@/components/v2/admin/laundry/laundry-suppliers", () => ({ LaundrySuppliers: () => null }));
vi.mock("@/components/v2/laundry/laundry-delete-dialog", () => ({ useLaundryDeleteDialog: () => ({ requestDelete: vi.fn(), modal: null }) }));
vi.mock("@/components/shared/media-gallery", () => ({ MediaGallery: () => null }));
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";

// Changed on purpose with the redesign: the Calendar's `?date=` link now opens
// the Pipeline on that one Sydney day (it used to set the Active runs range).
it("opens the one day a Calendar laundry-run link names (?date=)", async () => {
  const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: "x" }) }));
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState(null, "", "/v2/admin/laundry?date=2026-11-12&tab=suppliers");
  try {
    render(<LaundryWorkspace />);
    await waitFor(() => expect(fetcher.mock.calls.map((call) => String((call as unknown[])[0]))).toContain("/api/admin/laundry/pipeline?date=2026-11-12"));
    expect(screen.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Thu 12 Nov/)).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  }
});
