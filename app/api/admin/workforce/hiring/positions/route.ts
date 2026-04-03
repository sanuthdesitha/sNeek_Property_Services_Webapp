import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { createHiringPosition, listHiringPositions } from "@/lib/workforce/service";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const positions = await listHiringPositions();
    return NextResponse.json(positions);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load positions." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const position = await createHiringPosition({
      title: String(body.title ?? ""),
      slug: body.slug ? String(body.slug) : null,
      description: body.description ? String(body.description) : null,
      department: body.department ? String(body.department) : null,
      location: body.location ? String(body.location) : null,
      employmentType: body.employmentType ? String(body.employmentType) : null,
      isPublished: body.isPublished !== false,
      createdById: session.user.id,
    });
    return NextResponse.json(position, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create position." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
