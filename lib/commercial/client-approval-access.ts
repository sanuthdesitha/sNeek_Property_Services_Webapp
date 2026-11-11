import { db } from "@/lib/db";
import {
  listClientApprovals,
  type ClientApprovalRecord,
  type ClientApprovalStatus,
} from "@/lib/commercial/client-approvals";

/**
 * Who may see and answer a client approval request.
 *
 * One rule, used by the approvals list, the respond and counter actions, and
 * the navigation badge. They used to carry separate copies, and the badge
 * counted something else entirely (the client's own job requests waiting on the
 * office), so a real request raised no badge and a badge could lead to an
 * empty page.
 */
export type ApprovalViewer = {
  userId: string;
  /** Lower-cased. Null when the account has no email or it is not verified. */
  email: string | null;
  clientIds: ReadonlySet<string>;
};

export async function resolveApprovalViewer(userId: string): Promise<ApprovalViewer | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { clientId: true, email: true, emailVerified: true },
  });
  if (!user) return null;
  // An address only identifies someone once the office has confirmed it. A
  // person can change their own email, so an unconfirmed address must never
  // open another client's requests. The account's own client link and being
  // named by user id are unaffected.
  const email = user.emailVerified ? user.email?.trim().toLowerCase() || null : null;
  // A person may be the contact address of more than one client record.
  const emailMatched = email
    ? await db.client.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
        take: 20,
      })
    : [];
  const clientIds = new Set<string>(
    [user.clientId, ...emailMatched.map((row) => row.id)].filter(
      (value): value is string => Boolean(value),
    ),
  );
  return { userId, email, clientIds };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function canAccessClientApproval(
  approval: Pick<ClientApprovalRecord, "clientId" | "metadata">,
  viewer: ApprovalViewer,
): boolean {
  if (viewer.clientIds.has(approval.clientId)) return true;
  const metadata =
    approval.metadata && typeof approval.metadata === "object"
      ? (approval.metadata as Record<string, unknown>)
      : null;
  if (stringList(metadata?.recipientUserIds).includes(viewer.userId)) return true;
  if (!viewer.email) return false;
  return stringList(metadata?.recipientEmails)
    .map((item) => item.toLowerCase())
    .includes(viewer.email);
}

/** `strict` refuses malformed stored records instead of reading them as none. */
export async function listApprovalsForViewer(
  viewer: ApprovalViewer,
  options?: { status?: ClientApprovalStatus; strict?: boolean },
): Promise<ClientApprovalRecord[]> {
  const rows = await listClientApprovals({ status: options?.status, strict: options?.strict });
  return rows.filter((row) => canAccessClientApproval(row, viewer));
}

/** Requests still waiting on this person. Throws rather than report a false zero. */
export async function countPendingApprovalsForUser(userId: string): Promise<number> {
  const viewer = await resolveApprovalViewer(userId);
  if (!viewer) return 0;
  return (await listApprovalsForViewer(viewer, { status: "PENDING", strict: true })).length;
}
