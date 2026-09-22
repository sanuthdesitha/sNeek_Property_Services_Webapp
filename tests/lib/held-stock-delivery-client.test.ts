import { beforeEach, expect, it, vi } from "vitest";
import { pendingHeldStockDelivery, sendHeldStockDelivery } from "@/lib/inventory/held-stock-delivery-client";
const transport = vi.fn(); const endpoint = "/api/cleaner/inventory/held-stock/held/deliver"; const values = { propertyId: "property", quantity: 2 };
const ack = () => new Response(JSON.stringify({ ok: true, deliveryId: "delivery" }), { status: 200 });
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); vi.stubGlobal("fetch", transport); transport.mockResolvedValue(ack()); });
it("persists before sending and retries the identical identity after a lost acknowledgement", async () => {
  transport.mockRejectedValueOnce(new TypeError("Network lost")); await expect(sendHeldStockDelivery("cleaner", endpoint, values)).rejects.toThrow();
  const pending = pendingHeldStockDelivery("cleaner", endpoint); expect(pending).toMatchObject(values);
  await sendHeldStockDelivery("cleaner", endpoint, values);
  expect(transport.mock.calls[1][1].body).toBe(transport.mock.calls[0][1].body); expect(pendingHeldStockDelivery("cleaner", endpoint)).toBeNull();
});
it("blocks changed quantity or destination until the pending delivery is resolved", async () => {
  transport.mockRejectedValueOnce(new Error("lost")); await expect(sendHeldStockDelivery("cleaner", endpoint, values)).rejects.toThrow();
  await expect(sendHeldStockDelivery("cleaner", endpoint, { ...values, quantity: 3 })).rejects.toThrow("awaiting confirmation");
  await expect(sendHeldStockDelivery("cleaner", endpoint, { ...values, propertyId: "other" })).rejects.toThrow("awaiting confirmation"); expect(transport).toHaveBeenCalledTimes(1);
});
it("isolates actors and separate held stock endpoints", async () => {
  transport.mockRejectedValue(new Error("lost"));
  for (const [scope, url] of [["a", endpoint], ["b", endpoint], ["a", `${endpoint}-other`]]) await expect(sendHeldStockDelivery(scope, url, values)).rejects.toThrow();
  const ids = transport.mock.calls.map(call => JSON.parse(call[1].body).requestId); expect(new Set(ids).size).toBe(3);
  expect(pendingHeldStockDelivery("c", endpoint)).toBeNull();
});
it("retains pending identity on malformed acknowledgement or server failure", async () => {
  transport.mockResolvedValueOnce(new Response("not-json", { status: 200 })); await expect(sendHeldStockDelivery("a", endpoint, values)).rejects.toThrow();
  const initial = pendingHeldStockDelivery("a", endpoint);
  transport.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 })); await expect(sendHeldStockDelivery("a", endpoint, values)).rejects.toThrow("Unavailable"); expect(pendingHeldStockDelivery("a", endpoint)).toEqual(initial);
});
