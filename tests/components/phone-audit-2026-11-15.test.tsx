/**
 * Regression tests for the 2026-11-15 phone audit pass (see
 * docs/qa/recent-changes-review-2026-10-09.md, "Phone audit pass").
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoReviewPanel } from "@/components/v2/qa/photo-review-panel";
import { CleanerQaFeedbackCard } from "@/components/v2/cleaner/qa-feedback-card";
import { groupTicketsByDay } from "@/lib/maintenance/tickets-by-day";
import type { MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";
import { statusBlockStyle, statusTintStyle } from "@/lib/jobs/status-presentation";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { monitorUnavailableText } from "@/components/v2/qa/qa-inspection-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

type FetchReply = { ok: boolean; status: number; json: () => Promise<unknown> };
const reply = (status: number, body: unknown): FetchReply => ({ ok: status < 400, status, json: async () => body });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI photo review panel for an inspector who does not own the inspection", () => {
  it("shows the gated state instead of the raw FORBIDDEN code and does not ask for photo checks", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(403, { error: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetch);
    render(<PhotoReviewPanel jobId="job-1" />);
    expect(await screen.findByText("AI photo review opens once this inspection is assigned to you.")).toBeTruthy();
    expect(screen.queryByText("FORBIDDEN")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Only the photo-review read: the photo-integrity panel is not mounted for a refused read.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain("/photo-review");
    expect(screen.getByRole("button", { name: "Refresh analysis" })).toHaveProperty("disabled", true);
  });

  it("still reports a real failure as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(503, { error: "Could not load photo review." })));
    render(<PhotoReviewPanel jobId="job-2" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load photo review.");
  });
});

describe("Cleaner QA feedback card", () => {
  it("never shows a failed read as 'no feedback' on the full page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { error: "boom" })));
    render(<CleanerQaFeedbackCard variant="page" />);
    expect((await screen.findByRole("alert")).textContent).toContain("QA feedback could not be loaded.");
    expect(screen.queryByText("No QA feedback yet")).toBeNull();
  });

  it("shows the empty state on the full page and stays hidden on the home screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { reviews: [] })));
    render(<CleanerQaFeedbackCard variant="page" />);
    expect(await screen.findByText("No QA feedback yet")).toBeTruthy();
    cleanup();
    const view = render(<CleanerQaFeedbackCard />);
    await waitFor(() => expect(view.container.textContent).toBe(""));
  });

  it("says the read failed on the home screen too, with a retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, {})));
    render(<CleanerQaFeedbackCard />);
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

function ticket(id: string, scheduledFor: string, status: string): MaintenanceTicketSummary {
  return {
    id, title: id, priority: "LOW", status, scheduledFor,
    enRouteAt: null, arrivedAt: null, clockInAt: null, clockOutAt: null,
    outcome: null, costApprovalStatus: null, property: null,
  };
}

describe("maintenance tickets by day", () => {
  it("does not call a past day overdue when every ticket on it is finished", () => {
    const groups = groupTicketsByDay(
      [
        ticket("done", "2026-11-08T03:00:00Z", "RESOLVED"),
        ticket("dropped", "2026-11-08T05:00:00Z", "DISMISSED"),
        ticket("open", "2026-11-10T03:00:00Z", "IN_PROGRESS"),
      ],
      new Date("2026-11-12T01:00:00Z"),
    );
    expect(groups.map((group) => group.label)).toEqual(["Sunday 8 Nov", "Tuesday 10 Nov · overdue"]);
  });
});

describe("v2 status blocks", () => {
  it("keeps the status tint but drops the coloured inline-start edge", () => {
    const tint = statusTintStyle("ASSIGNED");
    expect(tint).toEqual({ backgroundColor: statusBlockStyle("ASSIGNED").backgroundColor });
    expect(Object.keys(tint)).not.toContain("borderInlineStart");
  });
});

describe("phone layout primitives", () => {
  it("caps a tone card's pill so a long value cannot squeeze the title", () => {
    render(<EToneCard header={<p>Eligible cleans</p>} pill="Airbnb turnover · not a rework · laundry on · not invoiced" />);
    const pill = screen.getByText(/Airbnb turnover/);
    expect(pill.className).toContain("max-w-[55%]");
    expect(pill.className).toContain("break-words");
  });

  it("lays six stages out as a three-column grid on phones only", () => {
    render(
      <EStageBar
        label="Run stages"
        stages={["Waiting", "Confirmed", "Picked up", "At laundry", "Ready", "Dropped"].map((label, index) => ({
          key: label,
          label,
          state: index === 1 ? "current" : index < 1 ? "done" : "upcoming",
        }))}
      />,
    );
    const list = screen.getByRole("list", { name: "Run stages" });
    expect(list.className).toContain("max-sm:grid-cols-3");
    expect(list.className).toMatch(/(^|\s)flex(\s|$)/);
  });
});

describe("QA monitor live progress read", () => {
  it("names a refused or failed read instead of showing placeholder figures", () => {
    expect(monitorUnavailableText("refused")).toBe("Live progress appears once this inspection is assigned to you.");
    expect(monitorUnavailableText("failed")).toBe("Live progress could not be loaded. Refresh to try again.");
    expect(monitorUnavailableText("ok")).toBeNull();
    expect(monitorUnavailableText("idle")).toBeNull();
  });
});
