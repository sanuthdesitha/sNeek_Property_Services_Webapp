import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the maps loader so the component renders without network
vi.mock("@/lib/google-maps/client", () => ({
  loadPlacesLibrary: () => Promise.reject(new Error("not loaded in test")),
  parsePlaceResult: () => null,
}));

import { AddressAutocomplete } from "@/components/ui/address-autocomplete";

describe("AddressAutocomplete", () => {
  it("renders an input with the placeholder", () => {
    render(<AddressAutocomplete onSelect={() => {}} />);
    expect(screen.getByPlaceholderText(/start typing/i)).toBeInTheDocument();
  });

  it("emits onChange when user types", async () => {
    const handleChange = vi.fn();
    render(<AddressAutocomplete onSelect={() => {}} onChange={handleChange} />);
    const input = screen.getByPlaceholderText(/start typing/i);
    await userEvent.type(input, "Sydney");
    expect(handleChange).toHaveBeenCalled();
  });

  it("shows a fallback notice when the SDK fails to load", async () => {
    render(<AddressAutocomplete onSelect={() => {}} />);
    // Wait for the effect to fail
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/Address lookup unavailable/i)).toBeInTheDocument();
  });
});
