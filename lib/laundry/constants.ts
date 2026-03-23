export const LAUNDRY_SKIP_REASONS = [
  { value: "NO_LINEN_USED", label: "No linen used" },
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "BUFFER_SET_USED", label: "Buffer set used" },
  { value: "GUEST_STILL_USING_ITEMS", label: "Guest still using items" },
  { value: "ADMIN_INSTRUCTION", label: "Admin instruction" },
  { value: "OTHER", label: "Other" },
] as const;

export type LaundrySkipReasonCode = (typeof LAUNDRY_SKIP_REASONS)[number]["value"];
