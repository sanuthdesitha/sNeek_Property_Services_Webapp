import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId");

    const headers = [
      "name",
      "sku",
      "category",
      "location",
      "unit",
      "supplier",
      "isActive",
      "onHand",
      "parLevel",
      "reorderThreshold",
    ];

    let rows: string[] = [];
    if (propertyId) {
      const itemsWithStock = await db.inventoryItem.findMany({
        orderBy: [{ location: "asc" }, { category: "asc" }, { name: "asc" }],
        include: {
          propertyStocks: {
            where: { propertyId },
            select: {
              onHand: true,
              parLevel: true,
              reorderThreshold: true,
            },
            take: 1,
          },
        },
      });
      rows = itemsWithStock.map((item) => {
        const stock = item.propertyStocks?.[0];
        return [
          item.name,
          item.sku ?? "",
          item.category,
          item.location ?? "",
          item.unit,
          item.supplier ?? "",
          item.isActive ? "true" : "false",
          stock?.onHand ?? "",
          stock?.parLevel ?? "",
          stock?.reorderThreshold ?? "",
        ]
          .map(csvEscape)
          .join(",");
      });
    } else {
      const items = await db.inventoryItem.findMany({
        orderBy: [{ location: "asc" }, { category: "asc" }, { name: "asc" }],
      });
      rows = items.map((item) =>
        [
          item.name,
          item.sku ?? "",
          item.category,
          item.location ?? "",
          item.unit,
          item.supplier ?? "",
          item.isActive ? "true" : "false",
          "",
          "",
          "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = [headers.join(","), ...rows].join("\n");
    const filename = propertyId ? `inventory-${propertyId}.csv` : "inventory-items.csv";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
