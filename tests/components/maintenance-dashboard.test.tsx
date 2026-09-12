import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MaintenancePriority } from "@prisma/client";
import MaintenanceTodayPage from "@/app/v2/maintenance/page";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { propertyMaintenanceItem: mocks } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "MAINTENANCE" } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `Repair ${i}`, priority: MaintenancePriority.HIGH, property: null })));
  mocks.count.mockResolvedValue(41);
});

describe("maintenance dashboard reliability", () => {
  it("counts all open work independently of the 20-row preview", async () => {
    render(await MaintenanceTodayPage());
    expect(screen.getByText("Showing 20 of 41.")).toBeVisible();
    expect(screen.getByRole("link", { name: "View all tickets" })).toHaveAttribute("href", "/v2/maintenance/tickets");
    expect(mocks.count).toHaveBeenCalledTimes(4);
  });
  it("never describes a failed query as all clear", async () => {
    mocks.findMany.mockRejectedValue(new Error("offline"));
    mocks.count.mockRejectedValue(new Error("offline"));
    render(await MaintenanceTodayPage());
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No open tickets")).toBeNull();
    expect(screen.getByRole("link", { name: "Retry" })).toBeVisible();
  });
  it("uses Sydney calendar boundaries on the 23-hour daylight-saving day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T01:00:00Z"));
    try {
      await MaintenanceTodayPage();
      const scheduled = mocks.count.mock.calls.find(([args]) => args.where.scheduledFor)?.[0].where.scheduledFor;
      expect(scheduled.gte.toISOString()).toBe("2026-10-03T14:00:00.000Z");
      expect(scheduled.lt.toISOString()).toBe("2026-10-04T13:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
