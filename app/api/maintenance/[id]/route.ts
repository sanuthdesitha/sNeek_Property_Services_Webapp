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
} from "@/lib/maintenance/service";
import { resolvePropertyAccess, resolvePhotoUrls } from "@/lib/maintenance/access";

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
    const { item, access } = await loadAndAuthorize(params.id, session.user.id, role);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!access?.allowed) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    // Clients only see clientVisible items.
    if (access.clientVisibleOnly && !item.clientVisible) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const photos = await resolvePhotoUrls(item.photoKeys);
    return NextResponse.json({ item: { ...item, photos } });
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

    // Only ADMIN/OPS can change status or edit item fields. Clients/cleaners/QA
    // can report new items but do not work the tracker down.
    const canManage = role === Role.ADMIN || role === Role.OPS_MANAGER;
    const wantsStatus = body.status !== undefined;
    const fieldKeys = (["category", "area", "title", "description", "recommendedAction", "priority", "estimatedCost", "clientVisible"] as const)
      .filter((k) => body[k] !== undefined);
    const wantsEdit = fieldKeys.length > 0;

    if ((wantsStatus || wantsEdit) && !canManage) {
      return NextResponse.json({ error: "Only admins can update maintenance items." }, { status: 403 });
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

    const updated = await getMaintenanceItem(params.id);
    const photos = updated ? await resolvePhotoUrls(updated.photoKeys) : [];
    return NextResponse.json({ item: updated ? { ...updated, photos } : null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update item." }, { status: errStatus(err.message) });
  }
}
