import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getPublicCredentialStates, saveAiCredential } from "@/lib/ai/provider/admin";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin } from "@/lib/ai/provider/admin-http";
import { reserveRateLimit, SECRET_PROVIDERS, type SecretProvider } from "@/lib/ai/provider/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(SECRET_PROVIDERS as unknown as [SecretProvider, ...SecretProvider[]]),
  apiKey: z.string().max(4096).optional(),
  clear: z.boolean().optional(),
  password: z.string().max(500),
}).strict().refine((value) => Boolean(value.clear) !== Boolean(value.apiKey?.trim()), "Enter a key or choose Remove, not both.");

/**
 * Saves or removes one AI provider key. The administrator re-enters their
 * password; the key is stored encrypted and never returned. Ten password
 * attempts per 15 minutes per person (shared across replicas).
 */
export async function POST(request: Request) {
  try {
    const session = await requireAiAdmin({ write: true });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter a key or choose Remove, and enter your password." }, { status: 400, headers: AI_ADMIN_HEADERS });
    if (!(await reserveRateLimit(`ai-key-password:${session.user.id}`, 10, 15 * 60_000))) {
      return NextResponse.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429, headers: AI_ADMIN_HEADERS });
    }
    if (!process.env.ENCRYPTION_KEY?.trim() && !parsed.data.clear) {
      return NextResponse.json({ error: "The server has no ENCRYPTION_KEY, so a key cannot be stored safely. Ask whoever runs the server to set it; until then the environment keys are used." }, { status: 409, headers: AI_ADMIN_HEADERS });
    }
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
    if (!user?.passwordHash) return NextResponse.json({ error: "Set an account password before changing AI keys.", needsPassword: true }, { status: 403, headers: AI_ADMIN_HEADERS });
    if (!parsed.data.password || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Incorrect password. The key was not changed.", needsPassword: true }, { status: 403, headers: AI_ADMIN_HEADERS });
    }
    try {
      await saveAiCredential({ provider: parsed.data.provider, apiKey: parsed.data.apiKey, clear: parsed.data.clear }, session.user.id);
    } catch (error) {
      if (error instanceof Error && /key|Remove/.test(error.message) && !/ENCRYPTION_KEY/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400, headers: AI_ADMIN_HEADERS });
      throw error;
    }
    return NextResponse.json({ credentials: await getPublicCredentialStates() }, { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "The key was not changed."); }
}
