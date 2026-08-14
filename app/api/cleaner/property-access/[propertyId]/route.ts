import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ACCESS_GUIDE_KINDS } from "@/lib/properties/access-guide";

export const runtime = "nodejs";

// Kinds come from lib/properties/access-guide so this route cannot drift from
// the admin route that writes the data (ACCESS-2 added BIN_CHUTE there).
const KINDS = new Set<string>(ACCESS_GUIDE_KINDS);

/** Re-validate the stored JSON into a safe, minimal shape for the cleaner UI. */
function sanitizeForCleaner(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: Array<{
    id: string;
    kind: string;
    label: string;
    instructions?: string;
    images: Array<{ url: string; caption?: string }>;
    level?: string;
    locationNote?: string;
    lat?: number;
    lng?: number;
    sequence?: number;
  }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const kind = typeof row.kind === "string" && KINDS.has(row.kind) ? row.kind : "OTHER";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const instructions = typeof row.instructions === "string" ? row.instructions.trim() : "";
    const images = Array.isArray(row.images)
      ? row.images
          .filter((img: any) => img && typeof img.url === "string" && img.url.trim())
          .map((img: any) => ({
            url: String(img.url),
            caption: typeof img.caption === "string" && img.caption.trim() ? img.caption.trim() : undefined,
          }))
      : [];
    // ACCESS-2 — where to go and which floor. A bin room is useless to a
    // cleaner without the level, which is the whole complaint.
    const level = typeof row.level === "string" && row.level.trim() ? row.level.trim() : undefined;
    const locationNote =
      typeof row.locationNote === "string" && row.locationNote.trim()
        ? row.locationNote.trim()
        : undefined;
    const lat = typeof row.lat === "number" && Number.isFinite(row.lat) ? row.lat : undefined;
    const lng = typeof row.lng === "number" && Number.isFinite(row.lng) ? row.lng : undefined;
    const sequence =
      typeof row.sequence === "number" && Number.isFinite(row.sequence) ? row.sequence : undefined;
    if (!id && !label && !instructions && images.length === 0 && !level && !locationNote) continue;
    out.push({
      id: id || `entry-${out.length}`,
      kind,
      label: label || "Access point",
      instructions: instructions || undefined,
      images,
      level,
      locationNote,
      lat,
      lng,
      sequence,
    });
  }
  return out;
}

/**
 * Cleaner-scoped read of a property's access guide.
 *
 * AUTH RULE: the caller must be a CLEANER who is (or was) assigned to at least
 * one job at this property (assignment not removed). This mirrors the per-job
 * briefing auth but at property scope, so the guide is available across every
 * job the cleaner works at that address. Returns `{ accessGuide: [] }` (200)
 * when authorized but no guide exists — the UI renders nothing.
 */
export async function GET(_req: Request, { params }: { params: { propertyId: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const assignment = await db.job.findFirst({
      where: {
        propertyId: params.propertyId,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not authorized for this property." }, { status: 403 });
    }

    const property = await db.property.findUnique({
      where: { id: params.propertyId },
      select: { id: true, accessGuide: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    return NextResponse.json({
      propertyId: property.id,
      accessGuide: sanitizeForCleaner(property.accessGuide),
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load access guide." }, { status });
  }
}
