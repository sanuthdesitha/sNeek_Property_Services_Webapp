import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { generateAbaFile } from "@/lib/payroll/aba";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // ?confirm=1 acknowledges a regeneration of an already-generated file.
    const allowRegenerate = new URL(req.url).searchParams.get("confirm") === "1";
    const { content, filename } = await generateAbaFile(params.id, {
      allowRegenerate,
      actorUserId: session.user.id,
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    const message: string = err?.message ?? "Could not generate ABA file.";
    // Already-generated guard → 409 so the UI can prompt for confirmation.
    if (message.startsWith("ABA_ALREADY_GENERATED")) {
      return NextResponse.json(
        { error: message.replace("ABA_ALREADY_GENERATED: ", ""), code: "ABA_ALREADY_GENERATED" },
        { status: 409 }
      );
    }
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
