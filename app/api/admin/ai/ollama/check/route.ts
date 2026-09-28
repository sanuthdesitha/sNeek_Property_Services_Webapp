import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ollamaCheckSchema, runOllamaCheck } from "@/lib/ai/ollama-diagnostics";
import { acquireOllamaOperation } from "@/lib/ai/ollama-admin-operation";
import { headers, failure } from "@/lib/ai/ollama-admin-http";
export const dynamic = "force-dynamic";
export const maxDuration = 360;
export async function POST(request: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    await requireRole([Role.ADMIN]);
    const body = await request.json().catch(() => null);
    const result = ollamaCheckSchema.safeParse(body?.check);
    if (!result.success) return NextResponse.json({ error: "Choose a supported capability check." }, { status: 400, headers });
    release = await acquireOllamaOperation(7 * 60_000);
    return NextResponse.json(await runOllamaCheck(result.data), { headers });
  } catch (error) { return failure(error); }
  finally { await release?.().catch(() => undefined); }
}
