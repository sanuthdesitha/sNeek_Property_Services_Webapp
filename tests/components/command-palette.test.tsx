import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CommandPalette } from "@/components/command-palette";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("CommandPalette", () => {
  it("is hidden by default", () => {
    const { queryByPlaceholderText } = render(<CommandPalette />);
    expect(queryByPlaceholderText(/Type to search/i)).toBeNull();
  });

  it("opens on Cmd+K", () => {
    const { queryByPlaceholderText } = render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(queryByPlaceholderText(/Type to search/i)).toBeInTheDocument();
  });
});
