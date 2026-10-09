import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getOpsPolicy, saveOpsPolicy } from "@/lib/rbac/ops-access";
import { opsPolicySchema } from "@/lib/rbac/ops-policy";
import { getApiErrorStatus } from "@/lib/api/http";

async function administrator() {
  const session = await requireRole(["ADMIN"]);
  if (session.impersonation || session.user.role !== "ADMIN")
    throw new Error("FORBIDDEN");
  return session;
}
export async function GET() {
  try {
    await administrator();
    const [policy, managers] = await Promise.all([
      getOpsPolicy(),
      db.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: "OPS_MANAGER" },
            { extraRoles: { some: { role: "OPS_MANAGER" } } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          extraRoles: { select: { role: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);
    return NextResponse.json(
      {
        policy,
        managers: managers.filter(
          (user) =>
            user.role !== "ADMIN" &&
            !user.extraRoles.some((role) => role.role === "ADMIN"),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load access settings.",
      },
      { status: getApiErrorStatus(error) },
    );
  }
}
export async function PUT(request: NextRequest) {
  try {
    const session = await administrator();
    const origin = request.headers.get("origin");
    if (
      origin &&
      origin !== new URL(process.env.NEXTAUTH_URL || request.url).origin
    )
      throw new Error("FORBIDDEN");
    const policy = opsPolicySchema.parse(await request.json());
    const saved = await saveOpsPolicy(session.user.id, policy);
    return NextResponse.json({ policy: saved });
  } catch (error) {
    const conflict =
      error instanceof Error && error.message === "OPS_POLICY_CONFLICT";
    return NextResponse.json(
      {
        error: conflict
          ? "These permissions changed elsewhere. Reload before saving."
          : error instanceof Error
            ? error.message
            : "Could not save permissions.",
      },
      { status: conflict ? 409 : getApiErrorStatus(error) },
    );
  }
}
