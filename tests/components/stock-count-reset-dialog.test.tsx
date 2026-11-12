/**
 * Owner decision 2026-11-12: the Reset job dialog shows stock counts already
 * applied to on-hand and asks "Reverse these counts" / "Keep them" with
 * nothing pre-selected; Reset stays disabled until one is chosen; a count
 * applied after the dialog opened arrives in the 409 and is asked again.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobResetDialog } from "@/components/v2/admin/jobs/job-reset-dialog";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const context = { status: "COMPLETED", timeLogCount: 0, assigneeCount: 1, submissionCount: 1, photoCount: 0, qaReviewCount: 0, hasLaundryTask: false, invoicedLineCount: 0 };
const soap = { observationId: "o1", itemId: "soap", itemName: "Soap", label: "Soap left", unit: "bottle", count: 3, previousOnHand: 10, onHandNow: 3, appliedAt: null };
const towels = { observationId: "o2", itemId: "towel", itemName: "Towels", label: "Towels left", unit: null, count: 5, previousOnHand: 8, onHandNow: 5, appliedAt: null };

function resetButton() {
  return screen.getByRole("button", { name: /Reset status only/ }) as HTMLButtonElement;
}

it("lists applied counts, pre-selects nothing, and sends the explicit choice", async () => {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({ ok: true, stockCounts: { choice: "REVERSE", outcomes: [] } }));
    }
    return new Response(JSON.stringify({ context, appliedStockCounts: [soap] }));
  }));
  const onDone = vi.fn();
  render(<JobResetDialog open jobId="job-1" onClose={vi.fn()} onDone={onDone} />);
  expect(await screen.findByText("Stock counts from this job were applied")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Soap" })).toBeTruthy();
  expect(screen.getAllByRole("cell", { name: "3 bottle" })).toHaveLength(2);
  const reverse = screen.getByRole("radio", { name: /Reverse these counts/ }) as HTMLInputElement;
  const keep = screen.getByRole("radio", { name: /Keep them/ }) as HTMLInputElement;
  expect(reverse.checked).toBe(false);
  expect(keep.checked).toBe(false);
  expect(resetButton().disabled).toBe(true);
  fireEvent.click(reverse);
  expect(resetButton().disabled).toBe(false);
  fireEvent.click(resetButton());
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(posts[0]).toMatchObject({ appliedStockCounts: "REVERSE", options: expect.objectContaining({ targetStatus: "ASSIGNED" }) });
});

it("shows counts that arrive in a 409, clears the choice and keeps the dialog open", async () => {
  let posts = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts += 1;
      return new Response(JSON.stringify({ code: "STOCK_COUNT_CHOICE_REQUIRED", error: "Stock counts from this job were already applied to on-hand stock: Towels.", appliedStockCounts: [soap, towels] }), { status: 409 });
    }
    return new Response(JSON.stringify({ context, appliedStockCounts: [soap] }));
  }));
  const onClose = vi.fn();
  render(<JobResetDialog open jobId="job-1" onClose={onClose} onDone={vi.fn()} />);
  await screen.findByText("Stock counts from this job were applied");
  fireEvent.click(screen.getByRole("radio", { name: /Keep them/ }));
  fireEvent.click(resetButton());
  expect(await screen.findByRole("cell", { name: "Towels" })).toBeTruthy();
  expect(posts).toBe(1);
  expect((screen.getByRole("radio", { name: /Keep them/ }) as HTMLInputElement).checked).toBe(false);
  expect(resetButton().disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it("asks nothing when no count was applied", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ context: { ...context, status: "ASSIGNED" }, appliedStockCounts: [] }))));
  render(<JobResetDialog open jobId="job-1" onClose={vi.fn()} onDone={vi.fn()} />);
  await waitFor(() => expect(resetButton().disabled).toBe(false));
  expect(screen.queryByText("Stock counts from this job were applied")).toBeNull();
});
