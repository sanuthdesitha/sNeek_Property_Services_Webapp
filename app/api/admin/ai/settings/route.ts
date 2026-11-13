import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSettings } from "@/lib/settings";
import { AiSettingsConflict, getPublicCredentialStates, saveAiRouting } from "@/lib/ai/provider/admin";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin } from "@/lib/ai/provider/admin-http";
import { getAiRouting, resolveFeatureRoute } from "@/lib/ai/provider/routing";
import { AI_FEATURES } from "@/lib/ai/provider/routing-schema";
import { getMonthlyAiUsage } from "@/lib/ai/provider/usage";

export const dynamic = "force-dynamic";

/** Everything the Settings, AI screen shows. Keys are never returned, only their state and last four characters. */
async function loadState() {
  const routing = await getAiRouting();
  const timezone = (await getAppSettings()).timezone || "Australia/Sydney";
  const [credentials, routes, usage] = await Promise.all([
    getPublicCredentialStates(),
    Promise.all(AI_FEATURES.map(async (feature) => {
      try {
        const route = await resolveFeatureRoute(feature, routing);
        return { feature, provider: route.provider, model: route.model, configured: route.configured, enabled: route.enabled, cloud: route.cloud, allowImages: route.allowImages, source: route.source, error: null };
      } catch {
        return { feature, provider: null, model: null, configured: false, enabled: false, cloud: false, allowImages: false, source: null, error: "This feature's provider settings could not be read." };
      }
    })),
    getMonthlyAiUsage(new Date(), timezone).catch(() => null),
  ]);
  return { routing, credentials, routes, usage, timezone, encryptionReady: Boolean(process.env.ENCRYPTION_KEY?.trim()) };
}

export async function GET() {
  try {
    await requireAiAdmin({ write: false });
    return NextResponse.json(await loadState(), { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "AI settings could not be loaded."); }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAiAdmin({ write: true });
    const body = await request.json().catch(() => null);
    try {
      await saveAiRouting(body, session.user.id);
    } catch (error) {
      if (error instanceof AiSettingsConflict) return NextResponse.json({ error: error.message, current: error.current }, { status: 409, headers: AI_ADMIN_HEADERS });
      if (error instanceof z.ZodError) return NextResponse.json({ error: "Check the highlighted values: model names, limits (1 to 10,000 an hour) and deadlines (10 to 300 seconds)." }, { status: 400, headers: AI_ADMIN_HEADERS });
      if (error instanceof Error && error.message.startsWith("The OpenAI-compatible address")) return NextResponse.json({ error: error.message }, { status: 400, headers: AI_ADMIN_HEADERS });
      throw error;
    }
    return NextResponse.json(await loadState(), { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "AI settings were not saved."); }
}
