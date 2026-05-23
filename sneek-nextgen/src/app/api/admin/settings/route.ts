import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await requireApiRole("ADMIN");
  if (session instanceof NextResponse) return session;

  const settings = await prisma.appSetting.findMany();
  const settingsMap: Record<string, unknown> = {};
  for (const setting of settings) {
    settingsMap[setting.key] = setting.value;
  }

  return apiSuccess(settingsMap);
}

export async function PATCH(req: NextRequest) {
  const session = await requireApiRole("ADMIN");
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const { key, value } = body;

  if (!key) {
    return apiError("key is required", 400);
  }

  const setting = await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  return apiSuccess(setting);
}
