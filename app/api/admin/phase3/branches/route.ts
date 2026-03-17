import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createBranch, listBranches } from "@/lib/phase3/branches";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(32).optional(),
  isActive: z.boolean().optional(),
  suburbs: z.array(z.string().trim().min(1).max(80)).optional(),
  propertyIds: z.array(z.string().trim().min(1)).optional(),
  userIds: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const branches = await listBranches();
    return NextResponse.json(branches);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createBranch(body);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BRANCH_CREATE",
        entity: "Branch",
        entityId: created.id,
        after: created as any,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Create failed." }, { status });
  }
}

