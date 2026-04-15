import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const date = searchParams.get("date");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    where.OR = [
      { pickupDate: { gte: startOfDay, lte: endOfDay } },
      { dropoffDate: { gte: startOfDay, lte: endOfDay } },
    ];
  }

  const tasks = await prisma.laundryTask.findMany({
    where,
    include: {
      property: { select: { name: true, address: true } },
      supplier: true,
      confirmations: true,
    },
    orderBy: { pickupDate: "asc" },
  });

  return apiSuccess({ tasks, total: tasks.length });
}
