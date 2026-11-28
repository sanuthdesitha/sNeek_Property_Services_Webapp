import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { loadCategoryLabels } from "@/lib/quality/facts";
import { registerErrorResponse, requireRegisterViewer } from "@/lib/quality/register/http";

export const dynamic = "force-dynamic";

/** Choices for "Log an issue": active properties and cleaners, and the configured issue categories. */
export async function GET() {
  try {
    await requireRegisterViewer();
    const [properties, cleaners, labels] = await Promise.all([
      db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" }, take: 1000 }),
      db.user.findMany({ where: { isActive: true, ...holdsRoleWhere("CLEANER") }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 1000 }),
      loadCategoryLabels(),
    ]);
    return NextResponse.json({
      properties: properties.map((property) => ({ id: property.id, label: property.suburb ? `${property.name}, ${property.suburb}` : property.name })),
      cleaners: cleaners.map((user) => ({ id: user.id, label: user.name || user.email || "Unknown" })),
      categories: Array.from(labels, ([id, label]) => ({ id, label })),
    });
  } catch (error) {
    return registerErrorResponse(error, "Could not load the choices.");
  }
}
