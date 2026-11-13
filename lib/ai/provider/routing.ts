import "server-only";
import { getResolvedAiConfiguration, getResolvedVisionProviderConfiguration } from "@/lib/ai/config";
import { getVisionSettings } from "@/lib/ai/vision-settings";
import {
  AI_FEATURE_CATALOG, DEFAULT_AI_ROUTING, isAcceptableCompatibleBaseUrl, isCloudProvider,
  type AiFeature, type AiProviderKind, type AiRoute, type AiRoutingSettings,
} from "./routing-schema";
import { readAiRoutingSettings, readProviderSecret } from "./store";
import type { ResolvedRoute } from "./types";

export async function getAiRouting(): Promise<AiRoutingSettings> {
  return (await readAiRoutingSettings()) ?? DEFAULT_AI_ROUTING;
}

async function providerConfigured(provider: AiProviderKind, routing: AiRoutingSettings): Promise<boolean> {
  if (provider === "openai_compatible") {
    if (!isAcceptableCompatibleBaseUrl(routing.compatible.baseUrl)) return false;
    try { return Boolean(await readProviderSecret("openai_compatible")); } catch { return false; }
  }
  return (await getResolvedVisionProviderConfiguration(provider)).configured;
}

function isPhotoFeature(feature: AiFeature): boolean {
  return AI_FEATURE_CATALOG[feature].usesImages;
}

type FeatureChoice = { route: AiRoute; source: ResolvedRoute["source"]; legacyConfigured: boolean | null; unsupported: boolean };

/**
 * Which provider and model a feature uses right now, without contacting or
 * configuring anything (cheap; used before refusing deselected queued work):
 *  1. the feature's own route in Settings, AI;
 *  2. photo features: the photo provider in AI workflow settings;
 *     text features: the default route in Settings, AI;
 *  3. text features with no saved default: the server environment selection.
 */
async function chooseFeatureRoute(feature: AiFeature, routing: AiRoutingSettings): Promise<FeatureChoice> {
  const settings = routing.features[feature];
  if (settings.route) return { route: settings.route, source: "feature", legacyConfigured: null, unsupported: false };
  if (isPhotoFeature(feature)) {
    const vision = await getVisionSettings();
    return { route: { provider: vision.provider, model: vision.model }, source: "photo-settings", legacyConfigured: null, unsupported: false };
  }
  if (routing.defaultRoute) return { route: routing.defaultRoute, source: "default", legacyConfigured: null, unsupported: false };
  const legacy = await getResolvedAiConfiguration();
  const unsupported = !["anthropic", "openai", "ollama"].includes(legacy.provider);
  return { route: { provider: legacy.provider as AiProviderKind, model: legacy.model }, source: "environment", legacyConfigured: unsupported ? false : legacy.configured, unsupported };
}

export async function resolveFeatureProvider(feature: AiFeature): Promise<{ provider: AiProviderKind; model: string }> {
  return (await chooseFeatureRoute(feature, await getAiRouting())).route;
}

/** The full route, re-read on every call so a saved change applies to the next request. */
export async function resolveFeatureRoute(feature: AiFeature, routingOverride?: AiRoutingSettings): Promise<ResolvedRoute> {
  const routing = routingOverride ?? await getAiRouting();
  const settings = routing.features[feature];
  const choice = await chooseFeatureRoute(feature, routing);
  const { route } = choice;
  const cloud = choice.unsupported || isCloudProvider(route.provider);
  return {
    feature,
    provider: route.provider,
    model: route.model,
    baseUrl: route.provider === "openai_compatible" ? routing.compatible.baseUrl || null : null,
    configured: choice.legacyConfigured ?? await providerConfigured(route.provider, routing),
    cloud,
    enabled: settings.enabled && AI_FEATURE_CATALOG[feature].built,
    allowImages: !choice.unsupported && (!cloud || settings.allowCloudImages),
    timeoutMs: settings.timeoutSeconds * 1000,
    hourlyLimitPerActor: settings.hourlyLimitPerActor,
    source: choice.source,
  };
}

/** Sanitized status for screens and GET routes: no credentials, no URLs with secrets. */
export async function describeFeatureRoute(feature: AiFeature): Promise<{ provider: string; model: string; configured: boolean }> {
  const route = await resolveFeatureRoute(feature);
  return { provider: route.provider, model: route.model, configured: route.configured && route.enabled };
}
