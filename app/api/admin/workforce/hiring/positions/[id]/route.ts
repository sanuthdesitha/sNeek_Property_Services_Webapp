import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updateHiringPosition } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const position = await updateHiringPosition({
      positionId: params.id,
      title: String(body.title ?? ""),
      slug: body.slug ? String(body.slug) : null,
      description: body.description ? String(body.description) : null,
      department: body.department ? String(body.department) : null,
      location: body.location ? String(body.location) : null,
      employmentType: body.employmentType ? String(body.employmentType) : null,
      isPublished: body.isPublished !== false,
    });
    return NextResponse.json(position);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update position." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
