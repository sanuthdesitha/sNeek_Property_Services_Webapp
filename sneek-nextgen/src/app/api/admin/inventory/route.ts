import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  const items = await prisma.inventoryItem.findMany({
    where: {
      ...(category && { category }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
        ],
      }),
    },
    include: {
      propertyStocks: {
        include: {
          property: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return apiSuccess({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN");

  const body = await req.json();
  const { name, sku, category, location, unit, supplier } = body;

  if (!name || !category) {
    return apiError("name and category are required", 400);
  }

  const item = await prisma.inventoryItem.create({
    data: {
      name,
      sku: sku ?? null,
      category,
      location: location ?? "CLEANERS_CUPBOARD",
      unit: unit ?? "unit",
      supplier: supplier ?? null,
    },
  });

  return apiSuccess(item);
}
