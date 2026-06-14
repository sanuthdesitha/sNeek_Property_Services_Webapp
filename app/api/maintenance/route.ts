import { NextRequest, NextResponse } from "next/server";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  createMaintenanceItem,
  listMaintenanceItems,
  getMaintenanceSummary,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_ACTIONS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_SOURCES,
} from "@/lib/maintenance/service";
import {
  resolvePropertyAccess,
  sourceForRole,
  clientIdForUser,
  resolvePhotoUrls,
} from "@/lib/maintenance/access";
import { airbnbPropertyIdsForClient, filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { db } from "@/lib/db";

function errStatus(message: string) {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

function splitCsv<T extends string>(value: string | null, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is T => (allowed as readonly string[]).includes(p));
  return parts.length > 0 ? parts : undefined;
}

const createSchema = z.object({
  propertyId: z.string().trim().min(1),
  jobId: z.string().trim().min(1).optional().nullable(),
  category: z.nativeEnum(MaintenanceCategory).optional(),
  area: z.string().trim().max(120).optional().nullable(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(6000).optional().nullable(),
  recommendedAction: z.nativeEnum(MaintenanceAction).optional(),
  priority: z.nativeEnum(MaintenancePriority).optional(),
  photoKeys: z.array(z.string().trim().min(1)).max(20).optional(),
  estimatedCost: z.number().nonnegative().optional().nullable(),
  clientVisible: z.boolean().optional(),
});

// ─── POST create ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const access = await resolvePropertyAccess({
      userId: session.user.id,
      role,
      propertyId: body.propertyId,
      jobId: body.jobId ?? null,
    });
    if (!access.allowed) {
      const status = access.reason === "NOT_AIRBNB" ? 400 : 403;
      return NextResponse.json(
        {
          error:
            access.reason === "NOT_AIRBNB"
              ? "Maintenance tracking is only available for Airbnb properties."
              : "You cannot report maintenance on this property.",
        },
        { status },
      );
    }

    // Clients can never publish an item that hides itself from themselves.
    const clientVisible = role === Role.CLIENT ? true : body.clientVisible ?? true;

    const item = await createMaintenanceItem({
      propertyId: body.propertyId,
      reportedByUserId: session.user.id,
      source: sourceForRole(role) as MaintenanceSource,
      jobId: body.jobId ?? null,
      category: body.category,
      area: body.area ?? null,
      title: body.title,
      description: body.description ?? null,
      recommendedAction: body.recommendedAction,
      priority: body.priority,
      photoKeys: body.photoKeys,
      estimatedCost: body.estimatedCost ?? null,
      clientVisible,
    });

    // Best-effort: ping admins for high-urgency items. Never blocks the response.
    if (item.priority === MaintenancePriority.HIGH || item.priority === MaintenancePriority.URGENT) {
      try {
        await notifyAdminsByPush({
          subject: `Maintenance flagged (${item.priority}) — ${item.property.name}`,
          body: `${item.title}${item.area ? ` · ${item.area}` : ""} (${item.recommendedAction.toLowerCase()})`,
          jobId: item.jobId ?? null,
        });
      } catch {
        // swallow — notifications are non-critical
      }
    }

    return NextResponse.json({ item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create item." }, { status: errStatus(err.message) });
  }
}

// ─── GET list (role-scoped) ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const role = session.user.role as Role;
    const { searchParams } = new URL(req.url);

    const propertyId = searchParams.get("propertyId")?.trim() || undefined;
    const status = splitCsv(searchParams.get("status"), MAINTENANCE_STATUSES);
    const priority = splitCsv(searchParams.get("priority"), MAINTENANCE_PRIORITIES);
    const category = splitCsv(searchParams.get("category"), MAINTENANCE_CATEGORIES);
    const source = splitCsv(searchParams.get("source"), MAINTENANCE_SOURCES);
    const jobId = searchParams.get("jobId")?.trim() || undefined;
    const search = searchParams.get("q")?.trim() || undefined;
    const withSummary = searchParams.get("summary") === "1";

    // Scope the property set per role.
    let scopedPropertyIds: string[] | undefined;
    let clientVisibleOnly = false;

    if (role === Role.CLIENT) {
      clientVisibleOnly = true;
      const airbnbIds = await airbnbPropertyIdsForClient((await clientIdForUser(session.user.id)) ?? "");
      scopedPropertyIds = propertyId
        ? airbnbIds.filter((id) => id === propertyId)
        : airbnbIds;
      if (scopedPropertyIds.length === 0) {
        return NextResponse.json({ items: [], summary: withSummary ? null : undefined, viewer: viewerInfo(session) });
      }
    } else if (role === Role.CLEANER || role === Role.QA_INSPECTOR) {
      // Cleaners/QA only see items on Airbnb properties they are attached to.
      const attachedPropertyIds = await attachedAirbnbPropertyIds(session.user.id, role);
      scopedPropertyIds = propertyId
        ? attachedPropertyIds.filter((id) => id === propertyId)
        : attachedPropertyIds;
      if (scopedPropertyIds.length === 0) {
        return NextResponse.json({ items: [], summary: withSummary ? null : undefined, viewer: viewerInfo(session) });
      }
    } else if (role === Role.ADMIN || role === Role.OPS_MANAGER) {
      // Admin/OPS see everything; an explicit propertyId narrows.
      scopedPropertyIds = propertyId ? [propertyId] : undefined;
    } else {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const items = await listMaintenanceItems({
      propertyIds: scopedPropertyIds,
      status,
      priority,
      category,
      source,
      jobId,
      search,
      clientVisibleOnly,
    });

    // Attach resolved photo preview URLs for rendering.
    const itemsWithPhotos = await Promise.all(
      items.map(async (item) => ({
        ...item,
        photos: await resolvePhotoUrls(item.photoKeys),
      })),
    );

    const summary = withSummary
      ? await getMaintenanceSummary({ propertyIds: scopedPropertyIds, clientVisibleOnly })
      : undefined;

    return NextResponse.json({ items: itemsWithPhotos, summary, viewer: viewerInfo(session) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load items." }, { status: errStatus(err.message) });
  }
}

function viewerInfo(session: { user: { id: string; name?: string | null; role: Role } }) {
  return { id: session.user.id, name: session.user.name ?? null, role: session.user.role };
}

/** Airbnb property ids a cleaner/QA inspector is attached to. */
async function attachedAirbnbPropertyIds(userId: string, role: Role): Promise<string[]> {
  let propertyIds: string[] = [];
  if (role === Role.CLEANER) {
    const rows = await db.jobAssignment.findMany({
      where: { userId, removedAt: null, job: { jobType: "AIRBNB_TURNOVER" } },
      select: { job: { select: { propertyId: true } } },
    });
    propertyIds = rows.map((r) => r.job.propertyId);
  } else if (role === Role.QA_INSPECTOR) {
    const rows = await db.qaAssignment.findMany({
      where: {
        OR: [{ assignedToId: userId }, { pickedUpById: userId }],
        job: { jobType: "AIRBNB_TURNOVER" },
      },
      select: { job: { select: { propertyId: true } } },
    });
    propertyIds = rows.map((r) => r.job.propertyId);
  }
  const airbnb = await filterAirbnbPropertyIds(propertyIds);
  return Array.from(airbnb);
}
