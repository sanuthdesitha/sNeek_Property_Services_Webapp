import { NextRequest, NextResponse } from "next/server";
import { MessageCategory, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { audienceCategoryFilter, parseTemplateAudience } from "@/lib/messages/template-audience";

/**
 * Switched-on message templates for the inbox "Insert template" and the
 * composer. `?audience=client|cleaner|laundry` narrows the list to the
 * categories meant for that person (lib/messages/template-audience.ts);
 * without it every switched-on template is listed, as before.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const audience = parseTemplateAudience(req.nextUrl.searchParams.get("audience"));
  const category = audienceCategoryFilter(audience) as { in: MessageCategory[] } | { notIn: MessageCategory[] } | undefined;
  const templates = await db.messageTemplate.findMany({
    where: { isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      channel: true,
      subject: true,
      body: true,
      variables: true,
    },
  });

  return NextResponse.json({ templates, audience });
}
