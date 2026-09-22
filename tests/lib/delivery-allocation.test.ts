import { expect, it } from "vitest";
import { deliveryShare } from "@/lib/inventory/delivery-allocation";
it("preserves every cent and minute across partial deliveries", () => {
  expect([0, 1, 2].map(before => deliveryShare(100, 3, before, 1))).toEqual([33, 33, 34]);
  expect([0, 1, 2].map(before => deliveryShare(5, 3, before, 1))).toEqual([1, 2, 2]);
});
it("caps allocation at the original purchase even if a holding was adjusted upward", () => {
  expect(deliveryShare(100, 3, 2, 8)).toBe(34);
  expect(deliveryShare(100, 3, 10, 1)).toBe(0);
});
it.each([NaN, Infinity, -1])("rejects invalid total %s", total => expect(() => deliveryShare(total, 3, 0, 1)).toThrow());
