import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  slug: z.string().trim().min(2).max(160),
  title: z.string().trim().min(2).max(200),
  excerpt: z.string().trim().min(2).max(500),
  body: z.string().trim().min(2).max(50000),
  coverImageUrl: z.string().trim().max(2000).optional().nullable(),
  galleryImageUrls: z.array(z.string().trim().min(1).max(2000)).max(24).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(12).optional().default([]),
  isPublished: z.boolean().optional().default(false),
  publishedAt: z.string().datetime().optional().nullable(),
  authorName: z.string().trim().min(2).max(120).optional(),
});

export async function GET() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const rows = await db.blogPost.findMany({ orderBy: [{ updatedAt: "desc" }] });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const body = schema.parse(await req.json());
  const created = await db.blogPost.create({
    data: {
      slug: body.slug,
      title: body.title,
      excerpt: body.excerpt,
      body: body.body,
      coverImageUrl: body.coverImageUrl || null,
      galleryImageUrls: body.galleryImageUrls,
      tags: body.tags,
      isPublished: body.isPublished,
      publishedAt: body.isPublished ? (body.publishedAt ? new Date(body.publishedAt) : new Date()) : null,
      authorName: body.authorName || "sNeek Team",
    },
  });
  return NextResponse.json(created, { status: 201 });
}
