import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LaundryHandoffReceipts } from "@/components/v2/laundry/handoff-receipts";

it("opens recorded receipts with actor, time, details and photo, without a mutation", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  render(<LaundryHandoffReceipts confirmations={[{ id: "return", confirmedByName: "Sam", createdAt: "2026-09-12T23:00:00Z", notes: '{"event":"DROPPED","dropoffLocation":"Cupboard"}', photoUrl: "https://example.test/photo.jpg" }]} />);
  fireEvent.click(screen.getByText("Recorded handoffs (1)"));
  expect(screen.getByText("Return recorded")).toBeVisible();
  expect(screen.getByText(/Recorded by Sam/)).toBeVisible();
  expect(screen.getByText("Location: Cupboard")).toBeVisible();
  expect(screen.getByText(/not acceptance by a recipient/)).toBeVisible();
  expect(screen.getByRole("link", { name: "View recorded photo" })).toHaveAttribute("href", "https://example.test/photo.jpg");
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
it("does not substitute current task status for missing confirmation records", () => {
  render(<LaundryHandoffReceipts confirmations={[]} />);
  fireEvent.click(screen.getByText("Recorded handoffs (0)"));
  expect(screen.getByText("No handoff confirmations recorded.")).toBeVisible();
});
