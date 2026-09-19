import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LaundryActionModal } from "@/components/v2/laundry/laundry-action-modal";
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: ({ onChange, folder }: any) => <button onClick={() => onChange([{ key: `${folder}/actor/abc.jpg`, url: "photo" }])}>Capture {folder}</button> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(known = true) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ id: "task", status: "PICKED_UP" }) })); vi.stubGlobal("fetch", fetch); const onDone = vi.fn();
  render(<LaundryActionModal task={{ id: "task", status: "CONFIRMED", pickupDate: "2026-09-13", dropoffDate: "2026-09-16", confirmations: known ? [{ id: "baseline", notes: '{"source":"EARLY_UPDATE","laundryOutcome":"READY_FOR_PICKUP","bagCount":3,"unit":"bags"}' }] : [] }} action="PICKED_UP" dropoffOptions={[]} suppliers={[]} config={{ showPickupPhoto: false, requireDropoffPhoto: true, requireEarlyDropoffReason: true, showCostTracking: false }} onClose={vi.fn()} onDone={onDone} />);
  fireEvent.click(screen.getByRole("checkbox")); return { fetch, onDone, submit: () => fireEvent.click(screen.getByRole("button", { name: "Confirm", exact: true })) };
}
it("requires discrepancy reason and proof even when optional pickup photos are configured off", async () => {
  const view = setup(); expect(screen.getByText(/Cleaner reported 3 bags/)).toBeVisible(); view.submit(); expect(view.fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText(/Explain the expected/), { target: { value: "Two bags missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Capture laundry/pickup", exact: true })); view.submit(); await waitFor(() => expect(view.onDone).toHaveBeenCalledOnce());
  expect(JSON.parse(view.fetch.mock.calls[0][1]!.body as string)).toMatchObject({ bagCount: 1, quantityBaselineId: "baseline", discrepancyReason: "Two bags missing", pickupPhotoKey: "laundry/pickup/actor/abc.jpg" });
});
it("does not invent an expected baseline or require discrepancy proof for legacy tasks", async () => {
  const view = setup(false); expect(screen.getByText(/Expected bag quantity unknown/)).toBeVisible(); view.submit(); await waitFor(() => expect(view.onDone).toHaveBeenCalledOnce());
  expect(JSON.parse(view.fetch.mock.calls[0][1]!.body as string)).toMatchObject({ quantityBaselineId: null });
});
it("does not silently round a fractional actual count", () => {
  const view = setup(false); fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1.4" } }); view.submit(); expect(view.fetch).not.toHaveBeenCalled();
});
