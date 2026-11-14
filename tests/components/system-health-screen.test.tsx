/**
 * System health screen (board "Diagnostics", 2026-11-16): the summary
 * sentence and fix links, five states with words, "Check again" (a failed
 * check makes every card "Cannot tell from here"), "Copy details for
 * support", the failure explanation with folded technical detail, and the
 * phone layout (folded services, docked Check again).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/v2/admin/diagnostics" }));

import { SystemHealthScreen } from "@/components/v2/admin/diagnostics/system-health-screen";
import { buildSystemHealthView } from "@/lib/ops/system-health-model";
import type { HealthFacts } from "@/lib/ops/system-health-types";

function facts(overrides: Partial<HealthFacts> = {}): HealthFacts {
  const now = new Date().toISOString();
  return {
    checkedAt: now,
    timeZone: "Australia/Sydney",
    worker: { status: "ACTIVE", lastSeenAt: now, registeredJobs: [] },
    tasks: [{
      name: "reminder-dispatch", cron: "*/30 * * * *", timeZone: "Australia/Sydney",
      lastRun: { at: new Date(Date.now() - 5 * 60_000).toISOString(), ok: false, durationMs: 9800, error: "Error: SMS provider timeout after 10000ms", skipped: false },
      lastFailure: null, ok24h: 47, failed24h: 1, unknown24h: 0, failuresInARow: 1,
    }],
    queue: { waiting: 4, running: 1, willRetry: 1, failed24h: 0, doneLastHour: 63, stuck: 0 },
    database: { reachable: true, runningQueries: 2, longestSeconds: 0, activeQueries: [{ pid: 412, seconds: 0, state: "active", query: "SELECT 1" }] },
    xero: { readable: true, notConnected: true, state: null, tenantName: null, lastRefreshedAt: null, renewBy: null, reason: null, lastSyncAt: null },
    safeguards: { readable: true, emergencyStop: false, paused: [] },
    email: { keyPresent: true, providerName: "Resend", handedOver24h: 214, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: now, lastFailureAt: null, bounceList: 1 },
    sms: { keyPresent: true, providerName: "cellcast", handedOver24h: 0, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: null, lastFailureAt: null },
    push: { keyPresent: false, providerName: "Browser push and phone app", handedOver24h: 0, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: null, lastFailureAt: null, browsers: 0 },
    storage: { keyPresent: true, lastUploadAt: now, unresolvedFailures: 1, oldestUnresolvedAt: now },
    maps: { keyPresent: true },
    ai: { readable: true, okCalls24h: 0, failedCalls24h: 0, lastOkAt: null, lastOkProvider: null, lastOkLatencyMs: null, lastFailureAt: null },
    ical: { readable: true, enabledFeeds: 0, failing: [], lastRunAt: null },
    payments: { readable: true, activeGateways: [] },
    server: { uptimeSeconds: 3600, rssMB: 400, totalMemMB: 2048 },
    ...overrides,
  };
}

const email = [{ email: "billing@iwss.com.au", reason: "HARD_BOUNCE", createdAt: "2026-11-10T00:00:00.000Z" }];

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("System health overview", () => {
  it("opens with one sentence from real state, one h1, and keeps key present apart from working", () => {
    setPhone(false);
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts())} tab="overview" email={email} uploads={[]} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("System health");
    const summary = document.querySelector("[data-health-summary]") as HTMLElement;
    expect(summary).toHaveTextContent("1 thing needs you.");
    expect(summary).toHaveTextContent("Send text and email reminders");
    const maps = document.querySelector('[data-health-area="maps"]') as HTMLElement;
    expect(maps).toHaveTextContent("Key present");
    expect(maps).not.toHaveTextContent("Working");
    expect(document.querySelector('[data-health-area="sms"]')).toHaveTextContent("Not tested");
    expect(document.querySelector('[data-health-area="push"]')).toHaveTextContent("Not set up");
    // Links to the places things are fixed.
    expect(screen.getAllByRole("link", { name: /Sending safeguards/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Settings › Xero/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /AI configuration/ }).length).toBeGreaterThan(0);
  });

  it("explains a failed task in plain words with the technical detail folded", () => {
    setPhone(false);
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts())} tab="scheduled" email={email} uploads={[]} />);
    const panel = document.querySelector('[data-health-failure="reminder-dispatch"]') as HTMLElement;
    expect(panel).toHaveTextContent("What happened:");
    expect(panel).toHaveTextContent("What it means:");
    expect(panel).toHaveTextContent("What to do:");
    const details = within(panel).getByText(/Technical details · reminder-dispatch/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it("a silent worker says Cannot tell from here", () => {
    setPhone(false);
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts({ worker: { status: "STALE", lastSeenAt: new Date(Date.now() - 30 * 60_000).toISOString(), registeredJobs: null } }))} tab="overview" email={email} uploads={[]} />);
    expect(document.querySelector('[data-health-area="scheduled"]')).toHaveTextContent("Cannot tell from here");
    expect(document.querySelector("[data-health-worker]")?.getAttribute("data-health-worker")).toBe("silent");
  });

  it("a failed Check again turns every card into Cannot tell from here, and a second press cancels the first", async () => {
    setPhone(false);
    const calls: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      calls.push(init.signal as AbortSignal);
      return Promise.resolve({ ok: false, json: async () => ({ error: "boom" }) });
    }));
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts())} tab="overview" email={email} uploads={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    expect(calls[0].aborted).toBe(true);
    expect(await screen.findByText(/System health could not be read at/)).toBeInTheDocument();
    for (const card of Array.from(document.querySelectorAll("[data-health-area]"))) expect(card).toHaveTextContent("Cannot tell from here");
  });

  it("copies support details without secrets", async () => {
    setPhone(false);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const view = buildSystemHealthView(facts());
    render(<SystemHealthScreen initialView={view} tab="overview" email={email} uploads={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy details for support/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(view.support));
    expect(await screen.findByText(/no passwords, keys, tokens or client details/)).toBeInTheDocument();
  });

  it("removing an address from the bounce list asks a tier A confirmation", async () => {
    setPhone(false);
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts())} tab="email" email={email} uploads={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from list…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Emails to this address will be tried again.");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });
});

describe("System health on a phone", () => {
  it("folds the outside services, docks Check again and keeps every function", async () => {
    setPhone(true);
    render(<SystemHealthScreen initialView={buildSystemHealthView(facts())} tab="overview" email={email} uploads={[]} />);
    const bar = await screen.findByRole("region", { name: "System health actions" });
    expect(within(bar).getByRole("button", { name: /Check again/ })).toBeInTheDocument();
    const folds = document.querySelectorAll("#health-services details");
    expect(folds.length).toBeGreaterThan(5);
    expect(screen.getByRole("button", { name: /Copy details for support/ })).toBeInTheDocument();
  });
});
