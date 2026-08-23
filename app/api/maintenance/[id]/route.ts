import { NextRequest, NextResponse } from "next/server";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  getMaintenanceItem,
  updateMaintenanceItem,
  updateMaintenanceStatus,
  setMaintenanceQuote,
  decideMaintenanceCost,
} from "@/lib/maintenance/service";
import { resolvePropertyAccess, resolvePhotoUrls } from "@/lib/maintenance/access";
import {
  userIsAssignedWorker,
  assignMaintenanceItem,
  routeMaintenanceToAdmin,
  attachMaintenanceItemToJob,
} from "@/lib/maintenance/workers";
import { parseAssignTarget } from "@/lib/maintenance/assignment-routing";
import { parseInstructions } from "@/lib/maintenance/instructions";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/security/encryption";

/** Decrypt the stored access codes so on-site staff see the real values. */
function decryptAccess<T extends { property?: any }>(item: T): T {
  if (item.property) {
    item.property = {
      ...item.property,
      accessCode: decryptSecret(item.property.accessCode) ?? item.property.accessCode ?? null,
      alarmCode: decryptSecret(item.property.alarmCode) ?? item.property.alarmCode ?? null,
    };
  }
  return item;
}

function errStatus(message: string) {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

const patchSchema = z
  .object({
    // Status transition (single item).
    status: z.nativeEnum(MaintenanceStatus).optional(),
    note: z.string().trim().max(4000).optional().nullable(),
    resolutionNote: z.string().trim().max(4000).optional().nullable(),
    // Field edits.
    category: z.nativeEnum(MaintenanceCategory).optional(),
    area: z.string().trim().max(120).optional().nullable(),
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(6000).optional().nullable(),
    recommendedAction: z.nativeEnum(MaintenanceAction).optional(),
    priority: z.nativeEnum(MaintenancePriority).optional(),
    estimatedCost: z.number().nonnegative().optional().nullable(),
    clientVisible: z.boolean().optional(),
    // CP-8 assignment rule: "clients may assign directly to a maintenance
    // worker OR to admin". A worker id assigns to that worker; explicit NULL
    // means "send it to admin to arrange" — the same field, so a client who can
    // assign can also hand it back without a second permission surface.
    assignWorkerId: z.string().trim().min(1).nullable().optional(),
    // CP-8: attach the item to a job, which auto-creates the job task.
    attachJobId: z.string().trim().min(1).optional(),
    // Cost quote (admin/ops set a price for the client to approve).
    quotedCost: z.number().nonnegative().optional(),
    // Client (or admin/ops) approves/declines the quoted cost.
    costDecision: z.enum(["APPROVED", "DECLINED"]).optional(),
    // The typed instruction blocks shown to whoever is assigned. Accepted as
    // loose objects and normalised by parseInstructions before the write —
    // that function is already the single definition of what a valid block is,
    // and a second definition in zod here would be the copy that goes stale.
    assignmentInstructions: z.array(z.record(z.unknown())).max(30).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No changes supplied." });

async function loadAndAuthorize(itemId: string, userId: string, role: Role) {
  const item = await getMaintenanceItem(itemId);
  if (!item) return { item: null, access: null };
  const access = await resolvePropertyAccess({
    userId,
    role,
    propertyId: item.propertyId,
    jobId: item.jobId,
  });
  return { item, access };
}

// ─── GET detail (with full event history) ───────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;

    // Maintenance workers see only the item assigned to them; property access
    // details are exposed only when the admin ticked "share access".
    if (role === Role.MAINTENANCE) {
      const item = await getMaintenanceItem(params.id);
      if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (!(await userIsAssignedWorker(session.user.id, params.id))) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
      const photos = await resolvePhotoUrls(item.photoKeys);
      const finishPhotos = await resolvePhotoUrls(item.finishPhotoKeys);
      const safe: any = decryptAccess({ ...item, photos, finishPhotos, canManage: false });
      if (!item.shareAccess && safe.property) {
        safe.property = {
          ...safe.property,
          accessCode: null,
          alarmCode: null,
          keyLocation: null,
          accessNotes: null,
          accessInfo: null,
        };
      }
      return NextResponse.json({ item: safe });
    }

    const { item, access } = await loadAndAuthorize(params.id, session.user.id, role);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!access?.allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    // Clients only see clientVisible items.
    if (access.clientVisibleOnly && !item.clientVisible) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const canManage = role === Role.ADMIN || role === Role.OPS_MANAGER;
    const photos = await resolvePhotoUrls(item.photoKeys);
    const finishPhotos = await resolvePhotoUrls(item.finishPhotoKeys);
    const result: any = canManage
      ? decryptAccess({ ...item, photos, finishPhotos, canManage })
      : { ...item, photos, finishPhotos, canManage };
    // Never leak raw access codes to clients.
    if (access.clientVisibleOnly && result.property) {
      result.property = {
        ...result.property,
        accessCode: null,
        alarmCode: null,
        keyLocation: null,
        accessNotes: null,
        accessInfo: null,
      };
    }
    return NextResponse.json({ item: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load item." }, { status: errStatus(err.message) });
  }
}

// ─── PATCH (status transition and/or field edits) ───────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const { item, access } = await loadAndAuthorize(params.id, session.user.id, role);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!access?.allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (access.clientVisibleOnly && !item.clientVisible) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // ADMIN/OPS manage everything. The OWNING client may also drive their own
    // items: assign a worker and move the status (it's their property) — but not
    // edit the core item fields (category/title/etc., admin-curated).
    const canManage = role === Role.ADMIN || role === Role.OPS_MANAGER;
    const canClientAct = role === Role.CLIENT && Boolean(access?.allowed);
    const wantsStatus = body.status !== undefined;
    const wantsAssign = body.assignWorkerId !== undefined;
    const wantsQuote = body.quotedCost !== undefined;
    const wantsCostDecision = body.costDecision !== undefined;
    const fieldKeys = (["category", "area", "title", "description", "recommendedAction", "priority", "estimatedCost", "clientVisible"] as const)
      .filter((k) => body[k] !== undefined);
    const wantsEdit = fieldKeys.length > 0;

    if (wantsEdit && !canManage) {
      return NextResponse.json({ error: "Only admins can edit maintenance item details." }, { status: 403 });
    }
    // Instructions are what the office tells the person doing the work. A
    // client editing them would be briefing a worker directly, outside anything
    // the office has agreed or priced.
    if (body.assignmentInstructions !== undefined && !canManage) {
      return NextResponse.json(
        { error: "Only admins can write the assignment instructions." },
        { status: 403 }
      );
    }
    if (wantsQuote && !canManage) {
      return NextResponse.json({ error: "Only admins can set a quote for approval." }, { status: 403 });
    }
    if ((wantsStatus || wantsAssign || wantsCostDecision) && !canManage && !canClientAct) {
      return NextResponse.json({ error: "You can't update this maintenance item." }, { status: 403 });
    }

    if (wantsQuote && body.quotedCost !== undefined) {
      await setMaintenanceQuote({ itemId: params.id, quotedCost: body.quotedCost, userId: session.user.id });
    }

    if (wantsCostDecision && body.costDecision) {
      await decideMaintenanceCost({ itemId: params.id, decision: body.costDecision, userId: session.user.id });
    }

    // CP-8 — a worker id assigns; an explicit null routes to admin. Both are
    // open to admin/ops AND the owning client, which is the owner-confirmed
    // rule: "clients may assign directly to a maintenance worker OR to admin".
    if (wantsAssign) {
      const target = parseAssignTarget(body.assignWorkerId);
      if (target?.kind === "WORKER") {
        await assignMaintenanceItem({
          itemId: params.id,
          workerId: target.workerId,
          assignedByUserId: session.user.id,
        });
      } else if (target?.kind === "ADMIN") {
        await routeMaintenanceToAdmin({
          itemId: params.id,
          routedByUserId: session.user.id,
          note: body.note ?? null,
        });
      }
    }

    // CP-8 — attaching to a job creates the job task, so the cleaner who turns
    // up actually learns there is maintenance to do. Admin/ops only: putting
    // work onto a scheduled job is a dispatch decision.
    if (body.attachJobId !== undefined) {
      if (!canManage) {
        return NextResponse.json(
          { error: "Only admins can attach maintenance to a job." },
          { status: 403 }
        );
      }
      await attachMaintenanceItemToJob({
        itemId: params.id,
        jobId: body.attachJobId,
        actorUserId: session.user.id,
      });
    }

    if (wantsStatus) {
      await updateMaintenanceStatus({
        ids: [params.id],
        status: body.status as MaintenanceStatus,
        userId: session.user.id,
        note: body.note ?? null,
        resolutionNote: body.resolutionNote ?? null,
      });
    }

    if (wantsEdit) {
      await updateMaintenanceItem({
        id: params.id,
        userId: session.user.id,
        fields: {
          category: body.category,
          area: body.area,
          title: body.title,
          description: body.description,
          recommendedAction: body.recommendedAction,
          priority: body.priority,
          estimatedCost: body.estimatedCost,
          clientVisible: body.clientVisible,
        },
        note: body.note ?? null,
      });
    }

    if (body.assignmentInstructions !== undefined) {
      // Round-tripped through the reader so what is stored is exactly what the
      // portal will render. Blocks with a heading and no content are dropped
      // here rather than saved and shown as an empty card, which reads on a
      // phone as information that failed to load.
      await db.propertyMaintenanceItem.update({
        where: { id: params.id },
        data: {
          assignmentInstructions: parseInstructions(body.assignmentInstructions) as any,
        },
      });
    }

    const updated = await getMaintenanceItem(params.id);
    const photos = updated ? await resolvePhotoUrls(updated.photoKeys) : [];
    return NextResponse.json({ item: updated ? { ...updated, photos } : null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update item." }, { status: errStatus(err.message) });
  }
}
