import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
const key = "finance-cadence";
const schema = z.object({ semimonthlyClientUserIds: z.array(z.string().min(1)).max(1000) });
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to save cadence.";
  return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
}
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [row, clients] = await Promise.all([
      db.appSetting.findUnique({ where: { key } }),
      db.user.findMany({ where: { role: Role.CLIENT, isActive: true }, select: { id: true, name: true, invoicingCadence: true }, orderBy: { name: "asc" } }),
    ]);
    const parsed = schema.safeParse(row?.value ?? { semimonthlyClientUserIds: [] });
    return NextResponse.json({ clients, ...(parsed.success ? parsed.data : { semimonthlyClientUserIds: [] }) });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const ids = Array.from(new Set(body.semimonthlyClientUserIds));
    const users = await db.user.findMany({ where: { id: { in: ids }, role: Role.CLIENT, isActive: true }, select: { id: true, clientId: true } });
    if (users.length !== ids.length || users.some(user => !user.clientId)) {
      return NextResponse.json({ error: "Choose active client users linked to a client account." }, { status: 400 });
    }
    // One billing account per cadence entry; multiple logins must not generate twice.
    if (new Set(users.map(user => user.clientId)).size !== users.length) {
      return NextResponse.json({ error: "Choose only one login per client billing account." }, { status: 400 });
    }
    const value = { semimonthlyClientUserIds: ids };
    await db.$transaction(async tx => {
      const before = await tx.appSetting.findUnique({ where: { key } });
      await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await tx.auditLog.create({ data: { userId: actor.user.id, action: "INVOICE_CADENCE_UPDATED", entity: "AppSetting", entityId: key, before: before?.value ?? {}, after: value } });
    });
    return NextResponse.json(value);
  } catch (error) { return errorResponse(error); }
}
