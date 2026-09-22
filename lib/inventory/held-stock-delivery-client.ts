"use client";
type DeliveryInput = { propertyId: string; quantity: number; requestId: string };
const storageKey = (scope: string, endpoint: string) => `held-stock-delivery:${scope}:${endpoint}`;
export function pendingHeldStockDelivery(scope: string, endpoint: string): DeliveryInput | null {
  const raw = sessionStorage.getItem(storageKey(scope, endpoint));
  if (!raw) return null;
  const input = JSON.parse(raw);
  if (typeof input.propertyId !== "string" || typeof input.requestId !== "string" || !Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("Pending delivery could not be restored. Contact the office before retrying.");
  return input;
}
export async function sendHeldStockDelivery(scope: string, endpoint: string, values: Omit<DeliveryInput, "requestId">) {
  const pending = pendingHeldStockDelivery(scope, endpoint);
  if (pending && (pending.propertyId !== values.propertyId || pending.quantity !== values.quantity)) throw new Error("A previous delivery is awaiting confirmation. Reopen Deliver to restore those details and retry first.");
  const input = pending ?? { ...values, requestId: crypto.randomUUID() };
  sessionStorage.setItem(storageKey(scope, endpoint), JSON.stringify(input));
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok || body.ok !== true || typeof body.deliveryId !== "string") {
    if ([400, 401, 403, 404, 409].includes(response.status)) sessionStorage.removeItem(storageKey(scope, endpoint));
    throw new Error(body.error || "Delivery confirmation was lost. Reopen Deliver to retry the same request.");
  }
  sessionStorage.removeItem(storageKey(scope, endpoint));
  return body;
}
