import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NotificationDispatchStatus } from "@/components/notifications/notification-dispatch-status";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("surfaces held or ambiguous sends without offering a blind resend", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ hasMore: false,
    mobile: [{ id: "n", subject: "Laundry update", status: "REVIEW_REQUIRED", detail: "Missing category" }],
    attempts: [{ id: "r", event: "cleaner.day_reminder", status: "UNCERTAIN", needsReview: true }],
  }) })));
  render(<NotificationDispatchStatus />);
  expect(await screen.findByText(/2 recent items need review/)).toBeVisible();
  expect(screen.getByText(/Laundry update: review required/)).toBeVisible();
  expect(screen.getByText(/Check individual channel logs/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
});
it("distinguishes unavailable status from an empty queue", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  render(<NotificationDispatchStatus />);
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  expect(screen.queryByText(/0 recent mobile/)).not.toBeInTheDocument();
});

it.each([
  ["MISSING", false, "No dedicated worker heartbeat"],
  ["STALE", false, "heartbeat is stale"],
  ["ACTIVE", false, "mobile notification dispatch is disabled"],
  ["ACTIVE", true, "heartbeat is current"],
] as const)("explains worker %s with mobile dispatch %s", async (status, mobileDispatcherActive, message) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    worker: { status, mobileDispatcherActive, lastSeenAt: null }, hasMore: true,
    mobile: [
      { id: "held", subject: null, status: "UNCERTAIN", detail: null },
      { id: "accepted", subject: "Accepted message", status: "ACCEPTED", detail: null },
    ], attempts: [{ id: "done", event: "completed.event", status: "ATTEMPTED", needsReview: false }],
  }) })));
  render(<NotificationDispatchStatus />);
  expect(await screen.findByText(new RegExp(message))).toBeVisible();
  expect(screen.getByText(/1 recent items need review/)).toHaveTextContent("More history exists.");
  expect(screen.getByText(/Notification: uncertain/)).toBeVisible();
  expect(screen.queryByText(/Accepted message/)).not.toBeInTheDocument();
  expect(screen.queryByText(/completed.event/)).not.toBeInTheDocument();
});
it.each([false, true])("ignores a late fetch after navigation (reject=%s)", async reject => {
  let resolve!: (value: unknown) => void;
  let fail!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((yes, no) => { resolve = yes; fail = no; })));
  const view = render(<NotificationDispatchStatus />);
  expect(screen.getByText(/Loading recent delivery status/)).toBeVisible();
  view.unmount();
  await act(async () => {
    if (reject) fail(new Error("offline"));
    else resolve({ ok: true, json: async () => ({ hasMore: false, mobile: [], attempts: [] }) });
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(view.container).toBeEmptyDOMElement();
});
