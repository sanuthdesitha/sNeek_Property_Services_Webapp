import "server-only";
import { createHash } from "node:crypto";

export function cleanerDraftIdentity(
  session: { user: { id: string }; impersonation?: { actorId: string } | null },
  jobId: string
): string {
  return createHash("sha256").update(JSON.stringify([
    "cleaner-draft-identity-v1",
    session.impersonation?.actorId ?? session.user.id,
    session.user.id,
    jobId,
  ])).digest("hex");
}
