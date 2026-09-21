import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getVisionSettings, saveVisionSettings } from "@/lib/ai/vision-settings";
import { visionSettingsSchema } from "@/lib/ai/vision-settings-schema";
import { getAiConfiguration } from "@/lib/ai/config";
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
    return NextResponse.json({ settings: await getVisionSettings(), configured: getAiConfiguration().configured, recognitionConfigured: getRecognitionConfiguration().configured }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    await requireRole([Role.ADMIN]);
    const body = await request.json().catch(() => null);
    const result = visionSettingsSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "Invalid vision settings" }, { status: 400, headers });
    if (result.data.dedicatedRecognitionEnabled && !getRecognitionConfiguration().configured) return NextResponse.json({ error: "Configure MODEL_SERVICE_URL and MODEL_SERVICE_TOKEN on the server before enabling dedicated recognition." }, { status: 400, headers });
    if ((result.data.comparisonEnabled || (result.data.assignmentEnabled && !result.data.dedicatedRecognitionEnabled)) && !getAiConfiguration().configured) return NextResponse.json({ error: "Configure ANTHROPIC_API_KEY on the server before enabling reference comparison or Anthropic photo assignment." }, { status: 400, headers });
    return NextResponse.json({ settings: await saveVisionSettings(result.data) }, { headers });
  } catch (error) { return failure(error); }
}
