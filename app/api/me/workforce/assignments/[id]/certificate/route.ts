import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { renderLearningCertificatePdf } from "@/lib/workforce/service";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);
    const pdf = await renderLearningCertificatePdf(params.id, session.user.id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="learning-certificate-${params.id}.pdf"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not generate certificate." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
