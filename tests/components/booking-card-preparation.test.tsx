import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { BookingCard } from "@/components/v2/cleaner/booking-card";

it("labels the preparation count and property fallback for the cleaner", () => {
  render(<BookingCard reservation={{ preparationGuestCount: 7, preparationSource: "PROPERTY_MAX" }} />);
  expect(screen.getByText("Prepare for")).toBeInTheDocument();
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.getByText("property max")).toBeInTheDocument();
});
