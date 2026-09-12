import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteDriving } from "@/components/v2/cleaner/route-driving";

afterEach(() => vi.unstubAllGlobals());

describe("real cleaner route surfaces", () => {
  it("mounts the actual timeline and switches back without location or network work", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<RouteDriving initialDate="2026-09-09" initialStops={[]} userId="test-cleaner" />);
    fireEvent.click(screen.getByRole("button", { name: "Timeline", exact: true }));
    expect(screen.getByRole("button", { name: "Timeline", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pick a date" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tomorrow" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "On the way" }));
    expect(screen.queryByRole("button", { name: "Pick a date" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
