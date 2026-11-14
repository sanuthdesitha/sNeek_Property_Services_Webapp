/**
 * Sending safeguards screen: sections and states, the emergency stop through
 * the shared sensitive confirmation (own PIN), failures keep the dialog and
 * say why, operations managers read only, limits refuse out-of-bounds values,
 * and the phone layout (stacked rows, bottom-sheet dialog).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeguardsScreen } from "@/components/v2/admin/notifications/safeguards/safeguards-screen";
import { DEFAULT_SAFEGUARD_SETTINGS } from "@/lib/notifications/safeguards/config";
import type { SafeguardsResponse } from "@/lib/notifications/safeguards/overview-types";

function overview(patch: Partial<SafeguardsResponse> = {}): SafeguardsResponse {
  return {
    generatedAt: "2026-11-15T01:00:00.000Z", timeZone: "Australia/Sydney", since: "2026-11-14T13:00:00.000Z",
    settings: DEFAULT_SAFEGUARD_SETTINGS,
    volumes: [{ typeKey: "job.qa_and_accountability", typeName: "QA result, rework and coaching notices", transport: "EMAIL", sent: 12, notSent: 30, held: 1 }],
    topRecipients: [{ recipient: "Ana Cleaner", transport: "EMAIL", sent: 12 }],
    suppressedByReason: [{ reason: "PAUSED_RECIPIENT", label: "sending to this person is paused", count: 30 }],
    recentNotSent: [{ id: "e1", createdAt: "2026-11-15T00:30:00.000Z", transport: "EMAIL", typeName: "QA result, rework and coaching notices", recipient: "Ana Cleaner", reason: "PAUSED_RECIPIENT", label: "sending to this person is paused", held: false, subject: "QA needs attention" }],
    paused: [{ id: "i1", kind: "BREAKER", scopeKind: "RECIPIENT", scopeLabel: "Ana Cleaner", label: "Ana Cleaner", status: "ACTIVE", pausesSending: true, attempts: 42, recipients: ["a***@example.com"], transport: "EMAIL", windowMinutes: 15, threshold: 12, note: null, createdAt: "2026-11-15T00:10:00.000Z", resolvedAt: null, alertedAt: "2026-11-15T00:10:01.000Z", resolutionNote: null }],
    incidents: [],
    pausableTypes: [{ key: "job.qa_and_accountability", name: "QA result, rework and coaching notices" }, { key: "job.cleaner_invoice", name: "Cleaner invoice notices" }],
    canManage: true, readOnlyReason: null,
    ...patch,
  };
}

const fetchMock = vi.fn();
function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
}

beforeEach(() => {
  setPhone(false);
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url === "/api/me/admin-pin") return new Response(JSON.stringify({ hasPin: true, lockedUntil: null, userId: "admin", attemptsLeft: 5 }));
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SafeguardsScreen", () => {
  it("shows the emergency stop, what is paused, today's figures, reasons and limits — with no page heading of its own", () => {
    render(<SafeguardsScreen initial={overview()} timeZone="Australia/Sydney" />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    for (const name of ["Emergency stop", "Paused now (1)", "By type and transport", "Not sent, and why", "Most messages today", "Limits", "Recent incidents"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    const paused = screen.getByRole("list", { name: "Paused" });
    expect(paused).toHaveTextContent("Person: Ana Cleaner");
    expect(paused).toHaveTextContent("42 email attempts in 15 min (limit 12)");
    expect(screen.getByText("30 · sending to this person is paused")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent messages not sent" })).toHaveTextContent("Not sent: sending to this person is paused");
  });

  it("turns the emergency stop on with the person's own PIN and shows the new state", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/me/admin-pin") return new Response(JSON.stringify({ hasPin: true, lockedUntil: null, userId: "admin", attemptsLeft: 5 }));
      if (url.endsWith("/emergency-stop")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ on: true, security: { pin: "4826" } });
        return new Response(JSON.stringify(overview({ settings: { ...DEFAULT_SAFEGUARD_SETTINGS, emergencyStop: { on: true, changedAt: "2026-11-15T01:05:00.000Z", changedById: "admin", reason: null } } })));
      }
      return new Response("{}", { status: 404 });
    });
    render(<SafeguardsScreen initial={overview()} timeZone="Australia/Sydney" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop all sending" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sensitive · your PIN");
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop sending" }));
    await waitFor(() => expect(screen.getByText("Emergency stop is ON")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Resume sending" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Emergency stop is on.");
  });

  it("keeps the dialog open and says why when the server refuses", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/me/admin-pin") return new Response(JSON.stringify({ hasPin: true, lockedUntil: null, userId: "admin", attemptsLeft: 5 }));
      return new Response(JSON.stringify({ error: "Only an administrator can change the sending safeguards." }), { status: 403 });
    });
    render(<SafeguardsScreen initial={overview()} timeZone="Australia/Sydney" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("Only an administrator can change the sending safeguards.")).toBeInTheDocument());
    expect(screen.getByRole("list", { name: "Paused" })).toHaveTextContent("Ana Cleaner");
  });

  it("is read-only for an operations manager: no stop, pause, resume or save", () => {
    render(<SafeguardsScreen initial={overview({ canManage: false, readOnlyReason: "Only an administrator can change the sending safeguards." })} timeZone="Australia/Sydney" />);
    expect(screen.getByText("Only an administrator can change the sending safeguards.")).toBeInTheDocument();
    for (const name of ["Stop all sending", "Resume", "Pause", "Save limits"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getAllByLabelText("Per person per hour")[0]).toBeDisabled();
  });

  it("refuses a limit outside its bounds before anything is sent", () => {
    render(<SafeguardsScreen initial={overview()} timeZone="Australia/Sydney" />);
    const field = screen.getAllByLabelText("Per person per hour")[0];
    fireEvent.change(field, { target: { value: "2" } });
    expect(screen.getByText(/Email: Per person per hour must be a whole number from 5 to 60/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(field).toHaveValue(15);
  });

  it("on a phone: rows stack with inline labels and the confirmation is a bottom sheet", async () => {
    setPhone(true);
    render(<SafeguardsScreen initial={overview()} timeZone="Australia/Sydney" />);
    const volumes = screen.getByRole("region", { name: "Volumes by type" });
    expect(within(volumes).getByText("Not sent", { exact: false, selector: "span.sm\\:hidden" })).toBeInTheDocument();
    expect(within(volumes).getByText("Type").closest("li")).toHaveClass("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Stop all sending" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Stop sending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop all sending" }).className).toMatch(/w-full/);
  });
});
