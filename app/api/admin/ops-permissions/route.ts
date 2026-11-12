import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { loadAccessScreen } from "@/lib/rbac/access-directory";
import { isAdministrator } from "@/lib/rbac/access-evaluator";
import { sessionSubject } from "@/lib/rbac/can";
import { DelegatedActionDenied, loadAccessSubject, requireDelegatedAction } from "@/lib/rbac/delegated-admin";
import { DELEGATED_REFUSAL_TEXT, delegatedPolicyRefusal } from "@/lib/rbac/delegated-edit";
import type { AccessSubject } from "@/lib/rbac/access-evaluator";
import { getOpsGrants, getOpsPolicy, saveOpsPolicy } from "@/lib/rbac/ops-access";
import { GRANT_CAPABILITY_KEYS } from "@/lib/rbac/capabilities";
import { opsPolicySchema } from "@/lib/rbac/ops-policy";
import { verifySensitiveAction } from "@/lib/security/admin-verification";

/**
 * Settings > Access and permissions.
 *
 * Who: an ADMIN, or a person an administrator granted "Edit access and
 * permissions" (owner decision 2026-11-12). Never while testing as someone.
 * Both run the live session/role guard (requireRole re-reads the account,
 * its roles and the request path's pack, owner routes included) and then the
 * delegated-action check. Saving needs the editor's own PIN or password, the
 * revision they loaded, and is audited by `saveOpsPolicy`.
 */
async function editor(): Promise<{ session: Session; isAdmin: boolean }> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const actor = await requireDelegatedAction(session, "access.edit_permissions");
  return { session, isAdmin: actor.role === "ADMIN" };
}

const saveSchema = z.object({
  policy: opsPolicySchema,
  security: z.object({ pin: z.string().max(32).optional(), password: z.string().max(500).optional(), newPin: z.string().max(32).optional() }),
});

function failure(error: unknown, fallback: string) {
  if (error instanceof DelegatedActionDenied) return NextResponse.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : fallback;
  if (message === "INVALID_SECURITY_VERIFICATION" || message === "PIN_OR_PASSWORD_REQUIRED") {
    return NextResponse.json({ error: message === "PIN_OR_PASSWORD_REQUIRED" ? "Enter your PIN or password." : "That PIN or password is not right.", code: message }, { status: 423 });
  }
  if (message === "OPS_POLICY_SELF_CHANGE") return NextResponse.json({ error: DELEGATED_REFUSAL_TEXT.SELF, code: message }, { status: 403 });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the access settings." }, { status: 400 });
  return NextResponse.json({ error: message || fallback }, { status: getApiErrorStatus(error) });
}

export async function GET() {
  try {
    const { session, isAdmin } = await editor();
    const grants = isAdmin ? GRANT_CAPABILITY_KEYS : await getOpsGrants(sessionSubject(session) as { id: string; role: string; heldRoles: string[] });
    const data = await loadAccessScreen({ id: session.user.id, isAdmin, grants });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error, "Could not load access settings.");
  }
}

async function subjectsFor(ids: string[]): Promise<Record<string, AccessSubject>> {
  const entries = await Promise.all(ids.map(async (id) => [id, await loadAccessSubject(id)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, AccessSubject] => entry[1] !== null));
}

export async function PUT(request: NextRequest) {
  try {
    const { session, isAdmin } = await editor();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(process.env.NEXTAUTH_URL || request.url).origin) throw new Error("FORBIDDEN");
    const { policy, security } = saveSchema.parse(await request.json());
    const current = await getOpsPolicy();
    if (current.revision !== policy.revision) {
      // Show both versions: the client keeps its draft and reads the newer one.
      return NextResponse.json({ error: "Someone else saved access changes first. Compare before saving again.", code: "OPS_POLICY_CONFLICT", current }, { status: 409 });
    }
    if (!isAdmin) {
      const actor = sessionSubject(session);
      const changed = Array.from(new Set([...Object.keys(current.assignments), ...Object.keys(policy.assignments)]))
        .filter((id) => JSON.stringify(current.assignments[id] ?? null) !== JSON.stringify(policy.assignments[id] ?? null));
      const refusal = delegatedPolicyRefusal(current, policy, actor, await subjectsFor(changed));
      if (refusal) return NextResponse.json({ error: DELEGATED_REFUSAL_TEXT[refusal], code: refusal }, { status: 403 });
    } else if (!isAdministrator(sessionSubject(session))) {
      throw new Error("FORBIDDEN");
    }
    await verifySensitiveAction(session.user.id, security);
    const saved = await saveOpsPolicy(session.user.id, policy, {
      impersonatedBy: session.impersonation?.actorId ?? null,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    });
    return NextResponse.json({ policy: saved });
  } catch (error) {
    if (error instanceof Error && error.message === "OPS_POLICY_CONFLICT") {
      return NextResponse.json({ error: "Someone else saved access changes first. Compare before saving again.", code: "OPS_POLICY_CONFLICT", current: await getOpsPolicy() }, { status: 409 });
    }
    return failure(error, "Could not save permissions.");
  }
}
