// @vitest-environment node
/**
 * Workforce redesign (board "Workforce", 2026-11-16): the compliance action
 * list, the expired-document assignment warning, the team leave model, the
 * administrator-only dismissal outcomes, and proof that the weekly
 * availability pattern is shown only (nothing in suggestions or assignment
 * reads the CleanerAvailability table).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildComplianceRows, complianceFigures, nextToReview, toneForState } from "@/lib/workforce/compliance-rows";
import { documentWarningsFor, policeCheckExpiry } from "@/lib/workforce/assignment-document-rules";
import { cellFor, coverHref, coverWords, leaveByRange, leaveWindow, mondayOf, patternWords, type TeamLeavePerson } from "@/lib/workforce/team-leave-model";
import { canRecordDismissal, isDismissalOutcome } from "@/lib/workforce/coaching-outcomes";
import { WORKFORCE_TABS } from "@/lib/workforce/workforce-tabs";

const NOW = new Date("2026-11-14T01:00:00Z");

function doc(partial: Partial<Parameters<typeof buildComplianceRows>[0]["documents"][number]>) {
  return {
    id: "d1", title: "Police check", category: "POLICE_CHECK", status: "VERIFIED", expiresAt: null, createdAt: "2026-10-01T00:00:00Z",
    requiresSignature: false, userId: "u1", userName: "Liam", verifiedByName: "Hannah", ...partial,
  };
}

describe("compliance action list", () => {
  it("lists expired, expiring, waiting and requested rows by urgency, and never invents a state for a missing date", () => {
    const rows = buildComplianceRows({
      documents: [
        doc({ id: "expired", expiresAt: "2026-11-02T00:00:00Z" }),
        doc({ id: "soon", userId: "u2", userName: "Maria", expiresAt: "2026-11-21T00:00:00Z" }),
        doc({ id: "later", userId: "u3", userName: "Tom", expiresAt: "2027-06-30T00:00:00Z" }),
        doc({ id: "pending-new", userId: "u4", userName: "Grace", status: "PENDING", createdAt: "2026-11-11T00:00:00Z" }),
        doc({ id: "pending-old", userId: "u3", userName: "Tom", status: "PENDING", createdAt: "2026-11-10T00:00:00Z", category: "INSURANCE" }),
        doc({ id: "no-date", userId: "u5", userName: "Dev" }),
      ],
      requests: [
        { id: "r-late", title: "First aid", category: "TRAINING", dueAt: "2026-11-10T00:00:00Z", createdAt: "2026-11-02T00:00:00Z", userId: "u6", userName: "Sofia", requestedByName: "Hannah" },
        { id: "r-due", title: "Licence", category: "DRIVER_LICENCE", dueAt: null, createdAt: "2026-11-02T00:00:00Z", userId: "u7", userName: "Jane", requestedByName: null },
      ],
      profiles: [{ userId: "u8", userName: "Aiko", visaExpiry: "2027-01-09T00:00:00Z", driverLicenseExpiry: null, vehicleRegoExpiry: "2027-12-01T00:00:00Z" }],
    }, NOW);
    expect(rows.map((row) => row.key)).toEqual([
      "expiry:expired", "request:r-late", "expiry:soon", "profile:u8:VISA", "review:pending-old", "review:pending-new", "request:r-due",
    ]);
    expect(rows.find((row) => row.key === "profile:u8:VISA")).toMatchObject({ kind: "profile_date", state: "EXPIRING", title: "Visa / right to work" });
    expect(rows.some((row) => row.documentId === "no-date" || row.documentId === "later")).toBe(false);
    expect(complianceFigures(rows)).toEqual({ needsAction: 7, expired: 1, expiring: 2, waitingReview: 2, requested: 2, requestedPastDue: 1 });
    expect(toneForState("EXPIRED")).toBe("problem");
    expect(toneForState("REQUESTED")).toBeNull();
  });

  it("a renewed document hides the old expired one; a rejected file never decides", () => {
    const rows = buildComplianceRows({
      documents: [
        doc({ id: "old", expiresAt: "2026-01-01T00:00:00Z" }),
        doc({ id: "renewed", expiresAt: "2029-01-01T00:00:00Z" }),
        doc({ id: "rejected", userId: "u2", status: "REJECTED", expiresAt: "2026-01-01T00:00:00Z" }),
      ],
      requests: [],
      profiles: [],
    }, NOW);
    expect(rows).toEqual([]);
  });

  it("Next to review walks the waiting uploads in list order and stops at the end", () => {
    const rows = buildComplianceRows({
      documents: [doc({ id: "a", status: "PENDING", createdAt: "2026-11-01T00:00:00Z" }), doc({ id: "b", userId: "u2", status: "PENDING", createdAt: "2026-11-02T00:00:00Z" })],
      requests: [],
      profiles: [],
    }, NOW);
    expect(nextToReview(rows, null)?.documentId).toBe("a");
    expect(nextToReview(rows, "a")?.documentId).toBe("b");
    expect(nextToReview(rows, "b")).toBeNull();
  });
});

describe("expired police check or visa on assignment (warns, never blocks)", () => {
  it("warns when the latest usable police check or the visa ends before the job day", () => {
    expect(documentWarningsFor({ userId: "c", name: "Jane", visaExpiry: new Date("2026-11-10T00:00:00Z"), policeChecks: [{ status: "VERIFIED", expiresAt: new Date("2026-11-02T00:00:00Z") }] }, "2026-11-14"))
      .toEqual([
        { userId: "c", name: "Jane", kind: "POLICE_CHECK", expiredOn: "2026-11-02", reason: "police check expired 2 Nov 2026" },
        { userId: "c", name: "Jane", kind: "VISA", expiredOn: "2026-11-10", reason: "visa / right to work expired 10 Nov 2026" },
      ]);
  });

  it("expiring on the job day is still valid; no police check on file is not an expiry; a never-expiring check wins", () => {
    expect(documentWarningsFor({ userId: "c", name: "Jane", visaExpiry: new Date("2026-11-14T00:00:00Z"), policeChecks: [{ status: "VERIFIED", expiresAt: new Date("2026-11-14T00:00:00Z") }] }, "2026-11-14")).toEqual([]);
    expect(documentWarningsFor({ userId: "c", name: "Jane", visaExpiry: null, policeChecks: [] }, "2026-11-14")).toEqual([]);
    expect(policeCheckExpiry([{ status: "VERIFIED", expiresAt: null }, { status: "VERIFIED", expiresAt: new Date("2020-01-01") }])).toEqual({ dayKey: null, markedExpired: false });
    expect(documentWarningsFor({ userId: "c", name: "Jane", visaExpiry: null, policeChecks: [{ status: "EXPIRED", expiresAt: null }] }, "2026-11-14")[0].reason).toBe("police check marked expired");
  });
});

describe("team leave view", () => {
  const person: TeamLeavePerson = {
    id: "s", name: "Sofia", role: "CLEANER",
    leave: [{ id: "l", userId: "s", kind: "LEAVE", startDate: "2026-11-19", endDate: "2026-11-23", note: "Family in Perth", jobsNeedingCover: 4 }],
    usuallyUnavailable: [{ dayOfWeek: 0, startTime: "00:00", endTime: "23:59", note: null }],
  };

  it("builds a Monday fortnight and places leave over the weekly pattern", () => {
    const window = leaveWindow(mondayOf("2026-11-18"), 14);
    expect(window.start).toBe("2026-11-16");
    expect(window.end).toBe("2026-11-29");
    expect(cellFor(person, "2026-11-22", window.start)).toMatchObject({ kind: "leave", first: false });
    expect(cellFor(person, "2026-11-19", window.start)).toMatchObject({ kind: "leave", first: true });
    expect(cellFor(person, "2026-11-29", window.start)).toMatchObject({ kind: "usual" });
    expect(cellFor(person, "2026-11-17", window.start)).toEqual({ kind: "none" });
    expect(patternWords(person.usuallyUnavailable[0])).toBe("Sundays");
  });

  it("links jobs needing cover into Jobs filtered by person and days, and never shows an uncounted total as zero", () => {
    expect(coverHref(person.leave[0])).toBe("/v2/admin/jobs?cleanerId=s&dateFrom=2026-11-19&dateTo=2026-11-23");
    expect(coverWords(4)).toBe("4 jobs need cover");
    expect(coverWords(1)).toBe("1 job needs cover");
    expect(coverWords(0)).toBeNull();
    expect(coverWords(null)).toBe("jobs not counted");
    expect(leaveByRange([person])[0]).toMatchObject({ startDate: "2026-11-19", endDate: "2026-11-23" });
  });
});

describe("Suspended and Terminated are recorded by administrators only", () => {
  it("checks held roles after any test-as swap", () => {
    expect(isDismissalOutcome("SUSPENDED")).toBe(true);
    expect(isDismissalOutcome("RETRAINED")).toBe(false);
    expect(canRecordDismissal({ user: { role: "ADMIN" as never, heldRoles: ["ADMIN" as never] } })).toBe(true);
    expect(canRecordDismissal({ user: { role: "OPS_MANAGER" as never, heldRoles: ["OPS_MANAGER" as never] } })).toBe(false);
    // An administrator testing as a manager carries the manager's held roles only.
    expect(canRecordDismissal({ user: { role: "OPS_MANAGER" as never, heldRoles: ["OPS_MANAGER" as never] } })).toBe(false);
  });
});

describe("the weekly availability pattern is shown only", () => {
  const root = path.resolve(__dirname, "../..");
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("only the team leave view reads the CleanerAvailability table", () => {
    const readers = ["app", "lib", "components"]
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) => /\b(db|tx|prisma)\.cleanerAvailability\b/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(readers).toEqual(["lib/workforce/team-leave.ts"]);
  });

  it("cleaner suggestions, the move check and assignment keep reading the saved availability profile, not the table", () => {
    for (const file of ["lib/jobs/cleaner-suggestions.ts", "lib/jobs/cleaner-suggestions-load.ts", "lib/calendar/check-move.ts", "app/api/admin/jobs/[id]/assign/route.ts"]) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(text).not.toMatch(/cleanerAvailability\b|team-leave/);
    }
    expect(readFileSync(path.join(root, "lib/jobs/cleaner-suggestions-load.ts"), "utf8")).toMatch(/listCleanerAvailabilities/);
  });
});

describe("Workforce tabs keep the old deep links", () => {
  it("has the five tabs in the drawn order with the old URLs", () => {
    expect(WORKFORCE_TABS.map((tab) => [tab.label, tab.href])).toEqual([
      ["Compliance", "/v2/admin/workforce/compliance"],
      ["Roster", "/v2/admin/workforce/roster"],
      ["Leave and availability", "/v2/admin/workforce/leave"],
      ["Coaching", "/v2/admin/workforce/coaching"],
      ["Recognition", "/v2/admin/workforce/recognition"],
    ]);
  });
});

describe("every old workforce function stays reachable", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("keeps the old pages, the overview redirect and each action", () => {
    for (const page of ["compliance", "roster", "coaching", "recognition", "leave", "performance/[id]"]) {
      expect(statSync(path.join(root, `app/v2/admin/workforce/${page}/page.tsx`)).isFile()).toBe(true);
    }
    expect(read("app/v2/admin/workforce/page.tsx")).toMatch(/redirect\(peopleRedirectTarget\("cleaners"/);
    const compliance = read("components/v2/admin/workforce/compliance-board.tsx");
    for (const action of ["UPLOAD_DOCUMENT", "REVIEW_DOCUMENT", "DocumentRequestDialog", "DocumentReminderDialog", "All documents on file", "Answers an outstanding request"]) {
      expect(compliance.includes(action) || read("components/v2/admin/workforce/compliance-review.tsx").includes(action)).toBe(true);
    }
    const roster = read("components/v2/admin/workforce/roster-table.tsx");
    expect(roster).toMatch(/\/v2\/admin\/workforce\/performance\//);
    expect(roster).toMatch(/\/v2\/admin\/accounts\/users\//);
    const coaching = read("components/v2/admin/workforce/coaching-workspace.tsx");
    expect(coaching).toMatch(/method: "POST"[\s\S]*accountability\/coaching|accountability\/coaching[\s\S]*method: "POST"/);
    expect(coaching).toMatch(/method: "PATCH"/);
    expect(read("components/v2/admin/workforce/recognition-board.tsx")).toMatch(/SEND_RECOGNITION/);
    expect(read("components/v2/admin/people/account-list-tab.tsx")).toMatch(/\/v2\/admin\/workforce\/leave/);
  });
});
