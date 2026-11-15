import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { generateLabelCode } from "@/lib/inventory/label-codes";

export const runtime = "nodejs";

/**
 * The barcodes we print, listed and minted.
 *
 * A label belongs to an ITEM and is optionally pinned to a PROPERTY. Pinning is
 * the difference between "Bleach" and "the Bleach in the Bondi cupboard", and
 * it matters because the same bottle sits in twelve properties: a pinned label
 * tells the scan where the stock is without the cleaner needing the right
 * property selected on screen.
 *
 * Generating in bulk is the normal case — an admin setting up a property wants
 * a label for everything it stocks, in one go, ready for a printed sheet. Doing
 * that one at a time is the sort of chore that means it never gets done.
 */

/** The list returns at most this many labels, newest first, and says when it was cut. */
const LABEL_LIST_LIMIT = 1000;
/** Fresh codes for the whole batch are tried this many times before giving up. */
const MAKE_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

const createSchema = z.object({
  /** One label per item id. */
  itemIds: z.array(z.string().trim().min(1)).min(1).max(500),
  /** Pin every generated label to this property. Omit for general labels. */
  propertyId: z.string().trim().min(1).optional(),
  /** Units one scan of this label represents. */
  packSize: z.number().positive().max(10_000).optional(),
  label: z.string().trim().max(120).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId")?.trim();
    const itemId = searchParams.get("itemId")?.trim();

    const labels = await db.itemBarcode.findMany({
      where: {
        kind: "LABEL",
        ...(itemId ? { itemId } : {}),
        // An explicit "general" filter must mean propertyId IS NULL, not "no
        // filter" — otherwise asking for general labels returns every pinned
        // one too and the admin prints the wrong sheet.
        ...(propertyId ? { propertyId: propertyId === "GENERAL" ? null : propertyId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: LABEL_LIST_LIMIT + 1,
      select: {
        id: true,
        code: true,
        label: true,
        packSize: true,
        isActive: true,
        createdAt: true,
        item: { select: { id: true, name: true, unit: true, category: true } },
        property: { select: { id: true, name: true, suburb: true } },
      },
    });

    // Said, not hidden: a list cut at the limit must not read as "every label".
    return NextResponse.json({ labels: labels.slice(0, LABEL_LIST_LIMIT), truncated: labels.length > LABEL_LIST_LIMIT });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load the labels." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const items = await db.inventoryItem.findMany({
      where: { id: { in: body.itemIds } },
      select: { id: true, name: true },
    });
    if (items.length === 0) {
      return NextResponse.json({ error: "No matching items." }, { status: 404 });
    }

    if (body.propertyId) {
      const property = await db.property.findUnique({
        where: { id: body.propertyId },
        select: { id: true },
      });
      if (!property) {
        return NextResponse.json({ error: "Property not found." }, { status: 404 });
      }
    }

    // Existing labels are left alone. Re-generating would orphan every tag
    // already stuck to a shelf: the printed one would stop resolving, and
    // nobody would find out until a cleaner scanned it and got nothing.
    const existing = await db.itemBarcode.findMany({
      where: {
        kind: "LABEL",
        itemId: { in: items.map((i) => i.id) },
        propertyId: body.propertyId ?? null,
        isActive: true,
      },
      select: { itemId: true },
    });
    const alreadyLabelled = new Set(existing.map((row) => row.itemId));
    const toCreate = items.filter((item) => !alreadyLabelled.has(item.id));

    // All or nothing (board "Shelf labels": "nothing is half made"): the whole
    // batch is one transaction. A code collision (forty random bits make it
    // very unlikely, not impossible) rolls the batch back and it is tried again
    // with fresh codes; before 2026-11-17 a label whose five tries failed was
    // silently left out while the rest were made.
    let created: Array<{
      id: string;
      code: string;
      packSize: number;
      createdAt: Date;
      item: { id: string; name: string; unit: string | null };
      property: { id: string; name: string; suburb: string | null } | null;
    }> = [];
    for (let attempt = 1; attempt <= MAKE_ATTEMPTS; attempt += 1) {
      try {
        created = await db.$transaction(async (tx) => {
          const rows: typeof created = [];
          for (const item of toCreate) {
            rows.push(await tx.itemBarcode.create({
              data: {
                itemId: item.id,
                code: generateLabelCode(),
                kind: "LABEL",
                propertyId: body.propertyId ?? null,
                label: body.label ?? null,
                packSize: body.packSize ?? 1,
                symbology: "LABEL",
                createdById: session.user.id,
              },
              select: {
                id: true,
                code: true,
                packSize: true,
                createdAt: true,
                item: { select: { id: true, name: true, unit: true } },
                property: { select: { id: true, name: true, suburb: true } },
              },
            }));
          }
          return rows;
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAKE_ATTEMPTS) throw error;
      }
    }

    return NextResponse.json(
      {
        created,
        skipped: alreadyLabelled.size,
        message:
          alreadyLabelled.size > 0
            ? `${alreadyLabelled.size} item${
                alreadyLabelled.size === 1 ? " already has" : "s already have"
              } a label here — existing labels were left alone so printed tags keep working.`
            : undefined,
      },
      { status: 201 }
    );
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: "The labels were not made." }, { status });
  }
}
