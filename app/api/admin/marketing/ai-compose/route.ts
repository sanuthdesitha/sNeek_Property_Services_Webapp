import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { composeSocialPost } from "@/lib/marketing/ai-composer";
import { describeFeatureRoute } from "@/lib/ai/provider/routing";
import { isAiUnavailable } from "@/lib/ai/provider/types";

export const dynamic = "force-dynamic";

async function authorize(): Promise<{ denied: NextResponse; userId: null } | { denied: null; userId: string }> {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return { denied: null, userId: session.user.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return { denied: NextResponse.json(
      { error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Unable to authorize request" },
      { status, headers: { "Cache-Control": "private, no-store" } },
    ), userId: null };
  }
}

export async function GET() {
  const { denied } = await authorize();
  if (denied) return denied;
  try {
    return NextResponse.json({ ...await describeFeatureRoute("text_compose"), connection: "untested" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "AI configuration could not be loaded. Review the saved provider settings." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
const schema = z.object({
  platform: z.enum(["FACEBOOK", "INSTAGRAM", "YOUTUBE", "TIKTOK"]),
  topic: z.string().min(3).max(500),
  tone: z.enum(["friendly", "professional", "playful", "urgent"]).optional(),
  callToAction: z.string().max(200).optional(),
  brandVoice: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const { denied, userId } = await authorize();
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
  try {
  if (!(await describeFeatureRoute("text_compose")).configured) {
    return NextResponse.json(
      { error: "AI composition is not configured. Ask an administrator to configure the provider on the server." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
    const result = await composeSocialPost(parsed.data, { actor: { kind: "user", userId } });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // "AI unavailable — continue manually": the safe reason (hourly limit, switched off).
    if (isAiUnavailable(error)) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(
      { error: "AI composition failed. Please try again later." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
