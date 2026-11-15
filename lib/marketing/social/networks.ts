/**
 * Social networks for the post generator (2026-11-17). Plain module: the
 * screens, the server and the tests read the same table.
 *
 * What works today (docs/SYSTEM.md "Social post generator"):
 * - Facebook Page and Instagram: official Meta Graph API through the owner's
 *   own Meta app in development mode (one reviewed click, or a planned time).
 * - TikTok: download-and-copy fallback only. Direct posts from an app TikTok
 *   has not audited stay private, and inbox upload needs a domain verified
 *   with TikTok; neither can be done or tested from here.
 * - Google Business Profile and LinkedIn: need the network's approval of API
 *   access first, so they start on the fallback. No API calls are built.
 */

export type SocialNetwork = "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "GOOGLE_BUSINESS" | "LINKEDIN";

export const SOCIAL_NETWORK_KEYS: readonly SocialNetwork[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"];

/** "api": sNeek can post through the official API once connected. */
export type NetworkApiState = "api" | "needs_approval" | "fallback_only";

export type SocialRatio = "4:5" | "1:1" | "1.91:1";

export const SOCIAL_RATIOS: readonly SocialRatio[] = ["4:5", "1:1", "1.91:1"];

export function ratioValue(ratio: SocialRatio): number {
  if (ratio === "4:5") return 4 / 5;
  if (ratio === "1:1") return 1;
  return 1.91;
}

export type NetworkDefinition = {
  key: SocialNetwork;
  label: string;
  /** Two letters drawn as the network mark (letters, not logos). */
  mark: string;
  apiState: NetworkApiState;
  /** Whole caption including any hashtag block. */
  captionLimit: number;
  /** Where the limit comes from, said on screen. */
  captionLimitSource: string;
  hashtagLimit: number;
  /** Hashtags this network's caption gets by default (Google Business none). */
  usesHashtags: boolean;
  /** The most images sNeek sends in one post. */
  maxImages: number;
  altTextLimit: number | null;
  /** Shapes the network accepts without cropping again. */
  ratios: readonly SocialRatio[];
  /** Opened in a new tab by the fallback. */
  openUrl: string;
  /** Why it is not one-click yet, in words. */
  whyNot: string | null;
};

export const SOCIAL_NETWORKS: readonly NetworkDefinition[] = [
  {
    key: "INSTAGRAM",
    label: "Instagram",
    mark: "IG",
    apiState: "api",
    captionLimit: 2200,
    captionLimitSource: "Instagram: 2,200 characters",
    hashtagLimit: 30,
    usesHashtags: true,
    maxImages: 6,
    altTextLimit: 1000,
    ratios: ["4:5", "1:1", "1.91:1"],
    openUrl: "https://www.instagram.com/",
    whyNot: null,
  },
  {
    key: "FACEBOOK",
    label: "Facebook Page",
    mark: "FB",
    apiState: "api",
    captionLimit: 5000,
    captionLimitSource: "sNeek's limit for a Page post: 5,000 characters",
    hashtagLimit: 5,
    usesHashtags: false,
    maxImages: 6,
    altTextLimit: 1000,
    ratios: ["4:5", "1:1", "1.91:1"],
    openUrl: "https://www.facebook.com/",
    whyNot: null,
  },
  {
    key: "TIKTOK",
    label: "TikTok",
    mark: "TT",
    apiState: "fallback_only",
    captionLimit: 4000,
    captionLimitSource: "TikTok photo description: 4,000 characters (title 90)",
    hashtagLimit: 5,
    usesHashtags: true,
    maxImages: 6,
    altTextLimit: null,
    ratios: ["4:5", "1:1"],
    openUrl: "https://www.tiktok.com/upload",
    whyNot: "TikTok keeps posts from apps it has not audited private, and sending to your TikTok inbox needs a domain verified with TikTok. Until then: download and copy.",
  },
  {
    key: "GOOGLE_BUSINESS",
    label: "Google Business Profile",
    mark: "GB",
    apiState: "needs_approval",
    captionLimit: 1500,
    captionLimitSource: "sNeek's limit for a Google update: 1,500 characters",
    hashtagLimit: 0,
    usesHashtags: false,
    maxImages: 1,
    altTextLimit: null,
    ratios: ["1:1", "4:5"],
    openUrl: "https://business.google.com/",
    whyNot: "Google has not approved API access. Google gives it only after you apply; until then the API answers with a quota of zero.",
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn page",
    mark: "in",
    apiState: "needs_approval",
    captionLimit: 3000,
    captionLimitSource: "LinkedIn post text: 3,000 characters",
    hashtagLimit: 3,
    usesHashtags: true,
    maxImages: 6,
    altTextLimit: null,
    ratios: ["1:1", "4:5", "1.91:1"],
    openUrl: "https://www.linkedin.com/",
    whyNot: "Posting as a company page needs LinkedIn's Community Management API, which LinkedIn vets first.",
  },
];

export function networkDefinition(key: SocialNetwork): NetworkDefinition {
  const found = SOCIAL_NETWORKS.find((network) => network.key === key);
  if (!found) throw new Error(`Unknown social network ${key}`);
  return found;
}

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === "string" && (SOCIAL_NETWORK_KEYS as readonly string[]).includes(value);
}

/** Networks sNeek can publish to through an official API (once connected). */
export const API_NETWORKS: readonly SocialNetwork[] = SOCIAL_NETWORKS.filter((network) => network.apiState === "api").map((network) => network.key);

export type SocialFormat = "SINGLE" | "CAROUSEL" | "BEFORE_AFTER" | "FRAME";

export const SOCIAL_FORMATS: ReadonlyArray<{ key: SocialFormat; label: string; minPhotos: number; maxPhotos: number }> = [
  { key: "SINGLE", label: "Single image", minPhotos: 1, maxPhotos: 1 },
  { key: "CAROUSEL", label: "Carousel", minPhotos: 2, maxPhotos: 6 },
  { key: "BEFORE_AFTER", label: "Before and after", minPhotos: 2, maxPhotos: 2 },
  { key: "FRAME", label: "Branded frame", minPhotos: 1, maxPhotos: 1 },
];

export function isSocialFormat(value: unknown): value is SocialFormat {
  return typeof value === "string" && SOCIAL_FORMATS.some((format) => format.key === value);
}

export type SplitLayout = "SIDE" | "STACK" | "SLIDES";

/** How a network row's stored state reads. Never "Posted" without the network's confirmation. */
export type NetworkResultTone = "good" | "attention" | "problem" | "neutral";

export type NetworkResultView = { label: string; tone: NetworkResultTone };

export function networkResultView(post: { status: string; externalId: string | null; deliveryMode: string | null; scheduledFor: string | Date | null }): NetworkResultView {
  if (post.status === "PUBLISHED") {
    if (post.deliveryMode === "API" && post.externalId) return { label: "Posted", tone: "good" };
    return { label: "Posted by you", tone: "good" };
  }
  if (post.status === "SENT_TO_INBOX") return { label: "Waiting for you", tone: "attention" };
  if (post.status === "SENDING") return { label: "Sending…", tone: "neutral" };
  if (post.status === "UNCONFIRMED") return { label: "Not confirmed", tone: "attention" };
  if (post.status === "FAILED") return { label: "Failed", tone: "problem" };
  if (post.status === "CANCELLED") return { label: "Cancelled", tone: "neutral" };
  if (post.status === "SCHEDULED") {
    return post.deliveryMode === "API" ? { label: "Planned", tone: "attention" } : { label: "Waiting for your link", tone: "attention" };
  }
  if (post.deliveryMode === "MANUAL") return { label: "Not sent", tone: "neutral" };
  return { label: "Draft", tone: "neutral" };
}
