/**
 * Guest timing where people act on it: the cleaner's offer card (before
 * Accept), the admin job page (with the cleaner's acknowledgement), Command's
 * Today by cleaner, and the cleaner's re-confirm notice after a change.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "cleaner-a" } } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

import { OfferCard, type TodayJobView } from "@/components/v2/cleaner/today/today-cards";
import { JobGuestTiming } from "@/components/v2/admin/jobs/detail/job-timing";
import { guestTimingToday } from "@/components/v2/admin/command/today-by-cleaner";
import { TimingReconfirm, readTimingAckPayload, timingReconfirmNeeded } from "@/components/v2/cleaner/job-stages/timing-reconfirm";
import { timingTagsFor } from "@/lib/jobs/timing-tags";
import { CalendarJobChip, type ChipActions } from "@/components/v2/admin/calendar/calendar-job-chip";
import type { CalendarJob } from "@/lib/calendar/types";
import type { ResolvedStartBriefingItem } from "@/lib/forms/start-briefing";
import type { TodayByCleanerPayload } from "@/lib/dashboard/command-types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const offer: TodayJobView = {
  id: "job-1", propertyName: "Harbour Loft", address: "1 Harbour St", window: "11:30 – 13:00", otherDayLabel: null,
  jobTypeLabel: "Airbnb turnover", status: "OFFERED", duration: "1.5 h", pay: null, startTime: "11:30", dueTime: "13:00",
  sameDayCheckin: false, sameDayCheckinTime: null, timingBadges: { late: "11:00", early: "13:00" }, mapsHref: null,
};

describe("cleaner offer card", () => {
  it("shows the guest timing before the Accept button", () => {
    render(<OfferCard job={offer} dayLabel="Fri 20 Nov" />);
    const late = screen.getByText("Late checkout: Start after 11:00");
    const early = screen.getByText("Early check-in: Ready by 13:00");
    const accept = screen.getByRole("button", { name: "Accept" });
    // DOCUMENT_POSITION_FOLLOWING: the button comes after the timing lines.
    expect(late.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(early.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states an unreadable late checkout time instead of showing nothing", () => {
    render(<OfferCard job={{ ...offer, timingBadges: { lateInvalid: true } }} dayLabel="Fri 20 Nov" />);
    expect(screen.getByText("Late checkout: Start time not confirmed")).toBeInTheDocument();
  });

  it("shows no timing line for an offer without rules", () => {
    render(<OfferCard job={{ ...offer, timingBadges: null, dueTime: null }} dayLabel="Fri 20 Nov" />);
    expect(screen.queryByText(/Late checkout|Early check-in/)).toBeNull();
  });
});

describe("admin job page guest timing", () => {
  const tags = timingTagsFor({ timingBadges: { late: "11:00" } });

  it("shows the tags and Not acknowledged yet when nothing is recorded", () => {
    render(<JobGuestTiming tags={tags} ack={{ kind: "rows", rows: [{ userId: "c1", name: "Cleaner One", assigned: true, state: { kind: "notAcknowledged" } }] }} />);
    const section = screen.getByRole("region", { name: "Guest timing" });
    expect(within(section).getByText("Late checkout · start after 11:00")).toBeVisible();
    expect(within(section).getByText("Cleaner One: not acknowledged yet")).toBeVisible();
    expect(within(section).queryByText(/acknowledged at start/)).toBeNull();
  });

  it("names who acknowledged and when", () => {
    render(<JobGuestTiming tags={tags} ack={{ kind: "rows", rows: [{ userId: "c1", name: "Cleaner One", assigned: true, state: { kind: "acknowledged", atLabel: "20 Nov 2026 · 11:10" } }] }} />);
    expect(screen.getByText("Cleaner One acknowledged at start · 20 Nov 2026 · 11:10")).toBeVisible();
  });

  it("says the record could not be read, never acknowledged", () => {
    render(<JobGuestTiming tags={tags} ack={{ kind: "error" }} />);
    expect(screen.getByText(/could not be read/)).toBeVisible();
    expect(screen.queryByText(/acknowledged at start/)).toBeNull();
  });

  it("renders nothing for a job without guest timing", () => {
    const { container } = render(<JobGuestTiming tags={[]} ack={{ kind: "none" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("admin calendar chip", () => {
  it("shows the whole worded tag (wrapping, not cut to \"Late ch…\") and says it in the chip's label", () => {
    const job = {
      id: "j1", jobNumber: "J1", propertyId: "p", propertyName: "Harbour Loft", propertyMissingName: false, suburb: null, clientId: null, clientName: null,
      jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", day: "2026-11-20", startTime: "11:30", endTime: null, dueTime: "13:00", estimatedHours: 1.5, hours: 1.5,
      cleaners: [{ id: "c1", name: "Cleaner One", isPrimary: true }], skipped: false, late: false, guestArrival: null,
      timingBadges: { late: "11:00", early: "13:00" }, moveBlock: null, updatedAt: "2026-11-16T00:00:00.000Z", qa: null,
    } as unknown as CalendarJob;
    const actions: ChipActions = { readOnly: true, canDrag: false, onOpen: vi.fn(), onMove: vi.fn(), onAssign: vi.fn(), onQa: vi.fn(), onPointerDown: vi.fn(), consumeClickSuppression: () => false };
    render(<CalendarJobChip job={job} source={{ lane: "cleaner", rowId: "c1", day: "2026-11-20" } as never} actions={actions} showArrival={false} />);
    const late = screen.getByText("Late checkout · start after 11:00");
    expect(late.className).not.toContain("truncate");
    expect(screen.getByText("Early check-in · ready by 13:00")).toBeInTheDocument();
  });
});

describe("Command: guest timing today", () => {
  it("lists each job with rules once, in time order", () => {
    const segment = (jobId: string, startMinute: number, timingBadges: TodayByCleanerPayload["rows"][number]["segments"][number]["timingBadges"]) => ({
      jobId, startMinute, endMinute: startMinute + 60, lengthAssumed: false, state: "planned" as const, label: `${jobId} · x`, timingBadges,
    });
    const payload = {
      rows: [
        { key: "a", name: "A", unassigned: false, segments: [segment("late-job", 720, { late: "11:00" }), segment("plain", 540, null)] },
        { key: "b", name: "B", unassigned: false, segments: [segment("late-job", 720, { late: "11:00" }), segment("early-job", 600, { early: "13:00" })] },
      ],
    } as unknown as TodayByCleanerPayload;
    expect(guestTimingToday(payload).map((s) => s.jobId)).toEqual(["early-job", "late-job"]);
  });
});

describe("cleaner re-confirm after the office changes the time", () => {
  const items: ResolvedStartBriefingItem[] = [
    { id: "timing-late-checkout", title: "Late checkout: do not start before 12:30", detail: "Guests are still in the property.", source: "TIMING_RULE" },
  ];

  it("applies to a changed confirmation, and to a missing one only once the job is underway", () => {
    expect(timingReconfirmNeeded({ status: "changed", items }, false)).toBe(true);
    expect(timingReconfirmNeeded({ status: "notAcknowledged", items }, false)).toBe(false);
    expect(timingReconfirmNeeded({ status: "notAcknowledged", items }, true)).toBe(true);
    expect(timingReconfirmNeeded({ status: "current", items }, true)).toBe(false);
    expect(readTimingAckPayload({ status: "bogus" })).toEqual({ status: "unreadable", items: [] });
    expect(readTimingAckPayload(null)).toBeNull();
  });

  it("reads the new time and confirms it with the fingerprint of what was shown", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: "current" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const onSaved = vi.fn();
    render(<TimingReconfirm jobId="job-1" ack={{ status: "changed", items }} jobUnderway onSaved={onSaved} />);
    expect(screen.getByText("The office changed the guest timing")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Read and confirm" }));
    expect(screen.getByText("Late checkout: do not start before 12:30")).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /I've read this — confirm/ })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/cleaner/jobs/job-1/briefing-ack");
    const body = JSON.parse(String(init.body));
    expect(body.startBriefingAck.map((entry: { itemId: string }) => entry.itemId)).toEqual(["timing-late-checkout"]);
    expect(typeof body.startBriefingHash).toBe("string");
  });

  it("re-opens with the newer list when the time changed again while reading", async () => {
    const newer = [{ ...items[0], title: "Late checkout: do not start before 14:00" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "START_BRIEFING_REQUIRED", reason: "STALE", items: newer }), { status: 409 })));
    render(<TimingReconfirm jobId="job-1" ack={{ status: "changed", items }} jobUnderway onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and confirm" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /I've read this — confirm/ })));
    expect(await screen.findByText("Late checkout: do not start before 14:00")).toBeVisible();
    expect(screen.getByText("These instructions changed since you last read them.")).toBeVisible();
  });
});
