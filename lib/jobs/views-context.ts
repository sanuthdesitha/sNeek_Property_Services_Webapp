import "server-only";
import { createHash } from "node:crypto";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export async function requireJobsViewsContext() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const impersonation = session.impersonation;
  const ownerId = session.user.id;
  const actorId = impersonation?.actorId ?? ownerId;
  // A context fingerprint, not an authorization token. Ownership always comes from session.
  const context = createHash("sha256").update(JSON.stringify([
    "jobs-views-v1", actorId, ownerId, impersonation?.mode ?? null, impersonation?.startedAt ?? null,
  ])).digest("hex");
  return { ownerId, context, readOnly: impersonation?.mode === "READ_ONLY", canPublishTeamDefault: session.user.role === Role.ADMIN && !impersonation };
}
