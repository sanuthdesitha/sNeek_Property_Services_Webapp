import { z } from "zod";

/**
 * AI routing settings (AppSetting `ai_routing_v1`). Plain module: the settings
 * screen and the server read the same schema. Never put credentials here; keys
 * live encrypted in `ai_provider_credentials_v1` (see ./credentials.ts).
 */

export const AI_FEATURES = ["photo_compare", "photo_assign", "text_compose", "wording", "assistant", "explain_flag", "draft_reply", "agent_summaries"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_PROVIDER_KINDS = ["anthropic", "openai", "openai_compatible", "ollama"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Every provider except a private Ollama server is outside this server. */
export function isCloudProvider(provider: AiProviderKind): boolean {
  return provider !== "ollama";
}

export type AiFeatureDefinition = {
  label: string;
  description: string;
  /** Sends photos to the model. Cloud image sending is off until an admin allows it. */
  usesImages: boolean;
  /** False for features reserved for later work; their routing can be set ahead. */
  built: boolean;
};

export const AI_FEATURE_CATALOG: Readonly<Record<AiFeature, AiFeatureDefinition>> = {
  photo_compare: { label: "Photo comparison", description: "Compares submitted cleaning photos with the form's reference photos. Findings are suggestions a reviewer approves or dismisses.", usesImages: true, built: true },
  photo_assign: { label: "Photo assignment", description: "Suggests which checklist field each bulk-uploaded photo belongs to. The cleaner reviews every suggestion.", usesImages: true, built: true },
  text_compose: { label: "Social post drafts", description: "Drafts social captions. Nothing is published; a person applies and edits the draft.", usesImages: false, built: true },
  wording: { label: "Notification wording", description: "Proposes new notification wording beside the current text. Nothing is saved until a person saves it.", usesImages: false, built: true },
  assistant: { label: "Ask (assistant)", description: "Answers questions about operations on Command, only from data the person asking can read, with links to the records. Read-only.", usesImages: false, built: true },
  explain_flag: { label: "Explain this flag", description: "Explains a photo finding or photo check in plain words, from the stored finding only.", usesImages: false, built: true },
  draft_reply: { label: "Drafts (client replies, quote notes)", description: "Drafts a client reply or quote notes into the editor; a person edits and sends or saves. Never sends.", usesImages: false, built: true },
  agent_summaries: { label: "Agent summaries", description: "Reserved for summaries prepared for connected agents (not built yet).", usesImages: false, built: false },
};

export const AI_PROVIDER_LABELS: Readonly<Record<AiProviderKind, string>> = {
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
  openai_compatible: "OpenAI-compatible endpoint",
  ollama: "Local Ollama",
};

export const aiModelName = z.string().trim().min(1).max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/, "Enter a model name, not a sentence")
  .refine((value) => !value.includes("://"), "Enter a model name, not a URL");

export const aiRouteSchema = z.object({
  provider: z.enum(AI_PROVIDER_KINDS),
  model: aiModelName,
}).strict();
export type AiRoute = z.infer<typeof aiRouteSchema>;

export const aiFeatureSettingsSchema = z.object({
  enabled: z.boolean(),
  /** null: photo features use the photo provider in AI workflow settings; text features use the default. */
  route: aiRouteSchema.nullable(),
  /** Cloud providers may receive photos for this feature only when true. */
  allowCloudImages: z.boolean(),
  hourlyLimitPerActor: z.number().int().min(1).max(10_000),
  /** Cloud request deadline. Local Ollama keeps its own configured deadline. */
  timeoutSeconds: z.number().int().min(10).max(300),
}).strict();
export type AiFeatureSettings = z.infer<typeof aiFeatureSettingsSchema>;

/** https only, no credentials, query or fragment. The server additionally runs the DNS/SSRF check. */
export function isAcceptableCompatibleBaseUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const aiCompatibleEndpointSchema = z.object({
  baseUrl: z.string().trim().max(2048).refine((value) => value === "" || isAcceptableCompatibleBaseUrl(value), "Use an https address without a user name, query or fragment."),
  label: z.string().trim().max(60),
}).strict();

/** Prices the owner enters per model (USD per million tokens). Unknown prices stay "Not known", never $0. */
export const aiModelPriceSchema = z.object({
  provider: z.enum(AI_PROVIDER_KINDS),
  model: aiModelName,
  inputUsdPerMillion: z.number().finite().min(0).max(1000),
  outputUsdPerMillion: z.number().finite().min(0).max(1000),
}).strict();
export type AiModelPrice = z.infer<typeof aiModelPriceSchema>;

// Features added after a routing row was saved fall back to their defaults (an older row stays readable).
const LATER_FEATURE_DEFAULTS: Partial<Record<AiFeature, number>> = { explain_flag: 60, draft_reply: 30 };
const featureShape = Object.fromEntries(AI_FEATURES.map((feature) => [
  feature,
  LATER_FEATURE_DEFAULTS[feature] !== undefined ? aiFeatureSettingsSchema.default({ enabled: true, route: null, allowCloudImages: false, hourlyLimitPerActor: LATER_FEATURE_DEFAULTS[feature]!, timeoutSeconds: 30 }) : aiFeatureSettingsSchema,
])) as Record<AiFeature, typeof aiFeatureSettingsSchema>;

export const aiRoutingSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  /** null: text features keep the server environment selection (AI_TEXT_PROVIDER / Ollama "use for text"). */
  defaultRoute: aiRouteSchema.nullable(),
  features: z.object(featureShape).strict(),
  compatible: aiCompatibleEndpointSchema,
  prices: z.array(aiModelPriceSchema).max(50),
}).strict();
export type AiRoutingSettings = z.infer<typeof aiRoutingSchema>;

function featureDefaults(hourlyLimitPerActor: number): AiFeatureSettings {
  return { enabled: true, route: null, allowCloudImages: false, hourlyLimitPerActor, timeoutSeconds: 30 };
}

/** Defaults pending owner confirmation: cloud image sending off for every feature. */
export const DEFAULT_AI_ROUTING: AiRoutingSettings = {
  version: 1,
  revision: 0,
  defaultRoute: null,
  features: {
    photo_compare: featureDefaults(600),
    photo_assign: featureDefaults(120),
    text_compose: featureDefaults(30),
    wording: featureDefaults(30),
    assistant: featureDefaults(60),
    explain_flag: featureDefaults(60),
    draft_reply: featureDefaults(30),
    agent_summaries: featureDefaults(60),
  },
  compatible: { baseUrl: "", label: "" },
  prices: [],
};

/** What the settings screen sends: the routing without the server-owned revision. */
export const aiRoutingSaveSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  settings: aiRoutingSchema.omit({ revision: true }),
}).strict();
