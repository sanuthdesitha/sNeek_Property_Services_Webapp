import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.propertyOnboardingSurvey.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (existing.status !== "DRAFT")
      return NextResponse.json({ error: "Only draft surveys can be submitted." }, { status: 409 });

    // Minimal completeness gate so reviewers don't receive empty surveys. Full
    // create-time validation runs again at approval (validateSurveyForApproval).
    const problems: string[] = [];
    const hasClient = existing.isNewClient
      ? !!(existing.clientData as any)?.name
      : !!existing.existingClientId;
    if (!hasClient) problems.push("Link an existing client or create a new one.");
    if (!existing.propertyAddress?.trim()) problems.push("Property address is required.");
    if (problems.length > 0) {
      return NextResponse.json({ error: problems.join(" ") }, { status: 422 });
    }

    const survey = await db.propertyOnboardingSurvey.update({
      where: { id: params.id },
      data: { status: "PENDING_REVIEW", submittedAt: new Date() },
    });

    return NextResponse.json(survey);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
