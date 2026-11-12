import { describe, expect, it } from "vitest";
import { ListQueryError } from "@/lib/admin/list-query";
import { sizeLabel, type PortfolioRow } from "@/lib/properties/portfolio-options";
import {
  calendarStateOf,
  comparePortfolioRows,
  flagsFor,
  matchesChip,
  parsePortfolioFilters,
  qaFigureOf,
} from "@/lib/properties/portfolio-rules";
import { calendarLabel, nextCleanLabel, qaBasis, qaLabel } from "@/lib/properties/portfolio-format";

const linked = { isEnabled: true, icalUrl: "https://example.invalid/cal.ics", syncStatus: "SUCCESS", syncError: null, lastSyncAt: new Date("2026-11-12T00:00:00Z") };

function row(partial: Partial<PortfolioRow>): PortfolioRow {
  return {
    id: partial.id ?? "p",
    name: partial.name ?? "Property",
    suburb: "Bondi",
    address: "1 St",
    clientId: "c",
    clientName: "Client",
    bedrooms: partial.bedrooms ?? 1,
    bathrooms: partial.bathrooms ?? 1,
    imageUrl: null,
    oneOff: false,
    hasCoords: false,
    jobCount: 0,
    calendar: partial.calendar ?? { kind: "not-linked" },
    nextClean: partial.nextClean ?? null,
    qa: partial.qa ?? { score: null, reviewed: 0 },
    flags: partial.flags ?? [],
  };
}

describe("calendar state", () => {
  it("is not linked without both the switch and a URL, whatever the stored status says", () => {
    expect(calendarStateOf(null, null).kind).toBe("not-linked");
    expect(calendarStateOf({ ...linked, isEnabled: false }, null).kind).toBe("not-linked");
    expect(calendarStateOf({ ...linked, icalUrl: " " }, null).kind).toBe("not-linked");
  });

  it("reports a failure with the time of the latest failed run and the stored reason", () => {
    const failedAt = new Date("2026-11-12T00:00:00Z");
    const state = calendarStateOf({ ...linked, syncStatus: "ERROR", syncError: "404" }, failedAt);
    expect(state).toEqual({ kind: "failed", since: failedAt.toISOString(), error: "404" });
    expect(calendarLabel(state, new Date("2026-11-12T06:00:00Z")).text).toBe("Failed 6 h");
    expect(calendarLabel({ kind: "failed", since: null, error: null }, new Date()).text).toBe("Failed");
  });

  it("an idle linked calendar is 'not synced yet', never 'synced'", () => {
    expect(calendarStateOf({ ...linked, syncStatus: "IDLE", lastSyncAt: null }, null).kind).toBe("never-synced");
  });
});

describe("flags", () => {
  const base = { calendar: { kind: "synced", at: null } as const, keyLostMode: false, lateLaundryRuns: 0, openCareTasks: 0, laundryEnabled: true, laundryTeamSize: 1 };

  it("raises each flag only from its own fact", () => {
    expect(flagsFor(base)).toEqual([]);
    expect(flagsFor({ ...base, calendar: { kind: "failed", since: null, error: null }, keyLostMode: true, lateLaundryRuns: 2, openCareTasks: 1, laundryTeamSize: 0 })).toEqual([
      "sync-error", "key-lost", "linen-late", "care-due", "no-laundry-partner",
    ]);
  });

  it("does not flag a missing laundry partner when laundry service is off", () => {
    expect(flagsFor({ ...base, laundryEnabled: false, laundryTeamSize: 0 })).toEqual([]);
  });

  it("chips: attention is any flag; others match their own flag", () => {
    expect(matchesChip([], null)).toBe(true);
    expect(matchesChip([], "attention")).toBe(false);
    expect(matchesChip(["care-due"], "attention")).toBe(true);
    expect(matchesChip(["care-due"], "key-lost")).toBe(false);
    expect(matchesChip(["key-lost"], "key-lost")).toBe(true);
  });
});

describe("QA over 30 days", () => {
  it("withholds the score below three reviewed cleans and never shows zero", () => {
    expect(qaFigureOf([])).toEqual({ score: null, reviewed: 0 });
    expect(qaFigureOf([90, 95])).toEqual({ score: null, reviewed: 2 });
    expect(qaLabel(qaFigureOf([]))).toBe("Not enough data");
    expect(qaBasis(qaFigureOf([90]))).toMatch(/needs 3/);
  });

  it("averages the authoritative scores when there are enough", () => {
    expect(qaFigureOf([90, 95, 100])).toEqual({ score: 95, reviewed: 3 });
  });
});

describe("ordering", () => {
  it("puts unknown values last in both directions", () => {
    const rows = [row({ id: "a", name: "A" }), row({ id: "b", name: "B", qa: { score: 80, reviewed: 3 } }), row({ id: "c", name: "C", qa: { score: 95, reviewed: 3 } })];
    expect([...rows].sort(comparePortfolioRows("qa", "asc")).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect([...rows].sort(comparePortfolioRows("qa", "desc")).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("orders the next clean by day then time, with no booking last", () => {
    const rows = [
      row({ id: "none" }),
      row({ id: "late", nextClean: { jobId: "j1", jobNumber: "J-1", dayKey: "2026-11-12", startTime: "14:00", status: "ASSIGNED" } }),
      row({ id: "early", nextClean: { jobId: "j2", jobNumber: "J-2", dayKey: "2026-11-12", startTime: "09:00", status: "ASSIGNED" } }),
    ];
    expect([...rows].sort(comparePortfolioRows("nextClean", "asc")).map((r) => r.id)).toEqual(["early", "late", "none"]);
  });

  it("puts failed calendars first when sorting by calendar", () => {
    const rows = [row({ id: "ok", calendar: { kind: "synced", at: null } }), row({ id: "bad", calendar: { kind: "failed", since: null, error: null } })];
    expect([...rows].sort(comparePortfolioRows("calendar", "asc")).map((r) => r.id)).toEqual(["bad", "ok"]);
  });
});

describe("filters", () => {
  it("reads the filters and the old ?includeOneOff=1 link", () => {
    expect(parsePortfolioFilters(new URLSearchParams("q=bondi&chip=key-lost&includeOneOff=1&suburb=Manly"))).toEqual({
      q: "bondi", clientId: "", suburb: "Manly", chip: "key-lost", includeOneOff: true,
    });
  });

  it("refuses an unknown chip or a malformed client id instead of ignoring it", () => {
    expect(() => parsePortfolioFilters(new URLSearchParams("chip=everything"))).toThrow(ListQueryError);
    expect(() => parsePortfolioFilters(new URLSearchParams("clientId=a b"))).toThrow(ListQueryError);
  });
});

describe("words", () => {
  it("labels size and the next clean", () => {
    expect(sizeLabel(0, 1)).toBe("Studio · 1 ba");
    expect(sizeLabel(3, 2)).toBe("3 bd · 2 ba");
    expect(nextCleanLabel(null, new Date())).toBe("None booked");
    const now = new Date("2026-11-12T01:00:00Z");
    expect(nextCleanLabel({ jobId: "j", jobNumber: "J", dayKey: "2026-11-12", startTime: "11:00", status: "ASSIGNED" }, now)).toBe("Today 11:00");
    expect(nextCleanLabel({ jobId: "j", jobNumber: "J", dayKey: "2026-11-13", startTime: "11:00", status: "ASSIGNED" }, now)).toBe("Tomorrow 11:00");
    expect(nextCleanLabel({ jobId: "j", jobNumber: "J", dayKey: "2026-11-20", startTime: "11:00", status: "ASSIGNED" }, now)).toBe("Fri 20 Nov");
  });
});
