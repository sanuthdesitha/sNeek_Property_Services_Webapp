import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const KINDS = new Set([
  "LOCKBOX",
  "KEYS",
  "ENTRY",
  "ALARM",
  "PARKING",
  "BIN_ROOM",
  "SUPPLIES_CUPBOARD",
  "WIFI",
  "OTHER",
]);

/** Re-validate the stored JSON into a safe, minimal shape for the cleaner UI. */
function sanitizeForCleaner(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: Array<{
    id: string;
    kind: string;
    label: string;
    instructions?: string;
    images: Array<{ url: string; caption?: string }>;
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
    if (!id && !label && !instructions && images.length === 0) continue;
    out.push({
      id: id || `entry-${out.length}`,
      kind,
      label: label || "Access point",
      instructions: instructions || undefined,
      images,
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
