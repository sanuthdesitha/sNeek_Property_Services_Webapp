import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LaundryActionModal } from "@/components/v2/laundry/laundry-action-modal";
const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: ({ onChange, folder, onBusyChange }: any) => <><button onClick={() => onBusyChange(true)}>Start proof upload</button><button onClick={() => { onChange([{ key: `${folder}/actor/abc.png`, url: "photo" }]); onBusyChange(false); }}>Add proof</button></> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(response: () => Promise<unknown>) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response()); vi.stubGlobal("fetch", fetch); const onDone = vi.fn();
  render(<LaundryActionModal task={{ id: "task", status: "CONFIRMED", pickupDate: "2026-09-13", dropoffDate: "2026-09-16" }} action="FAILED_PICKUP" dropoffOptions={[]} suppliers={[]} config={{ showPickupPhoto: true, requireDropoffPhoto: true, requireEarlyDropoffReason: true, showCostTracking: false }} onClose={vi.fn()} onDone={onDone} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "REQUEST_SKIP" } });
  fireEvent.change(screen.getByPlaceholderText(/No bag outside/), { target: { value: "Locked side gate" } });
  fireEvent.click(screen.getByRole("checkbox"));
  return { fetch, onDone, submit: () => fireEvent.click(screen.getByRole("button", { name: "Confirm", exact: true })) };
}
describe("access failure acknowledgement", () => {
  it("waits for the selected photo upload before allowing confirmation", () => {
    const view = setup(async () => ({})); fireEvent.click(screen.getByRole("button", { name: "Start proof upload" }));
    expect(screen.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled(); view.submit(); expect(view.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add proof" })); expect(screen.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
  });
  it("requests approval with optional proof and reports saved delivery warning", async () => {
    const view = setup(async () => ({ ok: true, json: async () => ({ id: "task", status: "FLAGGED", deliveryWarning: "Saved; office notification unavailable." }) }));
    fireEvent.click(screen.getByRole("button", { name: "Add proof" })); view.submit();
    await waitFor(() => expect(view.onDone).toHaveBeenCalledOnce());
    expect(JSON.parse(view.fetch.mock.calls[0][1]!.body as string)).toMatchObject({ status: "FAILED_PICKUP_REQUEST", requestedAction: "SKIP", failedPickupPhotoKey: "laundry/failed-pickup/task/actor/abc.png", failedPickupReason: "Locked side gate" });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Approval request saved", description: "Saved; office notification unavailable." }));
  });
  it.each(["network", "stale", "wrong-status"])("requires refresh after %s without repeating the request", async kind => {
    const view = setup(async () => { if (kind === "network") throw new Error("offline"); return { ok: kind !== "stale", status: kind === "stale" ? 409 : 200, json: async () => ({ id: "task", status: "CONFIRMED", error: "Task changed" }) }; });
    view.submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled());
    await screen.findByRole("button", { name: "Refresh task" });
    expect(view.onDone).not.toHaveBeenCalled(); expect(view.fetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Refresh task" })); expect(view.onDone).toHaveBeenCalledOnce();
  });
});
