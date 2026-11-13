import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getVisionSettings, saveVisionSettings } from "@/lib/ai/vision-settings";
import { visionSettingsSchema } from "@/lib/ai/vision-settings-schema";
import { getResolvedVisionProviderConfiguration } from "@/lib/ai/config";
import { getRecognitionConfiguration } from "@/lib/ai/property-photo-model";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: status === 500 ? "Unable to load or save vision settings" : message }, { status, headers });
}
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getVisionSettings();
    return NextResponse.json({ settings, configured: (await getResolvedVisionProviderConfiguration(settings.provider)).configured, recognitionConfigured: getRecognitionConfiguration().configured }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Photo check settings cannot be changed while testing as someone." }, { status: 403, headers });
    const body = await request.json().catch(() => null);
    const result = visionSettingsSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "Invalid vision settings" }, { status: 400, headers });
    if (result.data.minorPoints > result.data.majorPoints) return NextResponse.json({ error: "A minor finding cannot deduct more points than a major one." }, { status: 400, headers });
    if (result.data.dedicatedRecognitionEnabled && !getRecognitionConfiguration().configured) return NextResponse.json({ error: "Configure MODEL_SERVICE_URL and MODEL_SERVICE_TOKEN on the server before enabling dedicated recognition." }, { status: 400, headers });
    if ((result.data.comparisonEnabled || (result.data.assignmentEnabled && !result.data.dedicatedRecognitionEnabled)) && !(await getResolvedVisionProviderConfiguration(result.data.provider)).configured) return NextResponse.json({ error: `Configure ${result.data.provider === "ollama" ? "Ollama connection in Settings → Ollama" : result.data.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} on the server before enabling photo analysis with this provider.` }, { status: 400, headers });
    return NextResponse.json({ settings: await saveVisionSettings(result.data, session.user.id) }, { headers });
  } catch (error) { return failure(error); }
}
