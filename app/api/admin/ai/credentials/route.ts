import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicCredentialStates, saveAiCredential } from "@/lib/ai/provider/admin";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin } from "@/lib/ai/provider/admin-http";
import { reserveRateLimit, SECRET_PROVIDERS, type SecretProvider } from "@/lib/ai/provider/store";
import { SensitiveVerificationError, isSensitiveRefusal, verifySensitiveAction } from "@/lib/security/admin-verification";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";

export const dynamic = "force-dynamic";

const securitySchema = z
  .object({ pin: z.string().max(200).optional(), password: z.string().max(500).optional() })
  .strict();

const bodySchema = z.object({
  provider: z.enum(SECRET_PROVIDERS as unknown as [SecretProvider, ...SecretProvider[]]),
  apiKey: z.string().max(4096).optional(),
  clear: z.boolean().optional(),
  /** The tier C credential: `{ pin }`, or `{ password }` while the administrator has no PIN. */
  security: securitySchema.optional(),
  /** @deprecated Older AI settings screens sent the password here; read as `security.password`. */
  password: z.string().max(500).optional(),
}).strict().refine((value) => Boolean(value.clear) !== Boolean(value.apiKey?.trim()), "Enter a key or choose Remove, not both.");

/**
 * Saves or removes one AI provider key. Tier C since 2026-11-14 ("simpler
 * confirmations"): confirmed with the administrator's own PIN, or their
 * account password while they have no PIN, verified by verifySensitiveAction
 * (actual signed-in person only, never while testing as someone, the shared
 * wrong-attempt lockout, and a SENSITIVE_ACTION_CONFIRMED audit row naming the
 * credential used). A password is refused once the person has a PIN.
 *
 * Request: { provider, apiKey | clear: true, security: { pin } | { password } }.
 * A top-level `password` from an older screen is still read as
 * `security.password`. The key is stored encrypted and never returned. Ten
 * attempts per 15 minutes per person (shared across replicas), as before.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAiAdmin({ write: true });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter a key or choose Remove, and confirm with your PIN.", needsCredential: true }, { status: 400, headers: AI_ADMIN_HEADERS });
    if (!(await reserveRateLimit(`ai-key-password:${session.user.id}`, 10, 15 * 60_000))) {
      return NextResponse.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429, headers: AI_ADMIN_HEADERS });
    }
    if (!process.env.ENCRYPTION_KEY?.trim() && !parsed.data.clear) {
      return NextResponse.json({ error: "The server has no ENCRYPTION_KEY, so a key cannot be stored safely. Ask whoever runs the server to set it; until then the environment keys are used." }, { status: 409, headers: AI_ADMIN_HEADERS });
    }
    const security = parsed.data.security ?? (parsed.data.password !== undefined ? { password: parsed.data.password } : undefined);
    try {
      await verifySensitiveAction(session.user.id, security ?? null);
    } catch (error) {
      const code = error instanceof SensitiveVerificationError ? error.code : error instanceof Error ? error.message : "INVALID_SECURITY_VERIFICATION";
      const status = code === "ACTUAL_ACTOR_REQUIRED" || code === "FORBIDDEN" ? 403 : code === "UNAUTHORIZED" ? 401 : isSensitiveRefusal(error) ? 423 : 400;
      return NextResponse.json(
        { error: `${sensitiveVerificationText(error instanceof Error ? error.message : code)} The key was not changed.`, code, needsCredential: true },
        { status, headers: AI_ADMIN_HEADERS },
      );
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
