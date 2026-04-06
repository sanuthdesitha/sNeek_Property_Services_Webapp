import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  slug: z.string().trim().min(2).max(160).optional(),
  title: z.string().trim().min(2).max(200).optional(),
  excerpt: z.string().trim().min(2).max(500).optional(),
  body: z.string().trim().min(2).max(50000).optional(),
  coverImageUrl: z.string().trim().max(2000).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().min(1).max(2000)).max(24).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  isPublished: z.boolean().optional(),
  publishedAt: z.string().datetime().optional().nullable(),
  authorName: z.string().trim().min(2).max(120).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const body = schema.parse(await req.json());
  const updated = await db.blogPost.update({
    where: { id: params.id },
    data: {
      ...body,
      coverImageUrl: body.coverImageUrl === undefined ? undefined : body.coverImageUrl || null,
      publishedAt:
        body.isPublished === true
          ? body.publishedAt
            ? new Date(body.publishedAt)
            : new Date()
          : body.isPublished === false
            ? null
            : body.publishedAt === undefined
              ? undefined
              : body.publishedAt
                ? new Date(body.publishedAt)
                : null,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await db.blogPost.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
