import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingReviewDetails } from "@/components/v2/client/booking-review-details";

const details = { propertyId: "p-1", serviceType: "AIRBNB_TURNOVER", pricing: { state: "estimate", total: 220, gst: 20 }, timing: { checkin: "14:00", checkout: "10:00", source: "ICAL" }, access: { recorded: true } };
const fetcher = vi.fn();
const mount = () => render(<BookingReviewDetails propertyId="p-1" serviceType="AIRBNB_TURNOVER" />);
beforeEach(() => { fetcher.mockReset().mockResolvedValue(Response.json(details)); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe("booking review details", () => {
  it("shows an estimate and separates guest timing, access records and approval conditions", async () => {
    mount();
    await screen.findByText("$220.00");
    expect(screen.getByText("GST component: $20.00")).toBeVisible();
    expect(screen.getByText("Default guest checkout: 10:00")).toBeVisible();
    expect(screen.getByText(/not a confirmed cleaning appointment/)).toBeVisible();
    expect(screen.getByText(/not a confirmed quote/)).toBeVisible();
    expect(screen.getByText("Access instructions recorded")).toBeVisible();
    expect(screen.getByText(/before a job is created/)).toBeVisible();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
  });
  it("does not show monetary fields when pricing is hidden", async () => {
    fetcher.mockResolvedValue(Response.json({ ...details, pricing: { state: "hidden", total: 220, gst: 20 } }));
    mount();
    await screen.findByText("Pricing is not available to this account.");
    expect(screen.queryByText(/\$220|\$20/)).toBeNull();
  });
  it("distinguishes unavailable estimates from zero and supports retry", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ...details, pricing: { state: "unavailable" }, access: { recorded: false } }));
    mount();
    await screen.findByText("Access instructions not recorded");
    fireEvent.click(screen.getByRole("button", { name: "Retry estimate" }));
    await screen.findByText("$220.00");
  });
  it.each([401, 403, 404, 503])("shows honest details failure for %i without rendering stale pricing", async (status) => {
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    mount();
    const retry = await screen.findByRole("button", { name: "Retry review details" });
    expect(screen.queryByText("$220.00")).toBeNull();
    fireEvent.click(retry);
    await screen.findByText("$220.00");
  });
  it.each([
    { ...details, propertyId: "wrong-property" },
    { ...details, serviceType: "GENERAL_CLEAN" },
    { ...details, pricing: { state: "estimate", total: -1, gst: 0 } },
    { ...details, timing: { ...details.timing, checkin: "25:90" } },
  ])("rejects invalid or mismatched response %#", async (body) => {
    fetcher.mockResolvedValue(Response.json(body));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("$220.00")).toBeNull();
  });
  it("ignores a previous property's late response", async () => {
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = mount();
    const firstSignal = fetcher.mock.calls[0][1].signal;
    fetcher.mockResolvedValue(Response.json({ ...details, propertyId: "p-2", pricing: { state: "hidden" } }));
    view.rerender(<BookingReviewDetails propertyId="p-2" serviceType="AIRBNB_TURNOVER" />);
    await screen.findByText("Pricing is not available to this account.");
    await act(async () => finish(Response.json(details)));
    expect(firstSignal.aborted).toBe(true);
    expect(screen.queryByText("$220.00")).toBeNull();
  });
  it("aborts an in-flight read on unmount", async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    const view = mount();
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const signal = fetcher.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("refreshes visibility when the tab regains focus", async () => {
    mount();
    await screen.findByText("$220.00");
    fetcher.mockResolvedValue(Response.json({ ...details, pricing: { state: "hidden" } }));
    fireEvent(window, new Event("focus"));
    await screen.findByText("Pricing is not available to this account.");
    expect(screen.queryByText("$220.00")).toBeNull();
  });
});
