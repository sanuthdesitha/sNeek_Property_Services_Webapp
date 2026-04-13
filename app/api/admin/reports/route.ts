import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const pageParam = Number(searchParams.get("page") ?? "1");
    const limitParam = Number(searchParams.get("limit") ?? "25");
    const q = searchParams.get("q")?.trim();
    const propertyId = searchParams.get("propertyId")?.trim();
    const visibility = searchParams.get("visibility")?.trim();
    const sort = searchParams.get("sort")?.trim() || "newest";

    const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(10, Math.floor(limitParam))) : 25;

    const where: any = {};
    if (propertyId && propertyId !== "all") {
      where.job = { propertyId };
    }
    if (visibility === "client-visible") {
      where.clientVisible = true;
    } else if (visibility === "client-hidden") {
      where.clientVisible = false;
    }

    if (q) {
      where.OR = [
        { job: { property: { name: { contains: q, mode: "insensitive" } } } },
        { job: { property: { suburb: { contains: q, mode: "insensitive" } } } },
        { job: { property: { client: { name: { contains: q, mode: "insensitive" } } } } },
        { job: { jobNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const orderBy =
      sort === "oldest"
        ? [{ createdAt: "asc" as const }]
        : sort === "service-date"
          ? [{ job: { scheduledDate: "desc" as const } }, { createdAt: "desc" as const }]
          : [{ createdAt: "desc" as const }];

    const [reports, totalCount, properties] = await Promise.all([
      db.report.findMany({
        where,
        include: {
          job: {
            select: {
              id: true,
              jobNumber: true,
              scheduledDate: true,
              jobType: true,
              status: true,
              property: { select: { id: true, name: true, suburb: true, client: { select: { name: true } } } },
            },
          },
          visibilityUpdatedBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.report.count({ where }),
      db.property.findMany({
        where: { isActive: true },
        select: { id: true, name: true, suburb: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);

    return NextResponse.json({
      reports,
      properties,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        hasMore: page * limit < totalCount,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
