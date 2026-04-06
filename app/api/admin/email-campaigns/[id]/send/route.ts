import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { dispatchEmailCampaignById } from "@/lib/marketing/email-campaigns";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await dispatchEmailCampaignById(params.id);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not dispatch campaign." }, { status });
  }
}
