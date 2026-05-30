import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { computeProfileCompleteness } from "@/lib/profile/completeness";

// Returns the current user's profile-completeness status. Only field LABELS are
// returned for anything missing — never the stored values (e.g. bank numbers).
export async function GET() {
  try {
    const session = await requireSession();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        abn: true,
        bankBsb: true,
        bankAccountNumber: true,
        bankAccountName: true,
        role: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const result = computeProfileCompleteness(user, user.role);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
