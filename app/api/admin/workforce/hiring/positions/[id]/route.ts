import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updateHiringPosition } from "@/lib/workforce/service";
import { isHireAccountKind } from "@/lib/accounts/create-account-rules";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    // "Hires become": an explicit account role, or null for "not chosen". Absent = unchanged.
    let hireAccountRole: Role | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "hireAccountRole")) {
      if (body.hireAccountRole === null || body.hireAccountRole === "") hireAccountRole = null;
      else if (isHireAccountKind(body.hireAccountRole)) hireAccountRole = body.hireAccountRole as Role;
      else return NextResponse.json({ error: "Hires become must be Cleaner, Laundry, QA inspector, Maintenance or Ops manager accounts." }, { status: 400 });
    }
    const position = await updateHiringPosition({
      positionId: params.id,
      title: String(body.title ?? ""),
      slug: body.slug ? String(body.slug) : null,
      description: body.description ? String(body.description) : null,
      department: body.department ? String(body.department) : null,
      location: body.location ? String(body.location) : null,
      employmentType: body.employmentType ? String(body.employmentType) : null,
      isPublished: body.isPublished !== false,
      requireKnowledgeTest: body.requireKnowledgeTest !== false,
      passThreshold: Number.isFinite(Number(body.passThreshold)) ? Number(body.passThreshold) : null,
      heroImageUrl: typeof body.heroImageUrl === "string" ? body.heroImageUrl : undefined,
      hireAccountRole,
    });
    return NextResponse.json(position);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update position." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
