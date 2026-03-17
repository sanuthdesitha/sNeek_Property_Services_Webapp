import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  normalizeInventoryLocation,
  inferInventoryLocationFromCategory,
} from "@/lib/inventory/locations";

const schema = z.object({
  csv: z.string().min(1),
  propertyId: z.string().cuid().optional(),
});

type ImportRowError = {
  line: number;
  message: string;
  row: Record<string, string>;
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function toNum(value: string | undefined, fallback: number) {
  if (!value || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { csv, propertyId } = schema.parse(await req.json());

    const lines = csv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV must include a header and at least one data row." }, { status: 400 });
    }

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idx = {
      name: header.indexOf("name"),
      sku: header.indexOf("sku"),
      category: header.indexOf("category"),
      unit: header.indexOf("unit"),
      supplier: header.indexOf("supplier"),
      location: header.indexOf("location"),
      isActive: header.indexOf("isactive"),
      onHand: header.indexOf("onhand"),
      parLevel: header.indexOf("parlevel"),
      reorderThreshold: header.indexOf("reorderthreshold"),
    };

    if (idx.name < 0) {
      return NextResponse.json({ error: "CSV must include 'name' column." }, { status: 400 });
    }

    if (propertyId) {
      const propertyExists = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
      if (!propertyExists) {
        return NextResponse.json({ error: "Selected property was not found." }, { status: 400 });
      }
    }

    let created = 0;
    let updated = 0;
    let stockUpdated = 0;
    const errors: ImportRowError[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const rowData = header.reduce<Record<string, string>>((acc, key, index) => {
        acc[key] = row[index] ?? "";
        return acc;
      }, {});
      const name = row[idx.name]?.trim();
      if (!name) {
        errors.push({ line: i + 1, message: "Missing required 'name' value.", row: rowData });
        continue;
      }

      try {
        const sku = idx.sku >= 0 ? row[idx.sku]?.trim() : "";
        const category = idx.category >= 0 && row[idx.category] ? row[idx.category].trim() : "Custom";
        const location =
          idx.location >= 0 && row[idx.location]
            ? normalizeInventoryLocation(row[idx.location])
            : inferInventoryLocationFromCategory(category);
        const unit = idx.unit >= 0 && row[idx.unit] ? row[idx.unit].trim() : "unit";
        const supplier = idx.supplier >= 0 ? row[idx.supplier]?.trim() : "";
        const isActive =
          idx.isActive >= 0 && row[idx.isActive]
            ? !["false", "0", "no"].includes(row[idx.isActive].toLowerCase())
            : true;

        let item = null;
        if (sku) {
          item = await db.inventoryItem.findUnique({ where: { sku } });
        }
        if (!item) {
          item = await db.inventoryItem.findFirst({
            where: { name, category, location },
          });
        }

        if (!item) {
          item = await db.inventoryItem.create({
            data: {
              name,
              sku: sku || undefined,
              category,
              location,
              unit,
              supplier: supplier || undefined,
              isActive,
            },
          });
          created++;
        } else {
          item = await db.inventoryItem.update({
            where: { id: item.id },
            data: {
              name,
              category,
              location,
              unit,
              supplier: supplier || undefined,
              isActive,
            },
          });
          updated++;
        }

        if (propertyId) {
          const onHand = toNum(idx.onHand >= 0 ? row[idx.onHand] : undefined, 0);
          const parLevel = toNum(idx.parLevel >= 0 ? row[idx.parLevel] : undefined, 0);
          const reorderThreshold = toNum(idx.reorderThreshold >= 0 ? row[idx.reorderThreshold] : undefined, 0);

          await db.propertyStock.upsert({
            where: {
              propertyId_itemId: {
                propertyId,
                itemId: item.id,
              },
            },
            create: {
              propertyId,
              itemId: item.id,
              onHand,
              parLevel,
              reorderThreshold,
            },
            update: {
              onHand,
              parLevel,
              reorderThreshold,
            },
          });
          stockUpdated++;
        }
      } catch (rowErr: any) {
        errors.push({
          line: i + 1,
          message: rowErr?.message ?? "Row import failed.",
          row: rowData,
        });
      }
    }

    return NextResponse.json({ ok: true, created, updated, stockUpdated, errors });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
