import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSettings } from "@/lib/settings";
import { AiCloudPhotosConfirmationRequired, AiSettingsConflict, getPublicCredentialStates, saveAiRouting } from "@/lib/ai/provider/admin";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin, requireAiReader } from "@/lib/ai/provider/admin-http";
import { getAiRouting, resolveFeatureRoute } from "@/lib/ai/provider/routing";
import { AI_FEATURES, aiRoutingSaveSchema, cloudImageFeaturesTurnedOn, type AiFeature } from "@/lib/ai/provider/routing-schema";
import { getMonthlyAiUsage } from "@/lib/ai/provider/usage";
import { getAiStatusFacts, lastAiSettingsSave } from "@/lib/ai/provider/status";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

export const dynamic = "force-dynamic";

/**
 * Everything the AI configuration page shows. Keys are never returned, only
 * their state and, for administrators, the last four characters. `status`
 * holds recorded facts (last tests, provider health, limit hits, last save);
 * it is null when they cannot be read, so the page says "Not known".
 */
async function loadState(viewer: { isAdmin: boolean; canEdit: boolean }) {
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
  const status = await getAiStatusFacts().catch(() => null);
  // Operations managers read the page but never see any part of a key.
  const visibleCredentials = viewer.isAdmin ? credentials : credentials.map((credential) => ({ ...credential, hint: null }));
  return {
    routing, credentials: visibleCredentials, routes, usage, timezone, status,
    canEdit: viewer.canEdit, isAdmin: viewer.isAdmin,
    encryptionReady: Boolean(process.env.ENCRYPTION_KEY?.trim()),
  };
}

export async function GET() {
  try {
    const viewer = await requireAiReader();
    return NextResponse.json(await loadState(viewer), { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "AI settings could not be loaded."); }
}

/** The routing save body without the tier C credential, which never reaches the stored settings. */
function splitSecurity(body: unknown): { routing: unknown; security: ReturnType<typeof securityFromBody> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { routing: body, security: undefined };
  const { security: _security, ...routing } = body as Record<string, unknown>;
  return { routing, security: securityFromBody(body) };
}

/**
 * Saves the routing. Turning "photos may leave the server" ON for any feature
 * (owner decision 2026-11-14) needs the administrator's own PIN, or their
 * password while they have no PIN, in `security`, verified here in the same
 * request with verifySensitiveAction("ai.cloud_photos"): actual signed-in
 * person only, refused while testing as someone, counted toward the lockout,
 * audited (SENSITIVE_ACTION_CONFIRMED, plus AI_CLOUD_PHOTOS_ALLOWED with the
 * save). Turning it off, and every other routing change, needs no PIN.
 */
export async function PUT(request: Request) {
  try {
    const session = await requireAiAdmin({ write: true });
    const { routing: body, security } = splitSecurity(await request.json().catch(() => null));
    let cloudPhotosConfirmed: AiFeature[] = [];
    const parsed = aiRoutingSaveSchema.safeParse(body);
    if (parsed.success) {
      const turnedOn = cloudImageFeaturesTurnedOn(await getAiRouting(), parsed.data.settings);
      if (turnedOn.length) {
        const refusal = await routeSecurityRefusal(session, security ?? null, "ai.cloud_photos");
        if (refusal) {
          const answer = (await refusal.json()) as { error?: string; code?: string };
          return NextResponse.json(
            { error: `${sensitiveVerificationText(answer.error)} Nothing was saved.`, code: answer.code, needsCredential: true, features: turnedOn },
            { status: refusal.status, headers: AI_ADMIN_HEADERS },
          );
        }
        cloudPhotosConfirmed = turnedOn;
      }
    }
    try {
      await saveAiRouting(body, session.user.id, { cloudPhotosConfirmed });
    } catch (error) {
      if (error instanceof AiSettingsConflict) {
        const savedBy = await lastAiSettingsSave().catch(() => null);
        return NextResponse.json({ error: error.message, current: error.current, savedBy }, { status: 409, headers: AI_ADMIN_HEADERS });
      }
      if (error instanceof AiCloudPhotosConfirmationRequired) {
        return NextResponse.json({ error: `${error.message} Nothing was saved.`, code: "CLOUD_PHOTOS_CONFIRMATION_REQUIRED", needsCredential: true, features: error.features }, { status: 423, headers: AI_ADMIN_HEADERS });
      }
      if (error instanceof z.ZodError) return NextResponse.json({ error: "Check the highlighted values: model names, limits (1 to 10,000 an hour) and deadlines (10 to 300 seconds)." }, { status: 400, headers: AI_ADMIN_HEADERS });
      if (error instanceof Error && error.message.startsWith("The OpenAI-compatible address")) return NextResponse.json({ error: error.message }, { status: 400, headers: AI_ADMIN_HEADERS });
      throw error;
    }
    return NextResponse.json(await loadState({ isAdmin: true, canEdit: true }), { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "AI settings were not saved."); }
}
