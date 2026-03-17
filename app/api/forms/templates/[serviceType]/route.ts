import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { JobType } from "@prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: { serviceType: string } }
) {
  try {
    await requireSession();
    const template = await db.formTemplate.findFirst({
      where: {
        serviceType: params.serviceType as JobType,
        isActive: true,
      },
      orderBy: { version: "desc" },
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
