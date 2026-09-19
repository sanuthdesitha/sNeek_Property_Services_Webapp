import { expect, it } from "vitest";
import { parseLaundryBagCountInput } from "@/lib/laundry/bag-count";
import { cleanerLaundryStatusSchema } from "@/lib/validations/job";
it("keeps unspecified historical and prospective counts unknown", () => {
  expect(parseLaundryBagCountInput(" ")).toBeUndefined();
  expect(cleanerLaundryStatusSchema.safeParse({ laundryOutcome: "READY_FOR_PICKUP", bagLocation: "Shelf", laundryPhotoKey: "photo.jpg" }).success).toBe(true);
});
it.each(["0", "51", "1.5", "abc"])("rejects explicit invalid count %s", input => {
  expect(() => parseLaundryBagCountInput(input)).toThrow("whole number");
  expect(cleanerLaundryStatusSchema.safeParse({ laundryOutcome: "READY_FOR_PICKUP", laundryBagCount: Number(input) }).success).toBe(false);
});
it.each([1, 50])("accepts explicit count %s", count => {
  expect(parseLaundryBagCountInput(String(count))).toBe(count);
});
