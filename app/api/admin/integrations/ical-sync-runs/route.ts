import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { syncPropertyIcal } from "@/lib/ical/sync";
import { Role } from "@prisma/client";

function normalizeString(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const { searchParams } = new URL(req.url);
    const propertyId = normalizeString(searchParams.get("propertyId"));
    const status = normalizeString(searchParams.get("status"));
    const mode = normalizeString(searchParams.get("mode"));
    const q = normalizeString(searchParams.get("q"));

    const where: any = {};
    if (propertyId && propertyId !== "all") where.propertyId = propertyId;
    if (status && status !== "all") where.status = status;
    if (mode && mode !== "all") where.mode = mode;
    if (q) {
      where.OR = [
        { property: { name: { contains: q, mode: "insensitive" } } },
        { property: { suburb: { contains: q, mode: "insensitive" } } },
        { triggeredBy: { name: { contains: q, mode: "insensitive" } } },
        { triggeredBy: { email: { contains: q, mode: "insensitive" } } },
        { error: { contains: q, mode: "insensitive" } },
      ];
    }

    const runLimit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 200);

    const [runs, properties, totals] = await Promise.all([
      db.icalSyncRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: runLimit,
        include: {
          property: {
            select: {
              id: true,
              name: true,
              suburb: true,
              integration: {
                select: {
                  id: true,
                  isEnabled: true,
                  icalUrl: true,
                  syncStatus: true,
                  lastSyncAt: true,
                },
              },
            },
          },
          integration: {
            select: {
              id: true,
              isEnabled: true,
              syncStatus: true,
              lastSyncAt: true,
            },
          },
          triggeredBy: { select: { id: true, name: true, email: true } },
          revertedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      db.property.findMany({
        where: { isActive: true },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          suburb: true,
          integration: {
            select: {
              id: true,
              isEnabled: true,
              icalUrl: true,
              syncStatus: true,
              lastSyncAt: true,
            },
          },
        },
      }),
      db.icalSyncRun.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
    ]);

    const summary = {
      totalRuns: runs.length,
      totalProperties: properties.length,
      syncableProperties: properties.filter((property) => property.integration?.isEnabled && property.integration?.icalUrl).length,
      statusCounts: totals.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
    };

    return NextResponse.json({ runs, properties, summary });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load iCal sync runs." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as { propertyIds?: string[] };
    const propertyIds = Array.isArray(body.propertyIds)
      ? Array.from(new Set(body.propertyIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)))
      : [];

    if (propertyIds.length === 0) {
      return NextResponse.json({ error: "Select at least one property to re-sync." }, { status: 400 });
    }

    const properties = await db.property.findMany({
      where: { id: { in: propertyIds }, isActive: true },
      select: {
        id: true,
        name: true,
        suburb: true,
        integration: {
          select: {
            id: true,
            isEnabled: true,
            icalUrl: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const results: Array<{
      propertyId: string;
      propertyName: string;
      suburb: string;
      ok: boolean;
      runId?: string;
      summary?: unknown;
      error?: string;
    }> = [];

    for (const property of properties) {
      if (!property.integration?.id || !property.integration.isEnabled || !property.integration.icalUrl) {
        results.push({
          propertyId: property.id,
          propertyName: property.name,
          suburb: property.suburb,
          ok: false,
          error: "iCal sync is disabled or URL is missing for this property.",
        });
        continue;
      }

      try {
        const result = await syncPropertyIcal(property.integration.id, {
          triggeredById: session.user.id,
          mode: "MANUAL",
        });
        results.push({
          propertyId: property.id,
          propertyName: property.name,
          suburb: property.suburb,
          ok: true,
          runId: result.runId,
          summary: result.summary,
        });
      } catch (err: any) {
        results.push({
          propertyId: property.id,
          propertyName: property.name,
          suburb: property.suburb,
          ok: false,
          error: err.message ?? "Sync failed.",
        });
      }
    }

    return NextResponse.json({
      results,
      requested: propertyIds.length,
      succeeded: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not re-sync properties." }, { status });
  }
}
