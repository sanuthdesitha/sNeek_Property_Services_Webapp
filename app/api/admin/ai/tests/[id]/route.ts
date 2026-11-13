import { NextResponse } from "next/server";
import { AI_ADMIN_HEADERS, aiAdminFailure, requireAiAdmin } from "@/lib/ai/provider/admin-http";
import { readAiTask } from "@/lib/ai/provider/tasks";

export const dynamic = "force-dynamic";

/** Poll a queued test. Only the administrator who queued it can read it. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireAiAdmin({ write: false });
    const task = await readAiTask(params.id, session.user.id);
    if (!task) return NextResponse.json({ error: "Test not found." }, { status: 404, headers: AI_ADMIN_HEADERS });
    return NextResponse.json({ task }, { headers: AI_ADMIN_HEADERS });
  } catch (error) { return aiAdminFailure(error, "The test status could not be read."); }
}
