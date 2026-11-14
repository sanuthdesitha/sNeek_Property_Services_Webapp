import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { tourFailure, tourJson } from "@/lib/tutorials/http";

export const dynamic = "force-dynamic";

/** Find a person for the People tab (name or email, active accounts, ten at most). */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const query = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (query.length < 2) return tourJson({ people: [] });
    const people = await db.user.findMany({
      where: { isActive: true, OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { name: "asc" },
      take: 10,
    });
    return tourJson({ people: people.map((person) => ({ ...person, createdAt: person.createdAt.toISOString() })) });
  } catch (error) {
    return tourFailure(error);
  }
}
