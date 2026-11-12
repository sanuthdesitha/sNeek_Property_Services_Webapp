/**
 * Laundry owner decisions (2026-11-13), screens:
 *  - portal "Add weight / price" (optional fields, empty is never zero, the
 *    run version is sent, a refused save keeps the typed draft, frozen while
 *    saving), "Ready to return" and "Add drop-off photo" by status;
 *  - "From the office": the photo request offers "Add drop-off photo";
 *  - office run panel names the partner's entry ("Entered by Tom");
 *  - Pipeline "At the laundry" groups the ready sets;
 *  - Suppliers panel schedule editor sends the schedule with the version.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/v2/cleaner/media-capture", () => ({
  MediaCapture: ({ onChange }: { onChange: (value: Array<{ key: string; url: string; kind: "image" }>) => void }) => (
    <button type="button" onClick={() => onChange([{ key: "laundry/dropoff/tom/a.jpg", url: "blob:a", kind: "image" }])}>Take photo</button>
  ),
}));
vi.mock("@/components/v2/laundry/laundry-board", () => ({ decodeQrFromFile: vi.fn() }));

import { PartnerRunEntries } from "@/components/v2/laundry/portal/partner-run-entries";
import { OfficeRequestsInbox } from "@/components/v2/laundry/portal/office-requests-inbox";
import { LaundryRunPanel } from "@/components/v2/admin/laundry/laundry-run-panel";
import { splitReadyToReturn } from "@/components/v2/admin/laundry/laundry-pipeline-board";
import { PartnerScheduleEditor, PartnerScheduleSummary } from "@/components/v2/admin/inventory/suppliers/partner-schedule-section";
import type { LaundryOfficeRequest } from "@/lib/laundry/office-request-types";

afterEach(() => vi.unstubAllGlobals());

const VERSION = "2026-11-12T01:00:00.000Z";
const atLaundry = { id: "task1", status: "PICKED_UP", updatedAt: VERSION, bagWeightKg: null, dropoffCostAud: null, propertyName: "Glebe House" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("portal entries", () => {
  it("weight only is sent without a price; a refused save keeps the draft; fields freeze while saving", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const first = deferred<Response>();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      calls += 1;
      return calls === 1 ? first.promise : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const onSaved = vi.fn();
    render(<PartnerRunEntries task={atLaundry} onSaved={onSaved} />);
    fireEvent.click(screen.getByText("Add weight / price"));
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "11.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save weight / price" }));
    expect(screen.getByLabelText("Weight (kg)")).toBeDisabled();
    await act(async () => first.resolve(new Response(JSON.stringify({ error: "This run changed since you opened it. Refresh and check it before saving again." }), { status: 409 })));
    expect(await screen.findByRole("alert")).toHaveTextContent("This run changed");
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue(11.2);
    expect(bodies[0]).toEqual({ weightKg: 11.2, expectedUpdatedAt: VERSION });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("nothing entered sends nothing; zero is refused on the phone too", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PartnerRunEntries task={atLaundry} onSaved={() => undefined} />);
    fireEvent.click(screen.getByText("Add weight / price"));
    fireEvent.click(screen.getByRole("button", { name: "Save weight / price" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a weight, a price, or both.");
    fireEvent.change(screen.getByLabelText("Your price ($)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter numbers above 0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers Ready to return only while picked up, and the drop-off photo only once delivered", async () => {
    const posted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { posted.push(url); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }));
    const { rerender } = render(<PartnerRunEntries task={atLaundry} onSaved={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Ready to return" }));
    expect(await screen.findByText("Marked ready to return.")).toBeVisible();
    expect(posted).toEqual(["/api/laundry/task1/ready-to-return"]);
    rerender(<PartnerRunEntries key="r" task={{ ...atLaundry, status: "READY_TO_RETURN" }} onSaved={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Ready to return" })).toBeNull();
    expect(screen.getByText("Add weight / price")).toBeVisible();
    rerender(<PartnerRunEntries key="d" task={{ ...atLaundry, status: "DROPPED" }} onSaved={() => undefined} />);
    expect(screen.queryByText("Add weight / price")).toBeNull();
    fireEvent.click(screen.getByText("Add drop-off photo"));
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to drop-off" }));
    expect(await screen.findByText(/Photo added to the drop-off/)).toBeVisible();
    expect(posted[1]).toBe("/api/laundry/task1/dropoff-photos");
    rerender(<PartnerRunEntries key="c" task={{ ...atLaundry, status: "CONFIRMED" }} onSaved={() => undefined} />);
    expect(screen.queryByText("Add drop-off photo")).toBeNull();
  });

  it("the photo request in From the office offers Add drop-off photo on a delivered run", () => {
    const request: LaundryOfficeRequest = {
      id: "req1", taskId: "task1", kind: "TEAM_PHOTO", badge: "Photo needed", title: "Glebe House drop-off", text: "Photo?", note: null,
      askedAtLabel: "Thu 12 Nov 10:32", askedAt: "2026-11-12T00:00:00Z", propertyName: "Glebe House", state: "open", reminderNumber: 1, proposedTime: null, plannedTime: null,
      stopKind: "DROP", answers: ["CANNOT", "MESSAGE"], replies: [], run: { status: "DROPPED", updatedAt: VERSION, bagWeightKg: null, dropoffCostAud: null },
    };
    const { unmount } = render(<OfficeRequestsInbox initial={{ requests: [request], openCount: 1, windowHours: 72 }} todayKey="2026-11-12" focusTaskId={null} partnerEntries />);
    expect(screen.getByText("Add drop-off photo")).toBeVisible();
    unmount();
    // Impersonating (no partner entries): the form is not offered.
    render(<OfficeRequestsInbox initial={{ requests: [request], openCount: 1, windowHours: 72 }} todayKey="2026-11-12" focusTaskId={null} />);
    expect(screen.queryByText("Add drop-off photo")).toBeNull();
  });
});

describe("office screens", () => {
  it("the run panel names the partner team member who entered the price and weight", () => {
    const task = {
      id: "task1", status: "READY_TO_RETURN", pickupDate: "2026-11-10T00:00:00Z", dropoffDate: "2026-11-14T00:00:00Z", bagWeightKg: 11.2, dropoffCostAud: 48.2,
      property: { name: "Glebe House" },
      confirmations: [{ id: "c1", confirmedByName: "Tom", createdAt: "2026-11-12T01:00:00Z", notes: JSON.stringify({ event: "PARTNER_WEIGHT_PRICE", loadWeightKg: 11.2, totalPrice: 48.2 }) }],
    };
    render(<LaundryRunPanel task={task as never} busy={false} onClose={() => undefined} onEdit={() => undefined} onReschedule={() => undefined} onDelete={() => undefined} onReport={() => undefined} onSaved={() => undefined} />);
    expect(screen.getByText("$48.20 · Entered by Tom")).toBeVisible();
    expect(screen.getByText("11.2 kg · Entered by Tom")).toBeVisible();
    expect(screen.getAllByText("Ready to return").length).toBeGreaterThan(0);
  });

  it("At the laundry keeps order and puts ready sets in their own group", () => {
    const cards = [{ id: "a", status: "PICKED_UP" }, { id: "b", status: "READY_TO_RETURN" }, { id: "c", status: "PICKED_UP" }];
    const groups = splitReadyToReturn(cards as never);
    expect(groups.washing.map((card) => card.id)).toEqual(["a", "c"]);
    expect(groups.ready.map((card) => card.id)).toEqual(["b"]);
  });

  it("the partner schedule reads as drawn and saves with the version", async () => {
    const schedule = { pickupWeekdays: [1, 2, 3, 4, 5, 6], pickupWindowStart: "13:00", pickupWindowEnd: "16:00", dropWeekdays: [1, 2, 3, 4, 5, 6], dropWindowStart: "08:00", dropWindowEnd: "11:00" };
    const summary = render(<PartnerScheduleSummary schedule={schedule} />);
    expect(summary.getByText("Mon to Sat, 13:00 to 16:00")).toBeVisible();
    expect(summary.getByText("No service")).toBeVisible();
    summary.unmount();
    render(<PartnerScheduleSummary schedule={undefined} />);
    expect(screen.getByText(/No pickup and drop schedule is recorded/)).toBeVisible();

    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ schedule }), { status: 200 }); }));
    const onSaved = vi.fn();
    render(<PartnerScheduleEditor partnerId="p1" schedule={schedule} updatedAt={VERSION} onSaved={onSaved} />);
    const pickups = screen.getByRole("group", { name: "Pickups days" });
    fireEvent.click(within(pickups).getByRole("button", { name: "Sun" }));
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("Schedule saved.")).toBeVisible();
    expect(bodies[0]).toMatchObject({ pickupWeekdays: [0, 1, 2, 3, 4, 5, 6], pickupWindowStart: "13:00", dropWindowEnd: "11:00", expectedUpdatedAt: VERSION });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
