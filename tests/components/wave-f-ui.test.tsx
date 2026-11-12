import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddToRunDialog } from "@/components/v2/admin/inventory/urgent/add-to-run-dialog";
import { PurchaseAsksCard } from "@/components/v2/cleaner/purchase-asks-card";
import { cardFacts, dayWithTime } from "@/components/v2/admin/laundry/laundry-lane-card";
import type { PipelineCardDTO } from "@/components/v2/admin/laundry/use-laundry-pipeline";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const need = { id: "11111111-1111-4111-8111-111111111111", itemName: "Toilet paper", propertyName: "Bondi", unit: "roll", purchaseQuantity: null, suggestedBuy: 12 };

it("Add to shopping run: keeps the form and its request id through a failed save, and says adding is not buying", async () => {
  const posts: Array<Record<string, unknown>> = [];
  let fail = true;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts.push(JSON.parse(String(options.body)));
      return fail ? new Response(JSON.stringify({ error: "This shopping run was already submitted, so it is closed." }), { status: 409 }) : new Response(JSON.stringify({ run: { id: "r1", title: "Thu shop" }, results: [{ id: need.id, outcome: "done", message: "Added to Thu shop: 12 roll." }] }));
    }
    return new Response(JSON.stringify({ runs: [{ id: "r1", title: "Thu shop", ownerName: "Ops", status: "DRAFT", lineCount: 2, properties: ["Bondi"], updatedAt: new Date().toISOString() }] }));
  }));
  const onDone = vi.fn();
  render(<AddToRunDialog needs={[need]} onClose={vi.fn()} onDone={onDone} />);
  expect(screen.getByText(/does not buy anything or mark the need ordered or delivered/)).toBeTruthy();
  await waitFor(() => expect((screen.getByRole("radio", { name: /Thu shop/ }) as HTMLInputElement).checked).toBe(true));
  expect((screen.getByLabelText(/Toilet paper · Bondi/) as HTMLInputElement).value).toBe("12");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already submitted");
  expect((screen.getByLabelText(/Toilet paper · Bondi/) as HTMLInputElement).value).toBe("12");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(posts[1].requestId).toBe(posts[0].requestId);
  expect(posts[0]).toMatchObject({ needIds: [need.id], target: { kind: "existing", runId: "r1" }, quantities: { [need.id]: 12 } });
  expect(await screen.findByText(/Added to Thu shop/)).toBeTruthy();
});

it("cleaner job screen: answers an ask with Accept, and hides itself when there is nothing to answer", async () => {
  const posts: Array<{ url: string; body: unknown }> = [];
  let asks = [{ id: "a1", state: "ASKED", itemName: "Soap", unit: "bottle", quantity: 3, propertyName: "Bondi", jobId: "j1", note: null, askedByName: "Office", askedAt: new Date().toISOString(), runId: null }];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(options.body)) });
      asks = [];
      return new Response(JSON.stringify({ id: "a1", state: "ACCEPTED", runId: "r9" }));
    }
    return new Response(JSON.stringify({ asks }));
  }));
  render(<PurchaseAsksCard jobId="j1" />);
  expect(await screen.findByText(/3 bottle Soap/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText(/Added to your shopping run/)).toBeTruthy();
  expect(posts[0]).toEqual({ url: "/api/cleaner/urgent-stock/asks/a1", body: { decision: "accept", note: null } });
});

it("laundry cards show a planned time only when one was planned, never a guessed one", () => {
  const card = { id: "t", status: "CONFIRMED", pickupDate: "2026-11-11T00:00:00.000Z", dropoffDate: "2026-11-13T00:00:00.000Z", lane: "pickup", exceptions: [], carriedIn: false, readiness: true, confirmations: [], driver: { driverName: "Tom", stop: 3 }, updatedAt: "" } as unknown as PipelineCardDTO;
  expect(cardFacts(card)).toContain("Driver Tom, stop 3");
  expect(cardFacts({ ...card, pickupTime: "14:30" })).toContain("Driver Tom 14:30");
  expect(cardFacts({ ...card, lane: "drop", dropoffTime: "09:15" } as PipelineCardDTO)).toContain("Drop 09:15");
  expect(dayWithTime("2026-11-11T00:00:00.000Z", null)).toBe("Wed 11 Nov");
  expect(dayWithTime("2026-11-11T00:00:00.000Z", "15:00")).toBe("Wed 11 Nov 15:00");
});
