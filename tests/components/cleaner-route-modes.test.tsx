import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteDriving } from "@/components/v2/cleaner/route-driving";

vi.mock("@/components/v2/cleaner/driving-mode", () => ({ DrivingMode: () => <div>Drive surface</div> }));
vi.mock("@/components/v2/cleaner/route-timeline", () => ({
  TRAVEL_MODE_META: { DRIVING: { Icon: () => null } },
  RouteTimeline: ({ initialDate }: { initialDate: string }) => <div>Timeline for {initialDate}</div>,
}));

describe("cleaner route modes", () => {
  it("switches in both directions and exposes the selected mode", () => {
    render(<RouteDriving initialDate="2026-09-09" initialStops={[]} />);
    const drive = screen.getByRole("button", { name: "On the way" });
    const timeline = screen.getByRole("button", { name: "Timeline" });
    expect(drive).toHaveAttribute("aria-pressed", "true");
    expect(timeline).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(timeline);
    expect(screen.getByText("Timeline for 2026-09-09")).toBeVisible();
    expect(screen.queryByText("Drive surface")).toBeNull();
    expect(timeline).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(drive);
    expect(screen.getByText("Drive surface")).toBeVisible();
    expect(drive).toHaveAttribute("aria-pressed", "true");
  });
});
