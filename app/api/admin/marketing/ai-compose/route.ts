import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { composeSocialPost } from "@/lib/marketing/ai-composer";

const schema = z.object({
  platform: z.enum(["FACEBOOK", "INSTAGRAM", "YOUTUBE", "TIKTOK"]),
  topic: z.string().min(3).max(500),
  tone: z.enum(["friendly", "professional", "playful", "urgent"]).optional(),
  callToAction: z.string().max(200).optional(),
  brandVoice: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.format() }, { status: 400 });
  }
  try {
    const result = await composeSocialPost(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compose failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
