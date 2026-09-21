import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { composeSocialPost } from "@/lib/marketing/ai-composer";
import { getAiConfiguration } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

async function authorize() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json(
      { error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Unable to authorize request" },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  return NextResponse.json(
    { ...getAiConfiguration(), connection: "untested" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  platform: z.enum(["FACEBOOK", "INSTAGRAM", "YOUTUBE", "TIKTOK"]),
  topic: z.string().min(3).max(500),
  tone: z.enum(["friendly", "professional", "playful", "urgent"]).optional(),
  callToAction: z.string().max(200).optional(),
  brandVoice: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const denied = await authorize();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.format() }, { status: 400 });
  }
  if (!getAiConfiguration().configured) {
    return NextResponse.json(
      { error: "AI composition is not configured. Ask an administrator to configure the provider on the server." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const result = await composeSocialPost(parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "AI composition failed. Please try again later." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
