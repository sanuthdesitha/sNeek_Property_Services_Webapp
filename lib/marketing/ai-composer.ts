/**
 * AI post composer — generates social media captions via the Claude API.
 *
 * Requires ANTHROPIC_API_KEY in env. Provider output is validated before use.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAiConfiguration } from "@/lib/ai/config";

export type SocialPlatform = "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";

export interface ComposeRequest {
  platform: SocialPlatform;
  topic: string;
  tone?: "friendly" | "professional" | "playful" | "urgent";
  callToAction?: string;
  brandVoice?: string;
}

export interface ComposedPost {
  caption: string;
  hashtags: string[];
  suggestedHook: string;
}

const composedPostSchema = z.object({
  caption: z.string().trim().min(1).max(10000),
  hashtags: z.array(z.string().trim().min(2).max(100).regex(new RegExp("^#[\\p{L}\\p{N}_]+$", "u"))).max(30),
  suggestedHook: z.string().trim().max(1000),
}).strict();

const PLATFORM_GUIDANCE: Record<SocialPlatform, string> = {
  FACEBOOK:
    "Conversational, can include longer narrative (max 500 chars works best). Include 1-2 emojis. Avoid pure marketing copy.",
  INSTAGRAM:
    "Visual-first. Caption can be longer (~2000 chars). Use 5-15 hashtags at the end. Include 2-3 emojis. Hook in the first line — Instagram cuts captions after ~120 chars.",
  YOUTUBE:
    "Title-style for the first sentence, description-style after. Lead with the value proposition. No hashtags (use tags separately).",
  TIKTOK:
    "Short, punchy. Caption under 150 chars. 3-5 trending hashtags. One emoji.",
};

const DEFAULT_BRAND_VOICE =
  "sNeek Property Services is a trusted Australian cleaning service for Airbnb hosts and property owners. Clean, calm, professional voice.";

export async function composeSocialPost(req: ComposeRequest): Promise<ComposedPost> {
  const config = getAiConfiguration();
  if (!config.configured) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const tone = req.tone ?? "friendly";
  const brandVoice = req.brandVoice ?? DEFAULT_BRAND_VOICE;

  const prompt = `Compose a social media post for ${req.platform}.

Topic: ${req.topic}
Tone: ${tone}
Call to action: ${req.callToAction ?? "Book online"}
Brand voice: ${brandVoice}

Platform guidance: ${PLATFORM_GUIDANCE[req.platform]}

Return JSON only, no preamble:
{
  "caption": "the post body",
  "hashtags": ["#example1", "#example2"],
  "suggestedHook": "first sentence that grabs attention (used as opening line)"
}`;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
    timeout: 30000,
    maxRetries: 0,
  });

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Claude sometimes wraps JSON in ```json fences; strip them.
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  return composedPostSchema.parse(JSON.parse(cleaned));
}
