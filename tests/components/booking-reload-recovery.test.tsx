import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EstateBookingFlow } from "@/components/v2/client/booking-flow";
import { loadBookingDraft, saveBookingDraft, type BookingDraft } from "@/lib/booking/draft-session";
vi.mock("@/components/v2/client/booking-review-details", () => ({ BookingReviewDetails: () => null }));

const scope = "a".repeat(64);
const props = { properties: [{ id: "p-1", name: "QA Harbour", suburb: "Sydney", bedrooms: 2, bathrooms: 1 }], actorName: "QA Assistant", actingFor: "QA Client", draftScope: scope };
const payload = { propertyId: "p-1", jobType: "GENERAL_CLEAN", scheduledDate: "2099-09-10", notes: "Use side entrance" };
const key = "cd8a32b1-d523-40f5-a033-7a6512b72198";
const pending: BookingDraft = { ...payload, step: 3, request: { key, payload: JSON.stringify(payload) } };
const fetcher = vi.fn();
const slots = { available: ["2099-09-10"], windowStart: "2099-09-01", windowEnd: "2099-09-30" };
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset().mockImplementation(async (_url, options) => options?.method === "POST"
    ? Response.json({ ok: true, requestId: "request-1", pendingApproval: true }) : Response.json(slots));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("booking same-tab recovery", () => {
  it("starts a rebook with fresh availability and no historical instructions or request", async () => {
    render(<EstateBookingFlow {...props} rebook={{ propertyId: "p-1", jobType: "DEEP_CLEAN" }} />);
    await screen.findByRole("button", { name: "Continue" });
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0]).toContain("propertyId=p-1&serviceType=DEEP_CLEAN");
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(loadBookingDraft(scope).draft).toMatchObject({ propertyId: "p-1", jobType: "DEEP_CLEAN", notes: "", step: 1 });
    expect(loadBookingDraft(scope).draft?.request).toBeUndefined();
  });
  it("restores an unresolved request without fetching dates or automatically resending", async () => {
    expect(saveBookingDraft(scope, pending)).toBe(true);
    render(<EstateBookingFlow {...props} />);
    const retry = await screen.findByRole("button", { name: "Retry request" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByLabelText("Special instructions")).toHaveValue(payload.notes);
    expect(screen.getByLabelText("Special instructions")).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText("Your booking is with the team.");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Idempotency-Key": key }, body: pending.request!.payload });
    expect(loadBookingDraft(scope).draft?.confirmedRequestId).toBe("request-1");
  });
  it("restores successful confirmation instead of offering a duplicate submission", async () => {
    saveBookingDraft(scope, { ...pending, confirmedRequestId: "request-1" });
    const view = render(<EstateBookingFlow {...props} />);
    await screen.findByText("Your booking is with the team.");
    expect(fetcher).not.toHaveBeenCalled();
    view.unmount();
    render(<EstateBookingFlow {...props} />);
    await screen.findByText("Your booking is with the team.");
    expect(screen.queryByRole("button", { name: "Retry request" })).toBeNull();
  });
  it("does not restore another account or scope's pending payload", async () => {
    saveBookingDraft(scope, pending);
    render(<EstateBookingFlow {...props} draftScope={"b".repeat(64)} />);
    await screen.findByRole("button", { name: "Continue" });
    expect(screen.queryByRole("button", { name: "Retry request" })).toBeNull();
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });
  it("preserves editing notes and revalidates a restored date", async () => {
    saveBookingDraft(scope, { ...payload, step: 3 });
    render(<EstateBookingFlow {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm booking" })).toBeEnabled());
    expect(screen.getByLabelText("Special instructions")).toHaveValue(payload.notes);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not silently replace a restored unavailable date with a different date", async () => {
    saveBookingDraft(scope, { ...payload, scheduledDate: "2099-09-09", step: 3 });
    render(<EstateBookingFlow {...props} />);
    await screen.findByRole("button", { name: "Confirm booking" });
    await waitFor(() => expect(loadBookingDraft(scope).draft?.scheduledDate).toBe(""));
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeDisabled();
  });
  it("blocks recovery when the saved property is outside current options", async () => {
    saveBookingDraft(scope, pending);
    render(<EstateBookingFlow {...props} properties={[]} />);
    await screen.findByRole("button", { name: "Retry recovery" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses to send when the recovery key cannot be saved", async () => {
    saveBookingDraft(scope, pending);
    render(<EstateBookingFlow {...props} />);
    const retry = await screen.findByRole("button", { name: "Retry request" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    fireEvent.click(retry);
    await screen.findByText(/No request was sent. This tab could not save its recovery key/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks corrupt recovery without replacing it with an empty draft", async () => {
    sessionStorage.setItem(`sneek:booking-draft:v1:${scope}`, "broken");
    render(<EstateBookingFlow {...props} />);
    await screen.findByRole("button", { name: "Retry recovery" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`sneek:booking-draft:v1:${scope}`)).toBe("broken");
  });
  it("does not start another booking if the confirmed recovery record cannot be cleared", async () => {
    saveBookingDraft(scope, { ...pending, confirmedRequestId: "request-1" });
    render(<EstateBookingFlow {...props} />);
    const another = await screen.findByRole("button", { name: "Book another service" });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.click(another);
    expect(screen.getByText("Your booking is with the team.")).toBeVisible();
    expect(screen.getByText(/recovery record could not be updated/)).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
