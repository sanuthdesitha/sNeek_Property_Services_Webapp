import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { getTemplateEngineFlags, setKindV2Enabled } from "@/lib/templates/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const flags = await getTemplateEngineFlags();
  return NextResponse.json({ kinds: flags.kinds });
}

const patchSchema = z.object({ kind: z.string().min(1), enabled: z.boolean() });

/** Flip a kind onto the v2 renderer (or back to legacy). Instant, per-kind. */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  if (!TEMPLATE_KINDS[parsed.data.kind]) {
    return NextResponse.json({ error: "Unknown template kind" }, { status: 400 });
  }
  await setKindV2Enabled(parsed.data.kind, parsed.data.enabled);
  return NextResponse.json({ ok: true, kind: parsed.data.kind, enabled: parsed.data.enabled });
}
