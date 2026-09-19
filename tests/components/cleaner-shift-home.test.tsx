import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Page from "@/app/v2/cleaner/page";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), jobs: vi.fn(), attention: vi.fn(), settings: vi.fn(), user: vi.fn(), clock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: mocks.jobs }, user: { findUnique: mocks.user } } }));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getCleanerImmediateAttention: mocks.attention }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/time/auto-clockout", () => ({ autoClockOutStaleTimeLogsForUser: mocks.clock }));
vi.mock("@/components/v2/cleaner/daily-briefing", () => ({ DailyBriefing: () => <p>Daily brief</p> }));
vi.mock("@/components/v2/cleaner/coaching-card", () => ({ CleanerCoachingCard: () => null }));
vi.mock("@/components/v2/cleaner/qa-feedback-card", () => ({ CleanerQaFeedbackCard: () => null }));
vi.mock("@/components/v2/cleaner/job-offer-actions", () => ({ JobOfferActions: ({ jobId }: { jobId: string }) => <button>Respond to {jobId}</button> }));
const job = (id: string, responseStatus: string, status = "ASSIGNED", scheduledDate = "2026-10-04") => ({ id, jobType: "GENERAL_CLEAN", status, scheduledDate: new Date(`${scheduledDate}T00:00:00Z`), startTime: "09:00", dueTime: null, sameDayCheckin: false, sameDayCheckinTime: null, estimatedHours: 2, isRework: false, reworkPayAmount: null, internalNotes: null,
  assignments: [{ userId: "cleaner", payRate: null, responseStatus }], property: { name: id, address: "1 Test Street", suburb: "Sydney", state: "NSW", postcode: "2000", cleaningDurationMinutes: 120 } });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T15:00:00Z")); localStorage.clear(); mocks.auth.mockResolvedValue({ user: { id: "cleaner", name: "Alex" } }); mocks.jobs.mockResolvedValue([]); mocks.attention.mockResolvedValue([]); mocks.settings.mockResolvedValue(null); mocks.user.mockResolvedValue(null); mocks.clock.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());
it("combines accepted work, own pending offers and route without treating a team-assigned offer as accepted", async () => {
  mocks.jobs.mockResolvedValue([job("Accepted", "ACCEPTED"), job("Pending", "PENDING"), job("Future offer", "PENDING", "OFFERED", "2026-12-01")]);
  render(await Page());
  expect(screen.getByText("1 accepted job today.")).toBeVisible(); expect(screen.getByText(/2 pending offers/)).toBeVisible();
  const route = within(screen.getByRole("region", { name: "Today's route" }));
  expect(route.getByRole("link", { name: "Accepted" })).toBeVisible(); expect(route.queryByRole("link", { name: "Pending" })).toBeNull();
  expect(screen.getByRole("button", { name: "Respond to Pending" })).toBeVisible(); expect(screen.getByRole("button", { name: "Respond to Future offer" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Respond to Accepted" })).toBeNull();
  expect(mocks.jobs.mock.calls[0][0].where).toMatchObject({ assignments: { some: { userId: "cleaner", removedAt: null } }, cleanSkipStatus: { not: "SKIPPED" }, OR: [{ scheduledDate: { gte: new Date("2026-10-04T00:00:00Z"), lt: new Date("2026-10-11T00:00:00Z") } }, { assignments: { some: { userId: "cleaner", removedAt: null, responseStatus: "PENDING" } } }] });
});
it("shows a retryable unavailable shift instead of an empty day when the query fails", async () => {
  mocks.jobs.mockRejectedValue(new Error("offline")); render(await Page());
  expect(screen.getByRole("alert")).toHaveTextContent("Jobs and route are unavailable");
  expect(screen.getByRole("link", { name: "Refresh shift" })).toHaveAttribute("href", "/v2/cleaner");
  expect(screen.queryByRole("region", { name: "Today's route" })).toBeNull();
  expect(screen.queryByText(/No accepted jobs|enjoy the day/)).toBeNull(); expect(screen.getAllByText("Unavailable")).toHaveLength(3);
});
it("isolates attention failure without hiding assigned jobs", async () => {
  mocks.jobs.mockResolvedValue([job("Accepted", "ACCEPTED")]); mocks.attention.mockRejectedValue(new Error("offline")); render(await Page());
  expect(screen.getByRole("alert")).toHaveTextContent("Attention items are unavailable");
  expect(screen.getByRole("region", { name: "Today's route" })).toHaveTextContent("Accepted");
});
it("keeps post-submission work out of route stops and next work", async () => {
  mocks.jobs.mockResolvedValue([job("Review", "ACCEPTED", "QA_REVIEW"), job("Next work", "ACCEPTED")]); render(await Page());
  const route = within(screen.getByRole("region", { name: "Today's route" }));
  expect(route.queryByRole("link", { name: "Review" })).toBeNull(); expect(route.getByRole("link", { name: "Next work" })).toBeVisible();
});
it("keeps genuine empty shift and date scope explicit", async () => {
  render(await Page()); expect(screen.getByText("No accepted jobs scheduled today.")).toBeVisible(); expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByRole("region", { name: "Today's route" })).toHaveTextContent("No accepted stops awaiting work");
});
it("does not claim future work is empty when only a later accepted job exists", async () => {
  mocks.jobs.mockResolvedValue([job("Later property", "ACCEPTED", "ASSIGNED", "2026-10-06")]); render(await Page());
  expect(screen.getByText(/Your next accepted job is .*Later property/)).toBeVisible();
  expect(screen.queryByText(/no jobs booked.*days ahead/i)).toBeNull();
});
