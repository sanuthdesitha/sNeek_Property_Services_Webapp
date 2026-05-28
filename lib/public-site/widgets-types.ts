// Client-safe type + defaults for public site widget flags.
// Kept separate from `widgets.ts` (which imports server-only deps via lib/settings).

export interface PublicWidgetFlags {
  instantQuoteEstimator: boolean;
  availabilityChecker: boolean;
  liveChat: boolean;
  newsletterSignup: boolean;
  testimonialCarousel: boolean;
  serviceCalculator: boolean;
}

export const DEFAULT_PUBLIC_WIDGETS: PublicWidgetFlags = {
  instantQuoteEstimator: true,
  availabilityChecker: true,
  liveChat: true,
  newsletterSignup: true,
  testimonialCarousel: true,
  serviceCalculator: true,
};
