/**
 * The website editor's draft model (2026-11-16, board "Website and blog").
 *
 * Pure and plain (safe for server pages and client components): which fields
 * of the draft differ from the published content, which editor section owns
 * each one, how to name them for people, and which images still need alt text
 * before anything can be published. The server repeats the alt-text check
 * (app/api/admin/settings PATCH); the browser check is only for showing it early.
 */
import type { WebsiteContent } from "@/lib/public-site/content";

export type WebsiteSectionKey =
  | "home"
  | "pages"
  | "service-pages"
  | "trust"
  | "media"
  | "contact"
  | "legal"
  | "layout"
  | "json";

export type WebsiteSectionMeta = {
  key: WebsiteSectionKey;
  label: string;
  summary: string;
};

/** Left-pane order as drawn. "json" is the Advanced item under a rule. */
export const WEBSITE_SECTIONS: WebsiteSectionMeta[] = [
  { key: "home", label: "Home", summary: "Hero, figures, benefit cards, hosting strip, testimonials, final call to action" },
  { key: "pages", label: "Landing pages", summary: "Services, Airbnb and Subscriptions page wording" },
  { key: "service-pages", label: "Service pages", summary: "Each service's detail page and search wording" },
  { key: "trust", label: "Why us and FAQ", summary: "Reasons to choose sNeek and the public questions" },
  { key: "media", label: "Gallery, partners, social", summary: "Work gallery, partner logos and social links" },
  { key: "contact", label: "Contact and footer", summary: "Public contact details, who receives quote requests, footer" },
  { key: "legal", label: "Terms and privacy", summary: "Legal page introductions and sections" },
  { key: "layout", label: "Layout and visibility", summary: "Page switches, maintenance mode, width, announcement bar" },
  { key: "json", label: "Advanced: raw data", summary: "The whole website content as data, for experts" },
];

export function isWebsiteSectionKey(value: unknown): value is WebsiteSectionKey {
  return typeof value === "string" && WEBSITE_SECTIONS.some((section) => section.key === value);
}

/** Which section owns each top-level content key. */
const SECTION_FOR_ROOT: Record<keyof WebsiteContent, WebsiteSectionKey> = {
  home: "home",
  services: "pages",
  airbnb: "pages",
  subscriptions: "pages",
  servicePages: "service-pages",
  whyChooseUs: "trust",
  faq: "trust",
  gallery: "media",
  partners: "media",
  socialLinks: "media",
  contact: "contact",
  footer: "contact",
  terms: "legal",
  privacy: "legal",
  announcementBar: "layout",
  pageVisibility: "layout",
  maintenanceMode: "layout",
  containerWidth: "layout",
};

export function sectionForPath(path: string): WebsiteSectionKey {
  const root = path.split(/[.[]/)[0] as keyof WebsiteContent;
  return SECTION_FOR_ROOT[root] ?? "json";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Leaf paths whose value differs between `published` and `draft`
 * (e.g. "home.title", "home.stats[1].value", "announcementBar.enabled").
 * A list that grew or shrank reports each added or removed item.
 */
export function diffWebsiteContent(published: unknown, draft: unknown, prefix = ""): string[] {
  if (Object.is(published, draft)) return [];
  if (Array.isArray(published) && Array.isArray(draft)) {
    const length = Math.max(published.length, draft.length);
    const paths: string[] = [];
    for (let index = 0; index < length; index += 1) {
      paths.push(...diffWebsiteContent(published[index], draft[index], `${prefix}[${index}]`));
    }
    return paths;
  }
  if (isPlainObject(published) && isPlainObject(draft)) {
    const keys = Array.from(new Set([...Object.keys(published), ...Object.keys(draft)]));
    return keys.flatMap((key) => diffWebsiteContent(published[key], draft[key], prefix ? `${prefix}.${key}` : key));
  }
  if (isPlainObject(published) || isPlainObject(draft) || Array.isArray(published) || Array.isArray(draft)) {
    return [prefix || "(all)"];
  }
  // Treat a missing optional value and an empty one as the same published state.
  const empty = (value: unknown) => value === undefined || value === null || value === "";
  if (empty(published) && empty(draft)) return [];
  return [prefix || "(all)"];
}

export type SectionChangeCounts = Partial<Record<WebsiteSectionKey, number>>;

export function changeCountsBySection(paths: string[]): SectionChangeCounts {
  const counts: SectionChangeCounts = {};
  for (const path of paths) {
    const key = sectionForPath(path);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** True when `path` is `prefix` itself or inside it ("home.stats" covers "home.stats[0].value"). */
export function pathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

/** Collections named as people say them. */
const COLLECTION_LABEL: Record<string, string> = {
  "home.stats": "figures",
  "home.serviceBenefits": "benefit cards",
  "home.hostingFeatures": "hosting strip",
  "home.testimonials": "testimonials",
  "airbnb.features": "Airbnb feature cards",
  "whyChooseUs.items": "reasons to choose us",
  "faq.items": "FAQ questions",
  "gallery.items": "gallery",
  "partners.items": "partners",
  "terms.sections": "terms sections",
  "privacy.sections": "privacy sections",
  "contact.recipientEmails": "quote request recipients",
  announcementBar: "announcement bar",
  pageVisibility: "page switches",
  maintenanceMode: "maintenance mode",
  socialLinks: "social links",
};

const FIELD_LABEL: Record<string, string> = {
  "home.eyebrow": "hero eyebrow",
  "home.title": "hero headline",
  "home.subtitle": "hero subtitle",
  "home.brandIdea": "positioning line",
  "home.primaryCtaLabel": "main button",
  "home.secondaryCtaLabel": "second button",
  "home.heroImageUrl": "hero image",
  "home.heroImageAlt": "hero image alt text",
  "home.servicesTitle": "benefit cards title",
  "home.servicesIntro": "benefit cards introduction",
  "home.hostingTitle": "hosting strip title",
  "home.hostingIntro": "hosting strip introduction",
  "home.finalCtaTitle": "final call to action title",
  "home.finalCtaBody": "final call to action wording",
  containerWidth: "page width",
};

function humanise(key: string): string {
  return key
    .replace(/\[\d+\]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .toLowerCase()
    .trim();
}

/** "home.title" → "hero headline"; "home.stats[1].value" → "figures". */
export function fieldLabel(path: string): string {
  if (FIELD_LABEL[path]) return FIELD_LABEL[path];
  const collection = Object.keys(COLLECTION_LABEL)
    .sort((left, right) => right.length - left.length)
    .find((prefix) => pathWithin(path, prefix));
  if (collection) return COLLECTION_LABEL[collection];
  if (path.startsWith("servicePages.")) {
    const service = path.split(".")[1] ?? "";
    return `${humanise(service)} page`;
  }
  return humanise(path);
}

/** Distinct, ordered field labels for the changed paths ("hero headline, hero image"). */
export function changedFieldLabels(paths: string[]): string[] {
  const labels: string[] = [];
  for (const path of paths) {
    const label = fieldLabel(path);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** Bar summary: "Home › hero headline, hero image · Layout and visibility › announcement bar". */
export function describeChanges(paths: string[]): string {
  const bySection = new Map<WebsiteSectionKey, string[]>();
  for (const path of paths) {
    const key = sectionForPath(path);
    const list = bySection.get(key) ?? [];
    list.push(path);
    bySection.set(key, list);
  }
  return WEBSITE_SECTIONS.filter((section) => bySection.has(section.key))
    .map((section) => `${section.label} › ${changedFieldLabels(bySection.get(section.key) ?? []).join(", ")}`)
    .join(" · ");
}

/** Read a value by path ("home.stats[1].value") for "was …" labels. */
export function valueAtPath(content: unknown, path: string): unknown {
  const parts = path.match(/[^.[\]]+/g) ?? [];
  let current: unknown = content;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export type AltTextIssue = {
  /** Path of the image URL that lacks alt text. */
  path: string;
  section: WebsiteSectionKey;
  label: string;
};

function needsAlt(url: unknown, alt: unknown): boolean {
  return typeof url === "string" && url.trim() !== "" && !(typeof alt === "string" && alt.trim() !== "");
}

/**
 * Every image on the public website that has a picture but no alt text.
 * Owner default 2026-11-16 (pending owner confirmation): alt text is required
 * before publishing. Partner logos use the partner's name.
 */
export function missingImageAltText(content: WebsiteContent): AltTextIssue[] {
  const issues: AltTextIssue[] = [];
  const add = (path: string, label: string) => issues.push({ path, section: sectionForPath(path), label });
  if (needsAlt(content.home?.heroImageUrl, content.home?.heroImageAlt)) add("home.heroImageUrl", "Home hero image");
  (content.home?.serviceBenefits ?? []).forEach((card, index) => {
    if (needsAlt(card.imageUrl, card.imageAlt)) add(`home.serviceBenefits[${index}].imageUrl`, `Benefit card ${index + 1} image`);
  });
  (content.home?.hostingFeatures ?? []).forEach((card, index) => {
    if (needsAlt(card.imageUrl, card.imageAlt)) add(`home.hostingFeatures[${index}].imageUrl`, `Hosting strip card ${index + 1} image`);
  });
  if (needsAlt(content.airbnb?.heroImageUrl, content.airbnb?.heroImageAlt)) add("airbnb.heroImageUrl", "Airbnb page hero image");
  (content.airbnb?.features ?? []).forEach((card, index) => {
    if (needsAlt(card.imageUrl, card.imageAlt)) add(`airbnb.features[${index}].imageUrl`, `Airbnb feature card ${index + 1} image`);
  });
  (content.gallery?.items ?? []).forEach((item, index) => {
    if (needsAlt(item.imageUrl, item.imageAlt)) add(`gallery.items[${index}].imageUrl`, `Gallery image ${index + 1}`);
    if (needsAlt(item.beforeImageUrl, item.imageAlt)) add(`gallery.items[${index}].beforeImageUrl`, `Gallery image ${index + 1} (before)`);
    if (needsAlt(item.afterImageUrl, item.imageAlt)) add(`gallery.items[${index}].afterImageUrl`, `Gallery image ${index + 1} (after)`);
  });
  for (const [slug, page] of Object.entries(content.servicePages ?? {})) {
    if (needsAlt(page?.heroImageUrl, page?.heroImageAlt)) add(`servicePages.${slug}.heroImageUrl`, `${humanise(slug)} page hero image`);
  }
  return issues;
}

/** The refusal sentence the server and the editor both show. */
export function altTextRefusal(issues: AltTextIssue[]): string {
  const names = issues.slice(0, 4).map((issue) => issue.label).join(", ");
  const more = issues.length > 4 ? ` and ${issues.length - 4} more` : "";
  return `Add alt text before publishing: ${names}${more}. Nothing was published.`;
}

export type PreviewBlock =
  | "announcement"
  | "hero"
  | "stats"
  | "benefits"
  | "hosting"
  | "why"
  | "testimonials"
  | "gallery"
  | "faq"
  | "final"
  | "footer";

const PREVIEW_BLOCK_PREFIXES: Array<[string, PreviewBlock]> = [
  ["announcementBar", "announcement"],
  ["home.stats", "stats"],
  ["home.servicesTitle", "benefits"],
  ["home.servicesIntro", "benefits"],
  ["home.serviceBenefits", "benefits"],
  ["home.hostingTitle", "hosting"],
  ["home.hostingIntro", "hosting"],
  ["home.hostingFeatures", "hosting"],
  ["home.testimonials", "testimonials"],
  ["home.finalCtaTitle", "final"],
  ["home.finalCtaBody", "final"],
  ["home", "hero"],
  ["whyChooseUs", "why"],
  ["gallery", "gallery"],
  ["faq", "faq"],
  ["footer", "footer"],
  ["contact", "footer"],
];

/** Which block of the home preview shows a changed field (null: not on the home preview). */
export function previewBlockForPath(path: string): PreviewBlock | null {
  const match = PREVIEW_BLOCK_PREFIXES.find(([prefix]) => pathWithin(path, prefix));
  return match ? match[1] : null;
}

export function previewBlocksFor(paths: string[]): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  for (const path of paths) {
    const block = previewBlockForPath(path);
    if (block && !blocks.includes(block)) blocks.push(block);
  }
  return blocks;
}
