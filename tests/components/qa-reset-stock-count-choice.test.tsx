/**
 * Owner decision 2026-11-12: "Reset QA & re-request" asks what happens to
 * stock counts already applied to on-hand before the job leaves Completed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminQaReviews } from "@/components/qa/admin-qa-reviews";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const soap = { observationId: "o1", itemId: "soap", itemName: "Soap", label: "Soap left", unit: "bottle", count: 3, previousOnHand: 10, onHandNow: 3, appliedAt: null };

it("lists applied counts, needs a choice, and sends it with the reset", async () => {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("prompt", vi.fn(() => "Wrong inspection recorded"));
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/admin/qa/reviews")) return new Response(JSON.stringify({ reviews: [] }));
    if (options?.method === "POST") {
      posts.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({ ok: true, deletedReviews: 0, stockCounts: { choice: "KEEP", outcomes: [] } }));
    }
    return new Response(JSON.stringify({ appliedStockCounts: [soap] }));
  }));
  render(<AdminQaReviews jobId="job-1" />);
  fireEvent.click(await screen.findByRole("button", { name: /Request QA inspection/ }));
  expect(await screen.findByText("Stock counts from this job were applied")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Soap" })).toBeTruthy();
  const confirm = screen.getByRole("button", { name: "Reset QA" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole("radio", { name: /Keep them/ }));
  fireEvent.click(confirm);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ confirm: true, reason: "Wrong inspection recorded", appliedStockCounts: "KEEP" });
});
