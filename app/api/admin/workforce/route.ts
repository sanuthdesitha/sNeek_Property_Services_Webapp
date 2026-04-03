import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  createChatChannel,
  createHiringPosition,
  createLearningPath,
  createStaffDocument,
  createStaffDocumentRequest,
  createTeamGroup,
  createWorkforcePost,
  getAdminWorkforceOverview,
  openDirectChat,
  assignLearningPath,
  previewSmartGroupMembers,
  reviewStaffDocument,
  runRecognitionCheck,
  sendRecognition,
  updateHiringApplication,
  updateHiringPosition,
  updateLearningPath,
  updateTeamGroup,
  updateWorkforcePost,
} from "@/lib/workforce/service";

const actionSchema = z.object({
  action: z.string().trim().min(1),
}).passthrough();

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const data = await getAdminWorkforceOverview(session.user.id);
    return NextResponse.json(data);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load workforce data." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = actionSchema.parse(await req.json());

    switch (body.action) {
      case "CREATE_GROUP": {
        const result = await createTeamGroup({
          name: String(body.name ?? ""),
          description: body.description ? String(body.description) : null,
          category: body.category ? String(body.category) : null,
          membershipMode: body.membershipMode ? String(body.membershipMode) : null,
          smartRules: body.smartRules && typeof body.smartRules === "object" ? body.smartRules as any : null,
          memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : [],
          createChatChannel: body.createChatChannel === true,
          createdById: session.user.id,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPDATE_GROUP": {
        await createGuard(body.groupId, "groupId");
        await updateTeamGroup({
          groupId: String(body.groupId),
          name: String(body.name ?? ""),
          description: body.description ? String(body.description) : null,
          category: body.category ? String(body.category) : null,
          membershipMode: body.membershipMode ? String(body.membershipMode) : null,
          smartRules: body.smartRules && typeof body.smartRules === "object" ? body.smartRules as any : null,
          memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : [],
        });
        return NextResponse.json({ ok: true });
      }
      case "PREVIEW_GROUP": {
        const result = await previewSmartGroupMembers({
          membershipMode: body.membershipMode ? String(body.membershipMode) : null,
          smartRules: body.smartRules && typeof body.smartRules === "object" ? body.smartRules as any : null,
          memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : [],
        });
        return NextResponse.json({ ok: true, result });
      }
      case "CREATE_POST": {
        const result = await createWorkforcePost({
          title: String(body.title ?? ""),
          body: String(body.body ?? ""),
          type: body.type ? String(body.type) : "ANNOUNCEMENT",
          coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
          pinned: body.pinned === true,
          audience: body.audience && typeof body.audience === "object" ? body.audience as any : { all: true },
          attachments: body.attachments && typeof body.attachments === "object" ? body.attachments as any : null,
          publishAt: body.publishAt ? String(body.publishAt) : null,
          createdById: session.user.id,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPDATE_POST": {
        await createGuard(body.postId, "postId");
        const result = await updateWorkforcePost({
          postId: String(body.postId),
          title: String(body.title ?? ""),
          body: String(body.body ?? ""),
          type: body.type ? String(body.type) : "ANNOUNCEMENT",
          coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
          pinned: body.pinned === true,
          audience: body.audience && typeof body.audience === "object" ? body.audience as any : { all: true },
          attachments: body.attachments && typeof body.attachments === "object" ? body.attachments as any : null,
          publishAt: body.publishAt ? String(body.publishAt) : null,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "CREATE_CHANNEL": {
        const result = await createChatChannel({
          name: String(body.name ?? ""),
          description: body.description ? String(body.description) : null,
          kind: body.kind ? String(body.kind) : null,
          groupId: body.groupId ? String(body.groupId) : null,
          memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds.map(String) : [],
          createdById: session.user.id,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "OPEN_DIRECT_CHAT": {
        const result = await openDirectChat(session.user.id, String(body.otherUserId ?? ""));
        return NextResponse.json({ ok: true, result });
      }
      case "ASSIGN_LEARNING": {
        await assignLearningPath({
          pathId: String(body.pathId ?? ""),
          userIds: Array.isArray(body.userIds) ? body.userIds.map(String) : [],
          groupIds: Array.isArray(body.groupIds) ? body.groupIds.map(String) : [],
          roles: Array.isArray(body.roles) ? body.roles.map(String) : [],
          assignedById: session.user.id,
          restart: body.restart === true,
        });
        return NextResponse.json({ ok: true });
      }
      case "CREATE_LEARNING_PATH": {
        const result = await createLearningPath({
          title: String(body.title ?? ""),
          slug: body.slug ? String(body.slug) : null,
          type: body.type ? String(body.type) : null,
          description: body.description ? String(body.description) : null,
          coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
          audience: body.audience && typeof body.audience === "object" ? body.audience as any : null,
          schema: body.schema && typeof body.schema === "object" ? body.schema as any : null,
          isPublished: body.isPublished === true,
          mandatory: body.mandatory === true,
          createdById: session.user.id,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPDATE_LEARNING_PATH": {
        await createGuard(body.pathId, "pathId");
        const result = await updateLearningPath({
          pathId: String(body.pathId),
          title: body.title ? String(body.title) : undefined,
          slug: body.slug ? String(body.slug) : undefined,
          type: body.type ? String(body.type) : undefined,
          description: body.description !== undefined ? String(body.description) : undefined,
          coverImageUrl: body.coverImageUrl !== undefined ? String(body.coverImageUrl) : undefined,
          audience: body.audience && typeof body.audience === "object" ? body.audience as any : undefined,
          schema: body.schema && typeof body.schema === "object" ? body.schema as any : undefined,
          isPublished: typeof body.isPublished === "boolean" ? body.isPublished : undefined,
          mandatory: typeof body.mandatory === "boolean" ? body.mandatory : undefined,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "REVIEW_DOCUMENT": {
        const result = await reviewStaffDocument({
          documentId: String(body.documentId ?? ""),
          reviewerId: session.user.id,
          status: String(body.status ?? "PENDING"),
          notes: body.notes ? String(body.notes) : null,
          expiresAt: body.expiresAt ? String(body.expiresAt) : null,
          requiresSignature: body.requiresSignature === true,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPLOAD_DOCUMENT": {
        const result = await createStaffDocument({
          userId: String(body.userId ?? ""),
          uploadedById: session.user.id,
          category: String(body.category ?? "OTHER"),
          title: String(body.title ?? "Document"),
          fileName: String(body.fileName ?? "document"),
          url: String(body.url ?? ""),
          s3Key: String(body.s3Key ?? ""),
          mimeType: body.mimeType ? String(body.mimeType) : null,
          notes: body.notes ? String(body.notes) : null,
          expiresAt: body.expiresAt ? String(body.expiresAt) : null,
          requiresSignature: body.requiresSignature === true,
          requestId: body.requestId ? String(body.requestId) : null,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "REQUEST_DOCUMENT": {
        const result = await createStaffDocumentRequest({
          userId: String(body.userId ?? ""),
          requestedById: session.user.id,
          category: String(body.category ?? "OTHER"),
          title: String(body.title ?? "Requested document"),
          notes: body.notes ? String(body.notes) : null,
          dueAt: body.dueAt ? String(body.dueAt) : null,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "SEND_RECOGNITION": {
        const result = await sendRecognition({
          userId: String(body.userId ?? ""),
          sentById: session.user.id,
          title: String(body.title ?? ""),
          message: body.message ? String(body.message) : null,
          badgeKey: body.badgeKey ? String(body.badgeKey) : "STAR",
          celebrationStyle: body.celebrationStyle ? String(body.celebrationStyle) : "SPOTLIGHT",
          isPublic: body.isPublic !== false,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "RUN_RECOGNITION_CHECK": {
        const result = await runRecognitionCheck(new Date());
        return NextResponse.json({ ok: true, result });
      }
      case "CREATE_POSITION": {
        const result = await createHiringPosition({
          title: String(body.title ?? ""),
          slug: body.slug ? String(body.slug) : null,
          description: body.description ? String(body.description) : null,
          department: body.department ? String(body.department) : null,
          location: body.location ? String(body.location) : null,
          employmentType: body.employmentType ? String(body.employmentType) : null,
          isPublished: body.isPublished !== false,
          createdById: session.user.id,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "UPDATE_POSITION": {
        await createGuard(body.positionId, "positionId");
        const result = await updateHiringPosition({
          positionId: String(body.positionId),
          title: String(body.title ?? ""),
          slug: body.slug ? String(body.slug) : null,
          description: body.description ? String(body.description) : null,
          department: body.department ? String(body.department) : null,
          location: body.location ? String(body.location) : null,
          employmentType: body.employmentType ? String(body.employmentType) : null,
          isPublished: body.isPublished !== false,
        });
        return NextResponse.json({ ok: true, result });
      }
      case "REVIEW_APPLICATION": {
        const result = await updateHiringApplication({
          applicationId: String(body.applicationId ?? ""),
          reviewedById: session.user.id,
          status: String(body.status ?? "NEW"),
          notes: body.notes ? String(body.notes) : null,
          interviewNotes: body.interviewNotes ? String(body.interviewNotes) : null,
          interviewDate: body.interviewDate ? String(body.interviewDate) : null,
          offerDetails: body.offerDetails && typeof body.offerDetails === "object" ? body.offerDetails as any : null,
          rejectionReason: body.rejectionReason ? String(body.rejectionReason) : null,
        });
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: "Unsupported workforce action." }, { status: 400 });
    }
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Workforce action failed." }, { status });
  }
}

async function createGuard(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
}

