import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Unified recipient search across clients + users (cleaners/admins).
 * Returns shape: { recipients: Recipient[] }
 *
 * Query: ?q=alice&type=client|user|all
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const type = searchParams.get("type") ?? "all";

  if (q.length === 0) {
    return NextResponse.json({ recipients: [] });
  }

  const recipients: Array<{
    id: string;
    kind: "client" | "user";
    name: string;
    email: string | null;
    phone: string | null;
    role?: string;
  }> = [];

  if (type === "client" || type === "all") {
    const clients = await db.client.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
        isActive: true,
      },
      take: 15,
      select: { id: true, name: true, email: true, phone: true },
    });
    for (const c of clients) {
      recipients.push({
        id: c.id,
        kind: "client",
        name: c.name,
        email: c.email,
        phone: c.phone,
      });
    }
  }

  if (type === "user" || type === "all") {
    const users = await db.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
        isActive: true,
      },
      take: 15,
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    for (const u of users) {
      recipients.push({
        id: u.id,
        kind: "user",
        name: u.name ?? u.email,
        email: u.email,
        phone: u.phone,
        role: u.role,
      });
    }
  }

  return NextResponse.json({ recipients });
}
