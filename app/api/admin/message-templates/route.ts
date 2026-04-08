import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(["POST_JOB", "REVIEW_REQUEST", "DISCOUNT", "NEXT_CLEAN", "MANUAL"]),
  jobType: z.string().optional().nullable(),
  channel: z.enum(["EMAIL", "SMS"]),
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1),
  isActive: z.boolean().optional().default(true),
});

export async function GET(_req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const templates = await db.messageTemplate.findMany({
      orderBy: [{ triggerType: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(templates);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());
    const template = await db.messageTemplate.create({ data: body });
    return NextResponse.json(template, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
