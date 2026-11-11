import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/v2/cleaner/jobs/job" }));
import { GlobalRequestProgress } from "@/components/shared/global-request-progress";
import { endActivityBatch, publishActivityBatch } from "@/lib/client/activity-batches";

type Pending = { resolve: (response: Response) => void; reject: (error: Error) => void };
let pending: Pending[];

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const ok = () => new Response("{}", { status: 200 });

it("shows one bar for a whole photo batch and counts finished files", async () => {
  render(<GlobalRequestProgress />);
  const requests = [1, 2, 3].map(() => window.fetch("/api/uploads/direct", { method: "POST" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument(); // Quick work stays silent.
  await advance(600);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 3 files");
  await act(async () => { pending[0].resolve(ok()); await requests[0]; });
  expect(screen.getByRole("status")).toHaveTextContent("Uploading 2 of 3 files");
  expect(screen.getByRole("status")).toHaveTextContent("1/3");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  await act(async () => { pending[1].resolve(ok()); pending[2].resolve(ok()); await Promise.all(requests); });
  expect(screen.getByRole("status")).toHaveTextContent("3 files uploaded");
  await advance(3999);
  expect(screen.getByRole("status")).toBeInTheDocument();
  await advance(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("uses the Estate skin on Estate pages", async () => {
  render(<GlobalRequestProgress />);
  void window.fetch("/api/uploads/direct", { method: "POST" });
  await advance(600);
  expect(screen.getByRole("status")).toHaveAttribute("data-skin", "estate");
});

it("keeps a long-running request visible and does not call an HTTP failure a success", async () => {
  render(<GlobalRequestProgress />);
  const request = window.fetch("/api/reports/generate", { method: "POST" });
  await advance(6000);
  expect(screen.getByRole("status")).toHaveTextContent("Generating report");
  await act(async () => { pending[0].resolve(new Response("Denied", { status: 403 })); await request; });
  expect(screen.getByRole("alert")).toHaveTextContent("Generating report failed");
  await advance(9999);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  await advance(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("announces a failure even when it happened before the bar would have appeared", async () => {
  render(<GlobalRequestProgress />);
  const request = window.fetch("/api/uploads/direct", { method: "POST" }).catch(() => undefined);
  await act(async () => { pending[0].reject(new Error("offline")); await request; });
  expect(screen.getByRole("alert")).toHaveTextContent("The upload did not finish");
});

it("says nothing about work that finished quickly", async () => {
  render(<GlobalRequestProgress />);
  const request = window.fetch("/api/uploads/direct", { method: "POST" });
  await act(async () => { pending[0].resolve(ok()); await request; });
  await advance(5000);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("leaves untracked and opted-out requests alone", async () => {
  render(<GlobalRequestProgress />);
  void window.fetch("/api/admin/jobs");
  void window.fetch("/api/uploads/direct", { method: "POST", headers: { "x-progress-toast": "off" } });
  await advance(2000);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("can be dismissed once the batch has finished", async () => {
  render(<GlobalRequestProgress />);
  const request = window.fetch("/api/reports/job/pdf");
  await advance(700);
  await act(async () => { pending[0].resolve(ok()); await request; });
  expect(screen.getByRole("status")).toHaveTextContent("Report PDF ready");
  await act(async () => { screen.getByRole("button", { name: "Dismiss" }).click(); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows a component's own batch in the same bar without double counting its requests", async () => {
  render(<GlobalRequestProgress />);
  await act(async () => { publishActivityBatch({ id: "capture", total: 2, done: 0, failed: 0, inFlight: [{ percent: 40, phase: "uploading" }] }); });
  // The batch's own allocation and part requests are not counted again.
  void window.fetch("/api/uploads/presign-multipart", { method: "POST" });
  void window.fetch("/api/uploads/part?x=1", { method: "POST" });
  await advance(600);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 2 files");
  expect(screen.getByRole("status")).toHaveTextContent("0/2");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  await act(async () => { endActivityBatch("capture", { done: 2, failed: 0 }); });
  expect(screen.getByRole("status")).toHaveTextContent("2 files uploaded");
});

it("reports a failed file from a component batch as an alert", async () => {
  render(<GlobalRequestProgress />);
  await act(async () => { publishActivityBatch({ id: "capture-2", total: 2, done: 0, failed: 0, inFlight: [] }); });
  await advance(600);
  await act(async () => { endActivityBatch("capture-2", { done: 1, failed: 1 }); });
  expect(screen.getByRole("alert")).toHaveTextContent("1 of 2 uploads did not finish");
});
