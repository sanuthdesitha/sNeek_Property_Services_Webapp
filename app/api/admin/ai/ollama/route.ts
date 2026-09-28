import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getPublicOllamaSettings, saveOllamaSettings } from "@/lib/ai/ollama-settings";
import { ollamaSettingsInputSchema } from "@/lib/ai/ollama-settings-schema";
import { acquireOllamaOperation } from "@/lib/ai/ollama-admin-operation";
import { headers, failure } from "@/lib/ai/ollama-admin-http";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireRole([Role.ADMIN]); return NextResponse.json({ settings: await getPublicOllamaSettings() }, { headers }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    await requireRole([Role.ADMIN]);
    const result = ollamaSettingsInputSchema.safeParse(await request.json().catch(() => null));
    if (!result.success) return NextResponse.json({ error: "Check the internal address, local model names and numeric limits." }, { status: 400, headers });
    release = await acquireOllamaOperation(30_000);
    return NextResponse.json({ settings: await saveOllamaSettings(result.data) }, { headers });
  } catch (error) { return failure(error); }
  finally { await release?.().catch(() => undefined); }
}
