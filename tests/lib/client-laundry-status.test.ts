// @vitest-environment node
/**
 * READY_TO_RETURN (2026-11-13) reads as linen still away at the laundry,
 * "Ready to come back", in the same "in flight" tone as Picked up — never as
 * delivered, and never as a raw code — on every client view.
 */
import { describe, expect, it } from "vitest";
import { CLIENT_LAUNDRY_FINISHED, clientLaundryStatusLabel, clientLaundryStatusTone } from "@/lib/client/laundry-status";
import { LAUNDRY_LABEL, laundryByProperty } from "@/components/v2/client/home/home-model";

describe("client laundry status", () => {
  it("labels READY_TO_RETURN for the client and keeps it away from delivered", () => {
    expect(clientLaundryStatusLabel("READY_TO_RETURN")).toBe("Ready to come back");
    expect(clientLaundryStatusTone("READY_TO_RETURN")).toBe(clientLaundryStatusTone("PICKED_UP"));
    expect(clientLaundryStatusTone("READY_TO_RETURN")).not.toBe(clientLaundryStatusTone("DROPPED"));
    expect(CLIENT_LAUNDRY_FINISHED.has("READY_TO_RETURN")).toBe(false);
    expect(clientLaundryStatusLabel("DROPPED")).toBe("Delivered");
    expect(clientLaundryStatusLabel("SOME_NEW_STATUS")).toBe("Some New Status");
    expect(LAUNDRY_LABEL.READY_TO_RETURN).toBe("Ready to come back");
  });

  it("shows a ready run on Home as still open, with its return day", () => {
    const lines = laundryByProperty([
      { status: "READY_TO_RETURN", pickupDate: new Date("2026-11-10T00:00:00Z"), dropoffDate: new Date("2026-11-13T00:00:00Z"), droppedAt: null, property: { id: "p1", name: "Bondi" } },
    ] as never);
    expect(lines.get("p1")).toMatch(/^Ready to come back · pickup .* · back /);
  });
});
