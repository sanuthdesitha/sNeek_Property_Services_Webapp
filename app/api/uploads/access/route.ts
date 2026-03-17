import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/s3";

function isValidKey(value: string) {
  return value.length > 0 && value.length <= 1000 && !value.includes("..");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const key = (searchParams.get("key") ?? "").trim();
    const jobId = (searchParams.get("jobId") ?? "").trim();

    if (!isValidKey(key)) {
      return NextResponse.json({ error: "Invalid key." }, { status: 400 });
    }

    const role = session.user.role as Role;
    if (role !== Role.ADMIN && role !== Role.OPS_MANAGER && role !== Role.CLEANER) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (role === Role.CLEANER) {
      if (!jobId) {
        return NextResponse.json({ error: "jobId is required for cleaner preview access." }, { status: 400 });
      }
      const assignment = await db.jobAssignment.findFirst({
        where: {
          jobId,
          userId: session.user.id,
          removedAt: null,
        },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Not assigned to this job." }, { status: 403 });
      }
      if (!key.startsWith(`jobs/${jobId}/`)) {
        return NextResponse.json({ error: "Preview key does not match job scope." }, { status: 403 });
      }
    }

    const url = await getPresignedDownloadUrl(key, 600);
    return NextResponse.json({ url });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message ?? "Could not generate preview URL." }, { status });
  }
}
