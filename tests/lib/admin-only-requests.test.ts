import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { isAdminOnlyRequest } from "@/lib/job-tasks/service";

/**
 * A reschedule is not a task.
 *
 * Client scheduling requests were created as JobTasks, and approval — whether
 * by an admin or by the auto-approve sweep — flipped visibleToCleaner. So a
 * cleaner opened their job and found "Reschedule request" in the checklist with
 * a photo box under it, asking them to photograph a date change.
 *
 * The predicate has to match BOTH shapes, because both are already in the
 * database: the light UPDATE/ETA/REPORT requests tag `kind`, the scheduling
 * routes tag `type`.
 */
describe("isAdminOnlyRequest", () => {
  it("matches the light requests that tag kind", () => {
    expect(isAdminOnlyRequest({ kind: "CLIENT_REQUEST", requestType: "ETA" })).toBe(true);
  });

  it("matches scheduling requests that tag type", () => {
    expect(
      isAdminOnlyRequest({ type: "RESCHEDULE_REQUEST", requestedDate: "2026-09-03" })
    ).toBe(true);
    expect(isAdminOnlyRequest({ type: "CANCELLATION_REQUEST" })).toBe(true);
    expect(isAdminOnlyRequest({ type: "SKIP_REQUEST" })).toBe(true);
  });

  it("leaves real cleaner work alone", () => {
    // An actual requested task — "clean the balcony" — must still reach the
    // cleaner, or this fix would hide the thing it exists to protect.
    expect(isAdminOnlyRequest(null)).toBe(false);
    expect(isAdminOnlyRequest({})).toBe(false);
    expect(isAdminOnlyRequest({ note: "Please do the balcony" })).toBe(false);
  });

  it("does not match an unknown type", () => {
    expect(isAdminOnlyRequest({ type: "SOMETHING_ELSE" })).toBe(false);
  });

  it("survives junk metadata rather than throwing", () => {
    expect(isAdminOnlyRequest(undefined)).toBe(false);
    expect(isAdminOnlyRequest("RESCHEDULE_REQUEST")).toBe(false);
    expect(isAdminOnlyRequest(42)).toBe(false);
    expect(isAdminOnlyRequest([{ type: "RESCHEDULE_REQUEST" }])).toBe(false);
  });

  it("ignores a non-string type", () => {
    expect(isAdminOnlyRequest({ type: 1 })).toBe(false);
    expect(isAdminOnlyRequest({ type: null })).toBe(false);
  });
});
