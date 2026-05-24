import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  channel: z.enum(["FACEBOOK", "INSTAGRAM", "YOUTUBE", "TIKTOK"]),
  caption: z.string().min(1).max(10000),
  scheduledFor: z.string().datetime().optional().nullable(),
  assetIds: z.array(z.string()).optional().default([]),
});

export async function GET() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const posts = await (db as any).socialPost.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      assets: { include: { asset: true }, orderBy: { order: "asc" } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
    take: 200,
  });
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.format() }, { status: 400 });
  }
  const { channel, caption, scheduledFor, assetIds } = parsed.data;
  const post = await (db as any).socialPost.create({
    data: {
      channel,
      caption,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      status: scheduledFor ? "SCHEDULED" : "DRAFT",
      createdById: (session.user as any)?.id ?? null,
      assets: {
        create: assetIds.map((assetId, order) => ({ assetId, order })),
      },
    },
    include: { assets: { include: { asset: true } } },
  });
  return NextResponse.json({ post }, { status: 201 });
}
