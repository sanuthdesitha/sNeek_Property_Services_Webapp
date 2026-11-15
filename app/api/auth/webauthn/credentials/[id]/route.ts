import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Remove one of the current user's enrolled biometric devices.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    if (session.impersonation) {
      return NextResponse.json({ error: "Stop testing as someone else to change your own passkeys.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
    }
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "Missing device id." }, { status: 400 });
    }

    // Scope deletion to the owning user so one user can't remove another's device.
    const result = await db.webAuthnCredential.deleteMany({
      where: { id, userId: session.user.id },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Device not found." }, { status: 404 });
    }
    await db.auditLog.create({ data: { userId: session.user.id, action: "OWN_PASSKEY_REMOVED", entity: "WebAuthnCredential", entityId: id } });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err?.message ?? "Could not remove device." },
      { status }
    );
  }
}
