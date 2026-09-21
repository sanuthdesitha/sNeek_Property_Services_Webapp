import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { PhotoAssignmentError, proposePhotoAssignments } from "@/lib/cleaner/photo-assignment";
import { ZodError } from "zod";
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const session = await requireRole(["CLEANER"]);
    return NextResponse.json(await proposePhotoAssignments(params.id, session, await req.json(), req.headers.get("X-Cleaner-Draft-Identity")), { headers });
  } catch (error: any) {
    const status = error instanceof PhotoAssignmentError ? error.status : error instanceof ZodError ? 400 : error?.status === 401 || error?.status === 403 ? error.status : 503;
    return NextResponse.json({ error: error instanceof PhotoAssignmentError ? error.message : status === 400 ? "Invalid photo assignment request." : status === 401 || status === 403 ? "Not authorized." : "Photo analysis is unavailable. Your photos remain unassigned; try again or assign manually.", ...(error instanceof PhotoAssignmentError && error.maxBatchSize ? { maxBatchSize: error.maxBatchSize } : {}) }, { status, headers });
  }
}
