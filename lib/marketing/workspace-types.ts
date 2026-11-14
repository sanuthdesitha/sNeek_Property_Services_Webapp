/**
 * Plain data shapes the Marketing workspace page hands to its client
 * components (board "Marketing", 2026-11-16). Types only; safe everywhere.
 */

export type EmailCampaignRow = {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  audience: unknown;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number | null;
  createdAt: string;
  updatedAt: string;
  /** Ledger counts: null when the ledger could not be read. */
  sends: { sent: number; failed: number; skipped: number } | null;
  /**
   * Email service reports (distinct recipients). null = not recorded: the
   * service has not reported anything for this campaign (never shown as 0).
   */
  report: { delivered: number; opened: number; clicked: number; bounced: number } | null;
};

export type SegmentOption = { id: string; label: string; description: string; count: number };

export type DiscountCodeRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  minSubtotal: number | null;
  jobTypes: string[] | null;
  usageLimit: number | null;
  usageCount: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};

export type SocialPostRow = {
  id: string;
  channel: "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
  caption: string;
  status: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  createdAt: string;
};

export type LibraryAssetRow = {
  id: string;
  name: string;
  url: string;
  mediaType: "IMAGE" | "VIDEO" | "GIF";
  createdAt: string;
};

export type MarketingTab = "email" | "offers" | "social" | "templates" | "images";

export const MARKETING_TABS: Array<{ key: MarketingTab; label: string }> = [
  { key: "email", label: "Email campaigns" },
  { key: "offers", label: "Discounts and plans" },
  { key: "social", label: "Social posts" },
  { key: "templates", label: "Templates" },
  { key: "images", label: "Images" },
];

export function isMarketingTab(value: unknown): value is MarketingTab {
  return typeof value === "string" && MARKETING_TABS.some((tab) => tab.key === value);
}

/** Older section names from the previous hub, kept for old links. */
export function marketingTabFromParam(value: string | null | undefined): MarketingTab {
  if (isMarketingTab(value)) return value;
  if (value === "campaigns" || value === "plans") return "offers";
  if (value === "assets") return "images";
  return "email";
}
