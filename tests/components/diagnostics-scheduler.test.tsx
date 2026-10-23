import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagnosticsClient } from "@/app/admin/system/diagnostics/diagnostics-client";
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: () => null, LineChart: () => null, Area: () => null, Line: () => null,
  CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function snapshot(status: "ACTIVE" | "STALE" | null, icalSyncActive = false) {
  return {
    capturedAt: "2026-10-23T00:00:00Z", process: { pid: 1, uptimeSeconds: 1, cpuPercent: 0,
      memory: { rssMB: 1, heapUsedMB: 1, heapTotalMB: 1, externalMB: 1 }, nodeVersion: "22", platform: "linux" },
    sse: { liveLocationsActive: 0 }, workers: { recentFailures: [], jobStats: [], runsObserved: 0 },
    db: { activeQueries: [], jobsByState: [], slowQueries: [] },
    scheduler: { resendConfigured: false, scheduleCount: 1,
      schedules: [{ name: "ical-sync", cron: "0 */4 * * *", updatedOn: "2026-10-18T00:00:00Z" }],
      emailsSentLast24h: 0, webFallbackLastTickAt: null,
      ical: { worker: status ? { status, icalSyncActive, lastSeenAt: null, mobileDispatcherActive: false } : null,
        recentAutoRuns: [], latestManualRun: { id: "manual", status: "SUCCESS", createdAt: "2026-10-23T00:00:00Z" }, historyAvailable: true },
    },
  };
}
it("does not call a stopped worker active because its schedule and manual success remain", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => snapshot("STALE") })));
  render(<DiagnosticsClient />);
  expect(await screen.findByText("Worker heartbeat stale")).toBeInTheDocument();
  expect(screen.getByText(/Automatic iCal execution is unconfirmed/)).toBeInTheDocument();
  expect(screen.getByText(/Latest AUTO run.*none recorded/)).toBeInTheDocument();
  expect(screen.getByText(/Latest MANUAL run: SUCCESS/)).toBeInTheDocument();
  expect(screen.queryByText("Dedicated worker active")).not.toBeInTheDocument();
});
it("labels unavailable health separately from an active iCal handler", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => snapshot(null) })));
  const view = render(<DiagnosticsClient />);
  expect(await screen.findByText("Worker health unavailable")).toBeInTheDocument();
  view.unmount();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => snapshot("ACTIVE", true) })));
  render(<DiagnosticsClient />);
  expect(await screen.findByText("Worker heartbeat active")).toBeInTheDocument();
  expect(screen.queryByText(/Automatic iCal execution is unconfirmed/)).not.toBeInTheDocument();
  expect(screen.getByText(/Verify new successful AUTO records for every enabled feed/)).toBeInTheDocument();
});
