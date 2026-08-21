import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { buildTagUrl } from "@/lib/nfc/tags";

/**
 * The NFC tags registered at one property.
 *
 * A tag can be created two ways, and both end up as the same row:
 *
 *   GENERATE  the normal path. We mint the token, the admin writes the
 *             resulting URL onto a blank tag — from this page on an Android
 *             phone, or with any NFC writer app on anything else.
 *   ADOPT     the admin taps a tag that already exists and we record its
 *             hardware serial. Useful for tags bought pre-programmed or
 *             already stuck to a wall.
 *
 * Either way a token is minted, because the token is what the check-in flow
 * resolves; the serial is only ever a second way to recognise the same tag.
 */

const createSchema = z.object({
  label: z.string().trim().min(1).max(120),
  /** Hardware serial, when the admin registered by scanning. */
  tagUid: z.string().trim().min(1).max(120).optional(),
});

/**
 * 24 random bytes, base64url — the same shape as an invitation token. Long
 * enough that guessing one is not a threat model, which matters because the
 * token IS the tag's identity and a guessed one would resolve to a real
 * property.
 */
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const tags = await db.propertyNfcTag.findMany({
      where: { propertyId: params.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });

    const baseUrl = resolveAppUrl("/", req);
    return NextResponse.json({
      tags: tags.map((tag) => ({
        id: tag.id,
        label: tag.label,
        tagUid: tag.tagUid,
        isActive: tag.isActive,
        lastUsedAt: tag.lastUsedAt,
        createdAt: tag.createdAt,
        // The value to write onto the tag, and the target of its QR fallback.
        url: buildTagUrl(baseUrl, tag.token),
      })),
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load the tags." }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    if (body.tagUid) {
      // A serial belongs to exactly one property. Silently re-pointing it would
      // send every future tap at the old door to the new address.
      const clash = await db.propertyNfcTag.findUnique({
        where: { tagUid: body.tagUid },
        select: { id: true, propertyId: true },
      });
      if (clash) {
        return NextResponse.json(
          {
            error:
              clash.propertyId === params.id
                ? "That tag is already registered to this property."
                : "That tag is registered to a different property. Remove it there first.",
          },
          { status: 409 }
        );
      }
    }

    const tag = await db.propertyNfcTag.create({
      data: {
        propertyId: params.id,
        label: body.label,
        token: mintToken(),
        tagUid: body.tagUid ?? null,
        createdById: session.user.id,
      },
    });

    const baseUrl = resolveAppUrl("/", req);
    return NextResponse.json(
      {
        tag: {
          id: tag.id,
          label: tag.label,
          tagUid: tag.tagUid,
          isActive: tag.isActive,
          lastUsedAt: tag.lastUsedAt,
          createdAt: tag.createdAt,
          url: buildTagUrl(baseUrl, tag.token),
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not create the tag." }, { status });
  }
}
