// @vitest-environment node
import { describe, expect, it } from "vitest";
import { guestSourceInfo, lostFoundStages, statusPill, visitedStatuses, formatFoundDay } from "@/components/v2/admin/lost-found/lost-found-format";
import { readLostFoundView, listQueryString, viewSearch, DEFAULT_VIEW } from "@/components/v2/admin/lost-found/lost-found-view";
import { draftLostFoundMessage, mailtoHref, PIPELINE_UNSUPPORTED_REASON } from "@/lib/lost-found/message";

describe("lost and found display", () => {
  it("says where the guest came from and never guesses", () => {
    expect(guestSourceInfo({ guestSource: "BOOKING", jobHasBooking: true, jobId: "j" }).label).toBe("from booking");
    expect(guestSourceInfo({ guestSource: "MANUAL", jobHasBooking: true, jobId: "j" }).label).toBe("entered by office");
    expect(guestSourceInfo({ guestSource: null, jobHasBooking: false, jobId: "j" }).label).toBe("No booking on job");
    expect(guestSourceInfo({ guestSource: null, jobHasBooking: null, jobId: null }).label).toBe("No job linked");
  });
  it("shows days held and warns past the holding period", () => {
    expect(statusPill("IN_STORAGE", { counts: true, days: 16, past: true })).toEqual({ label: "In storage · 16 d", tone: "warn" });
    expect(statusPill("REPORTED", { counts: false, days: null, past: false })).toEqual({ label: "New", tone: "bad" });
    expect(statusPill("RETURN_OFFERED", { counts: true, days: 3, past: false }).label).toBe("Return arranged · 3 d");
    expect(statusPill("DONATED", { counts: false, days: null, past: false }).label).toBe("Donated");
  });
  it("marks skipped stages as passed, not done", () => {
    const visited = visitedStatuses([{ action: "GUEST_CONTACTED", meta: { fromStatus: "REPORTED", toStatus: "GUEST_CONTACTED" } }]);
    expect(lostFoundStages("GUEST_CONTACTED", visited).map((stage) => stage.state)).toEqual(["done", "passed", "current", "todo", "todo"]);
    expect(lostFoundStages("DONATED", visited)[4]).toMatchObject({ state: "current", note: "Donated" });
  });
  it("formats found days in the organisation calendar", () => {
    expect(formatFoundDay("2026-11-10T14:00:00Z", "Australia/Sydney", new Date("2026-11-11T02:00:00Z"))).toBe("Today");
    expect(formatFoundDay("2026-11-03T02:00:00Z", "Australia/Sydney", new Date("2026-11-11T02:00:00Z"))).toBe("3 Nov");
  });
  it("keeps the view in the URL and asks the server for one page", () => {
    const view = readLostFoundView("?stage=closed&closedAs=DONATED&q=watch&holding=past&sort=item&dir=desc&page=2&open=abc");
    expect(view).toMatchObject({ tab: "closed", closedAs: "DONATED", q: "watch", holding: true, sort: "item", dir: "desc", page: 2, open: "abc" });
    expect(new URLSearchParams(listQueryString(view, 25)).get("paginated")).toBe("1");
    expect(viewSearch(DEFAULT_VIEW)).toBe("");
    expect(readLostFoundView("?stage=nope&closedAs=REPORTED&open=../x").tab).toBe("new");
  });
});

describe("message drafts", () => {
  const input = { audience: "guest" as const, itemName: "Watch, silver", foundAt: "2026-11-10T00:20:00Z", foundLocation: "Bedside table", propertyName: "The Bondi Studio", propertyAddress: "1 Test St, Bondi", guestName: "Priya Shah", clientName: "Harbour Stays", officeName: "sNeek", officePhone: "02 9000 0000", timeZone: "Australia/Sydney" };
  it("drafts a guest message with the item, place, return options and office contact", () => {
    const draft = draftLostFoundMessage(input);
    expect(draft.subject).toBe("Item found after your stay at The Bondi Studio");
    expect(draft.body).toContain("Hi Priya,");
    expect(draft.body).toContain("Watch, silver (Bedside table)");
    expect(draft.body).toContain("Tuesday 10 November");
    expect(draft.body).toContain("collect it or have it sent to you");
    expect(draft.body).toContain("02 9000 0000");
    expect(draft.body).not.toMatch(/fee|\$/);
  });
  it("drafts a client message and says the app cannot send it", () => {
    const draft = draftLostFoundMessage({ ...input, audience: "client" });
    expect(draft.body).toContain("Hi Harbour Stays,");
    expect(draft.body).toContain("1 Test St, Bondi");
    expect(PIPELINE_UNSUPPORTED_REASON).toMatch(/cannot send/);
    expect(mailtoHref(null, draft)).toBeNull();
    expect(mailtoHref("a@b.invalid", draft)).toMatch(/^mailto:a%40b\.invalid\?subject=/);
  });
});
