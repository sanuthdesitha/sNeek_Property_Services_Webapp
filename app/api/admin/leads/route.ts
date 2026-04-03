import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const leads = await db.quoteLead.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } },
        quotes: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            validUntil: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ createdAt: "desc" }],
        },
      },
    });
    return NextResponse.json(leads);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
