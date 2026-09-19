import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActiveWorkStatus } from "@/components/v2/cleaner/active-work-status";
import { writeDraftStatus } from "@/lib/cleaner/draft-status-snapshot";
const mocks = vi.hoisted(() => ({ list: vi.fn(), volatile: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", () => ({ listEvidence: mocks.list }));
vi.mock("@/lib/cleaner/evidence-volatile", () => ({ getVolatileEvidenceCount: mocks.volatile, subscribeVolatileEvidence: () => () => {} }));
beforeEach(() => { mocks.list.mockResolvedValue([]); mocks.volatile.mockReturnValue(0); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = (identity: string) => ({ identity, jobId: "job", clock: { running: false, startedAt: null }, checkedAt: new Date().toISOString() });
it("shows current-user clock and latest draft acknowledgement without claiming global synchronization", async () => {
  writeDraftStatus("status-one", "saving"); render(<ActiveWorkStatus {...props("status-one")}/>);
  expect(await screen.findByText(/Latest draft save not confirmed/)).toBeVisible();
  expect(screen.getByText("Your clock: stopped.")).toBeVisible();
  await act(async () => writeDraftStatus("status-one", "saved"));
  expect(screen.getByText(/Draft save last confirmed/)).toBeVisible();
  await act(async () => writeDraftStatus("another-actor", "error"));
  expect(screen.getByText(/Draft save last confirmed/)).toBeVisible();
});
it("counts only actor/job pending evidence and retains volatile and storage failure warnings", async () => {
  mocks.list.mockResolvedValue([{ draftIdentity: "own", jobId: "job", status: "uploading" }, { draftIdentity: "other", jobId: "job", status: "uploading" }, { draftIdentity: "own", jobId: "other", status: "captured" }, { draftIdentity: "own", jobId: "job", status: "attached" }]);
  mocks.volatile.mockReturnValue(2);
  render(<ActiveWorkStatus {...props("own")}/>);
  expect(await screen.findByText(/1 evidence item\(s\) need recovery/)).toHaveTextContent("2 original file(s) only in memory");
  mocks.list.mockRejectedValue(new Error("storage"));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(await screen.findByText(/Device evidence status unavailable/)).toHaveTextContent("2 original file(s) only in memory");
  expect(screen.queryByText(/No pending evidence/)).toBeNull();
});
it("labels old clock observations as stale", async () => {
  render(<ActiveWorkStatus {...props("stale")} checkedAt={new Date(Date.now() - 120_000).toISOString()}/>);
  expect(screen.getByText(/Last checked clock: stopped - status may have changed/)).toBeVisible();
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
});
