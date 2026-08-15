import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the maps loader so the component falls back to the plain input
vi.mock("@/lib/google-maps/client", () => ({
  loadPlacesLibrary: () => Promise.reject(new Error("not loaded in test")),
  parseNewPlace: () => null,
  parsePlaceResult: () => null,
}));

import { AddressAutocomplete } from "@/components/ui/address-autocomplete";

describe("AddressAutocomplete", () => {
  it("renders the fallback input with the placeholder when the SDK fails", async () => {
    render(<AddressAutocomplete onSelect={() => {}} />);
    // Wait for the async effect to switch to fallback mode
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByPlaceholderText(/start typing/i)).toBeInTheDocument();
  });

  it("emits onChange when user types in the fallback input", async () => {
    const handleChange = vi.fn();
    render(<AddressAutocomplete onSelect={() => {}} onChange={handleChange} />);
    await new Promise((r) => setTimeout(r, 80));
    const input = screen.getByPlaceholderText(/start typing/i);
    await userEvent.type(input, "Sydney");
    expect(handleChange).toHaveBeenCalled();
  });

  it("shows a fallback notice when the SDK fails to load", async () => {
    render(<AddressAutocomplete onSelect={() => {}} />);
    // Wait for the effect to fail
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByText(/Address lookup unavailable/i)).toBeInTheDocument();
  });

  it("does not show the notice while the SDK is still loading", () => {
    // Guards the reason the load state is a tri-state rather than a boolean.
    // `ready === false` also means "still loading", so a notice keyed on it
    // would flash on every mount before the SDK resolves — on a working
    // deployment, telling every user their address lookup is broken.
    render(<AddressAutocomplete onSelect={() => {}} />);
    expect(screen.queryByText(/Address lookup unavailable/i)).toBeNull();
  });
});
