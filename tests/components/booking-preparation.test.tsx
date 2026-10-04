import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingCard } from "@/components/v2/cleaner/booking-card";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const preparation = { propertyId: "p", jobId: "j" };
const reservation = { preparationGuestCount: 4, preparationSource: "INCOMING_BOOKING" as const };
const response = { policy: { version: 1, items: [], extraTowels: null }, plans: [{ jobId: "j", nights: 15, guests: 4, guestBasis: "INCOMING_BOOKING", staySource: "ICAL", startDate: "2026-10-01", endDate: "2026-10-16", towelInstruction: "Confirm extra towel quantity.", rows: [], generatedAt: "2026-10-04" }] };

it("keeps guest count visible and preparation mounted across disclosure toggles", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", fetcher);
  render(<BookingCard reservation={reservation} preparation={preparation} />);
  const toggle = screen.getByRole("button", { name: "Incoming stay preparation" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("4", { exact: true })).toBeVisible();
  await waitFor(() => expect(screen.getByText("Confirm extra towel quantity.")).not.toBeVisible());
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(/15 nights/)).toBeVisible();
  const details = screen.getByText("Estimate details").closest("details")!;
  details.open = true;
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(details.open).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("region", { name: "Incoming stay preparation" })).toHaveLength(1);
});
it("exposes a preparation load failure even when collapsed and preserves unknown guest count", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Preparation unavailable" }), { status: 503 })));
  render(<BookingCard reservation={null} preparation={preparation} />);
  expect(screen.getByText("Guest count unknown — confirm with the office.")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent("Preparation unavailable");
  expect(screen.getByRole("button", { name: "Incoming stay preparation" })).toHaveAttribute("aria-expanded", "true");
});
