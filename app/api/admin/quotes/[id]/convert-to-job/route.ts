import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, QuoteStatus } from "@prisma/client";

const schema = z.object({
  propertyId: z.string().min(1),
  scheduledDate: z.string().datetime(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { propertyId, scheduledDate } = schema.parse(await req.json());

    const quote = await db.quote.findUnique({ where: { id: params.id } });
    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (quote.status === QuoteStatus.CONVERTED && quote.convertedJobId) {
      return NextResponse.json(
        { error: "Quote already converted", jobId: quote.convertedJobId },
        { status: 400 }
      );
    }

    const job = await db.job.create({
      data: {
        propertyId,
        jobType: quote.serviceType,
        scheduledDate: new Date(scheduledDate),
        notes: `Converted from quote #${params.id}`,
      },
    });

    await db.quote.update({
      where: { id: params.id },
      data: { status: QuoteStatus.CONVERTED, convertedJobId: job.id },
    });

    return NextResponse.json({ job });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
