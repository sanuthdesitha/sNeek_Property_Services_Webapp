import { NextResponse } from "next/server";
import { z } from "zod";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin } from "@/lib/ai/provider/admin-http";
import { AI_FEATURES } from "@/lib/ai/provider/routing-schema";
import { queueFeatureTest } from "@/lib/ai/provider/tasks";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ feature: z.enum(AI_FEATURES) }).strict();

/** Queues one real generation test for a feature. The background worker runs it; the screen polls. */
export async function POST(request: Request) {
  try {
    const session = await requireAiAdmin({ write: true });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a feature to test." }, { status: 400, headers: AI_ADMIN_HEADERS });
    return NextResponse.json({ task: await queueFeatureTest(parsed.data.feature, session.user.id) }, { status: 202, headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "The test could not be queued."); }
}
