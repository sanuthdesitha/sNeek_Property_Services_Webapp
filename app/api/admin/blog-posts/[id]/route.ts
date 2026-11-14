import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { blogRouteError } from "@/lib/public-site/blog-route-errors";

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
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const updated = await db.blogPost.update({
      where: { id: params.id },
      data: {
        ...body,
        coverImageUrl: body.coverImageUrl === undefined ? undefined : body.coverImageUrl || null,
        // A future time schedules the post: public reads hide it until then
        // (lib/public-site/blog-visibility). Publishing without a time means now;
        // a draft may keep a planned time (it is not public either way).
        publishedAt:
          body.publishedAt
            ? new Date(body.publishedAt)
            : body.isPublished === true
              ? new Date()
              : body.publishedAt === null
                ? null
                : undefined,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return blogRouteError(error, "The post was not saved.");
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.blogPost.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return blogRouteError(error, "The post was not deleted.");
  }
}
