import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
vi.mock("@/components/inventory/stay-preparation-panel", () => ({ StayPreparationPanel: () => null }));
const snapshot = { properties: [{ id: "p", name: "Fixture property" }], items: [{ itemId: "paper", item: { name: "Paper", unit: "roll" } }], reports: [], settings: null };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("reports unknown count and purchase quantity as null and retains input and request identity through a retry", async () => {
 const writes: any[] = []; let fail = true;
 vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
  if (options?.method === "POST") { writes.push(JSON.parse(options.body)); return new Response(JSON.stringify(fail ? { error: "Temporary failure" } : {}), { status: fail ? 503 : 200 }); }
  return new Response(JSON.stringify(snapshot));
 }));
 render(<UrgentStockWorkspace isAdmin={false} initialPropertyId="p" />);
 fireEvent.change(await screen.findByLabelText("Item"), { target: { value: "paper" } });
 fireEvent.change(screen.getByLabelText("What is needed and why?"), { target: { value: "Paper is needed; quantity unknown" } });
 fireEvent.click(screen.getByRole("button", { name: "Save report" }));
 await screen.findByText("Temporary failure");
 expect(screen.getByLabelText("What is needed and why?")).toHaveValue("Paper is needed; quantity unknown");
 expect(writes[0]).toMatchObject({ propertyId: "p", itemId: "paper", observedCount: null, observedAt: null, purchaseQuantity: null });
 fail = false; fireEvent.click(screen.getByRole("button", { name: "Save report" }));
 await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].requestId).toBe(writes[0].requestId);
 await waitFor(() => expect(screen.getByLabelText("What is needed and why?")).toHaveValue(""));
 expect(screen.queryByText("Administrator reminders")).toBeNull();
});
it("does not offer administrator resolution or imply an acknowledged need is closed", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...snapshot, reports: [{ id: "r", propertyId: "p", itemId: "paper", itemName: "Paper", stage: "ACKNOWLEDGED", observationDisposition: "UNKNOWN", observedCount: null, purchaseQuantity: null, version: 2 }] }))));
 render(<UrgentStockWorkspace isAdmin={false} initialPropertyId="p" />);
 expect(await screen.findByText("Paper — Acknowledged")).toBeVisible();
 expect(screen.getByRole("button", { name: "Record action" })).toBeVisible();
 expect(screen.queryByRole("option", { name: "Resolve with administrator explanation" })).toBeNull();
});
