import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  s3Key: z.string().optional(),
  mediaType: z.enum(["IMAGE", "VIDEO", "GIF"]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).optional().default([]),
  description: z.string().max(2000).optional(),
});

export async function GET() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const assets = await (db as any).marketingAsset.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ assets });
}

export async function POST(req: NextRequest) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.format() }, { status: 400 });
  }
  const asset = await (db as any).marketingAsset.create({
    data: {
      ...parsed.data,
      uploadedById: (session.user as any)?.id ?? null,
    },
  });
  return NextResponse.json({ asset }, { status: 201 });
}
