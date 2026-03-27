import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  createStaffDocument,
  getStaffWorkforceOverview,
  openDirectChat,
  restartLearningAssignment,
  saveLearningProgress,
  startLearningAssignment,
  submitLearningAssignment,
} from "@/lib/workforce/service";

const actionSchema = z.object({ action: z.string().trim().min(1) }).passthrough();

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const data = await getStaffWorkforceOverview(session.user.id);
    return NextResponse.json(data);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load team hub." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const body = actionSchema.parse(await req.json());

    switch (body.action) {
      case "OPEN_DIRECT_CHAT": {
        const result = await openDirectChat(session.user.id, String(body.otherUserId ?? ""));
        return NextResponse.json({ ok: true, result });
      }
      case "START_LEARNING": {
        await startLearningAssignment(String(body.assignmentId ?? ""), session.user.id);
        return NextResponse.json({ ok: true });
      }
      case "SAVE_LEARNING_PROGRESS": {
        const result = await saveLearningProgress({
          assignmentId: String(body.assignmentId ?? ""),
          userId: session.user.id,
          answers: body.answers && typeof body.answers === "object" ? body.answers as any : {},
        });
        return NextResponse.json({ ok: true, result });
      }
      case "RESTART_LEARNING": {
        const result = await restartLearningAssignment(String(body.assignmentId ?? ""), session.user.id);
        return NextResponse.json({ ok: true, result });
      }
      case "SUBMIT_LEARNING": {
        const result = await submitLearningAssignment({
          assignmentId: String(body.assignmentId ?? ""),
          userId: session.user.id,
          answers: body.answers && typeof body.answers === "object" ? body.answers as any : {},
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPLOAD_DOCUMENT": {
        const result = await createStaffDocument({
          userId: session.user.id,
          uploadedById: session.user.id,
          category: String(body.category ?? "OTHER"),
          title: String(body.title ?? "Document"),
          fileName: String(body.fileName ?? "document"),
          url: String(body.url ?? ""),
          s3Key: String(body.s3Key ?? ""),
          mimeType: body.mimeType ? String(body.mimeType) : null,
          notes: body.notes ? String(body.notes) : null,
          expiresAt: body.expiresAt ? String(body.expiresAt) : null,
        });
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: "Unsupported team hub action." }, { status: 400 });
    }
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Action failed." }, { status });
  }
}

