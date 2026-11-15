/**
 * Caption templates for the social post generator (2026-11-17): the free
 * caption source (no AI). Plain module. Hooks rotate so two posts in a row do
 * not open the same way; each network gets its own text within its limits;
 * the suburb appears only when the owner's permission allows it and is never
 * replaced with a street, building or unit.
 */
import { z } from "zod";
import { networkDefinition, type SocialFormat, type SocialNetwork } from "./networks";

export const SOCIAL_TEMPLATES_KEY = "social_templates_v1";

export const captionTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  formats: z.array(z.enum(["SINGLE", "CAROUSEL", "BEFORE_AFTER", "FRAME"])).max(4),
  hooks: z.array(z.string().trim().min(1).max(160)).min(1).max(12),
  body: z.string().trim().min(1).max(1200),
  businessBody: z.string().trim().min(1).max(1200),
  cta: z.string().trim().min(1).max(300),
}).strict();
export type CaptionTemplate = z.infer<typeof captionTemplateSchema>;

export const hashtagSetSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  network: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"]),
  tags: z.array(z.string().regex(new RegExp("^#[\\p{L}\\p{N}_]{2,60}$", "u"))).max(30),
}).strict();
export type HashtagSet = z.infer<typeof hashtagSetSchema>;

export const brandFrameSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  line: z.string().trim().min(1).max(32),
  enabled: z.boolean(),
}).strict();
export type BrandFrame = z.infer<typeof brandFrameSchema>;

export const socialTemplatesSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  templates: z.array(captionTemplateSchema).min(1).max(40),
  hashtagSets: z.array(hashtagSetSchema).max(40),
  frames: z.array(brandFrameSchema).min(1).max(10),
}).strict();
export type SocialTemplates = z.infer<typeof socialTemplatesSchema>;

export const DEFAULT_SOCIAL_TEMPLATES: SocialTemplates = {
  version: 1,
  revision: 0,
  templates: [
    {
      key: "turnover-in-numbers",
      name: "Turnover in numbers",
      formats: ["CAROUSEL", "SINGLE", "FRAME"],
      hooks: [
        "Checkout at 10. Next guests at 3.",
        "Between guests, this is what we do.",
        "Guest-ready, and photographed for the host.",
        "Another turnover, done and checked.",
        "Fresh linen, clear benches, every room checked.",
        "The part of a stay guests never see.",
      ],
      body: "Here's a {home} reset for the next guests: {rooms_list}.\nFresh linen, restocked amenities, every surface wiped and photographed for the host.",
      businessBody: "How we turn a {home} around between guests: {rooms_list}, reset to the listing and photographed for the host.",
      cta: "Short-stay host{suburb_in}? We handle turnovers, linen and restocking. Book a walkthrough: {link}",
    },
    {
      key: "before-and-after",
      name: "Before and after",
      formats: ["BEFORE_AFTER"],
      hooks: ["Same room, a few hours apart.", "Swipe for the after.", "Before and after a big checkout.", "What a reset looks like."],
      body: "The {room} after a big checkout, reset to the listing.",
      businessBody: "A {room} reset after a big checkout, back to the listing standard.",
      cta: "Get a turnover quote: {link}",
    },
    {
      key: "host-tip",
      name: "Host tip",
      formats: ["SINGLE", "FRAME"],
      hooks: ["Hosts ask us what guests notice first.", "One thing guests notice first:", "A small thing that earns five stars:"],
      body: "A {room} set up exactly like the listing photo makes the first minute of a stay count.",
      businessBody: "Guests judge a stay in the first minute. A {room} that matches the listing photo is where that starts.",
      cta: "Follow for weekly host tips, or ask us about turnovers: {link}",
    },
  ],
  hashtagSets: [
    { key: "instagram-hosts", name: "Instagram, hosts", network: "INSTAGRAM", tags: ["#sydneyairbnb", "#airbnbhost", "#shortstay", "#turnoverclean", "#guestready", "#superhost", "#sydneycleaning", "#airbnbcleaning"] },
    { key: "instagram-local", name: "Instagram, local", network: "INSTAGRAM", tags: ["#sydney", "#sydneylocal", "#sydneyhosts", "#sydneyproperty", "#sydneyliving", "#cleanhome"] },
    { key: "tiktok", name: "TikTok", network: "TIKTOK", tags: ["#airbnbhost", "#cleantok", "#guestready", "#sydney"] },
    { key: "linkedin", name: "LinkedIn", network: "LINKEDIN", tags: ["#shortstay", "#propertymanagement", "#hospitality"] },
  ],
  frames: [
    { key: "green-band", name: "Green band", line: "Guest-ready by 3 pm", enabled: true },
  ],
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export type CaptionFacts = {
  /** Only when every photo's permission allows naming it. */
  suburb: string | null;
  bedrooms: number | null;
  rooms: string[];
  /** The public quote page, written out where a network shows links. */
  link: string;
};

function roomsList(rooms: string[]): string {
  const unique = Array.from(new Set(rooms.map((room) => room.toLowerCase()))).filter((room) => room !== "before");
  if (unique.length === 0) return "every room";
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function homeWords(facts: CaptionFacts): string {
  const bedrooms = facts.bedrooms && facts.bedrooms > 0 && facts.bedrooms <= 10 ? `${NUMBER_WORDS[facts.bedrooms]}-bedroom ` : "";
  return `${facts.suburb ? `${facts.suburb} ` : ""}${bedrooms}home`;
}

function fill(text: string, facts: CaptionFacts, network: SocialNetwork): string {
  const link = network === "INSTAGRAM" || network === "TIKTOK" ? "link in bio" : facts.link;
  const firstRoom = facts.rooms.find((room) => room.toLowerCase() !== "before") ?? "room";
  return text
    .replace(/\{home\}/g, homeWords(facts))
    .replace(/\{rooms_list\}/g, roomsList(facts.rooms))
    .replace(/\{room\}/g, firstRoom.toLowerCase())
    .replace(/\{suburb_in\}/g, facts.suburb ? ` in ${facts.suburb}` : "")
    .replace(/\{link\}/g, link)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.,:;!?])/g, "$1")
    .trim();
}

export function templateFor(templates: SocialTemplates, format: SocialFormat, key?: string | null): CaptionTemplate {
  return templates.templates.find((template) => template.key === key)
    ?? templates.templates.find((template) => template.formats.includes(format))
    ?? templates.templates[0];
}

function suburbTag(suburb: string | null): string | null {
  if (!suburb) return null;
  const tag = suburb.toLowerCase().replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), "");
  return tag.length >= 2 ? `#${tag}` : null;
}

export function defaultHashtags(templates: SocialTemplates, network: SocialNetwork, suburb: string | null): string[] {
  const definition = networkDefinition(network);
  if (!definition.usesHashtags) return [];
  const set = templates.hashtagSets.find((item) => item.network === network);
  const tags = [...(set?.tags ?? [])];
  const local = suburbTag(suburb);
  if (local && network === "INSTAGRAM" && !tags.includes(local)) tags.splice(1, 0, local);
  return tags.slice(0, definition.hashtagLimit);
}

export type NetworkCaption = { caption: string; hashtags: string[] };

/** One network's caption from a template and the photos' facts. */
export function renderNetworkCaption(template: CaptionTemplate, hookIndex: number, facts: CaptionFacts, network: SocialNetwork, templates: SocialTemplates): NetworkCaption {
  const hook = fill(template.hooks[((hookIndex % template.hooks.length) + template.hooks.length) % template.hooks.length], facts, network);
  const body = fill(template.body, facts, network);
  const businessBody = fill(template.businessBody, facts, network);
  const cta = fill(template.cta, facts, network);
  const hashtags = defaultHashtags(templates, network, facts.suburb);
  if (network === "LINKEDIN") return { caption: `${businessBody}\n\n${cta}`, hashtags };
  if (network === "TIKTOK") return { caption: `${hook.slice(0, 90)}\n${body}\n${cta}`, hashtags };
  if (network === "GOOGLE_BUSINESS") return { caption: `${hook} ${body.replace(/\n/g, " ")}\n\n${cta}`, hashtags: [] };
  return { caption: `${hook} ${body}\n\n${cta}`, hashtags };
}

/** What is actually sent: the caption plus the hashtag block where the network uses one. */
export function finalCaption(network: SocialNetwork, caption: string, hashtags: readonly string[]): string {
  const definition = networkDefinition(network);
  if (!definition.usesHashtags || hashtags.length === 0) return caption.trim();
  return `${caption.trim()}\n\n${hashtags.join(" ")}`;
}

function grouped(value: number): string {
  return value.toLocaleString("en-AU");
}

/** Limit problems in words; empty means within the network's limits. */
export function captionProblems(network: SocialNetwork, caption: string, hashtags: readonly string[]): string[] {
  const definition = networkDefinition(network);
  const problems: string[] = [];
  const text = finalCaption(network, caption, hashtags);
  if (!caption.trim()) problems.push(`${definition.label}: write a caption.`);
  if (text.length > definition.captionLimit) problems.push(`${definition.label}: ${grouped(text.length)} of ${grouped(definition.captionLimit)} characters.`);
  if (hashtags.length > definition.hashtagLimit) problems.push(`${definition.label}: ${hashtags.length} hashtags, at most ${definition.hashtagLimit}.`);
  if (network === "TIKTOK" && (caption.split("\n")[0] ?? "").length > 90) problems.push("TikTok: the first line is the title, at most 90 characters.");
  const inlineTags = (caption.match(new RegExp("#[\\p{L}\\p{N}_]+", "gu")) ?? []).length;
  if (network === "INSTAGRAM" && inlineTags + hashtags.length > 30) problems.push("Instagram: at most 30 hashtags in a caption.");
  return problems;
}

export function captionLength(network: SocialNetwork, caption: string, hashtags: readonly string[]): number {
  return finalCaption(network, caption, hashtags).length;
}

/** The alt text a person starts from: the form field's description plus the room. */
export function suggestAltText(altHint: string, role: "PHOTO" | "BEFORE" | "AFTER"): string {
  if (role === "BEFORE") return `Before: ${altHint.charAt(0).toLowerCase()}${altHint.slice(1)}.`;
  if (role === "AFTER") return `After: ${altHint.charAt(0).toLowerCase()}${altHint.slice(1)}.`;
  return `${altHint}.`;
}

export const ALT_TEXT_MAX = 1000;
