/**
 * What the person looking at the Accounts hub may see and do, resolved on the
 * server from their live session. The screen hides any control whose endpoint
 * would refuse them; the endpoints still check for themselves.
 *
 * - ADMIN is decided from every role they hold (an admin acting in another hat
 *   is still an admin) and has full rights regardless of operations packs.
 * - OPS_MANAGER keeps exactly what the APIs allowed before: read the hub,
 *   write the office note and resend an invite, subject to their packs.
 * - An admin impersonating someone has the target's roles (requireSession
 *   replaces them), so the target's restrictions apply.
 */
import { Role } from "@prisma/client";
import { canActAs } from "@/lib/auth/roles";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import type { AccountListVisibility } from "./list/types";
import type { PersonCapabilities } from "./person-types";

export type AccountsViewer = {
  id: string;
  isAdmin: boolean;
  /** Office note and resend invite (the two writes OPS_MANAGER has). */
  canWriteNotes: boolean;
  /** Upload a staff document through the workforce document flow. */
  canUploadDocuments: boolean;
  /** Bulk "Message" through the staff message route (communications pack for OPS_MANAGER). */
  canMessageStaff?: boolean;
  /** People › Clients (list, panel, client page): ADMIN, or OPS_MANAGER with the clients pack. */
  canSeeClients?: boolean;
  /** People › Cleaners links to the workforce pages (compliance, coaching, recognition, roster). */
  canSeeWorkforce?: boolean;
  /** May open the People route (/v2/admin/accounts): ADMIN, or OPS_MANAGER with the accounts pack. */
  canOpenPeople?: boolean;
  visibility: AccountListVisibility;
};

export function personCapabilities(viewer: AccountsViewer): PersonCapabilities {
  return {
    isAdmin: viewer.isAdmin,
    canWriteNotes: viewer.canWriteNotes,
    canUploadDocuments: viewer.canUploadDocuments,
    canResendInvite: viewer.canWriteNotes,
    canManageLeave: viewer.canWriteNotes,
    canMessageStaff: viewer.canMessageStaff === true,
  };
}

type SessionUser ={ id: string; role: Role | string; heldRoles?: (Role | string)[] };

export async function resolveAccountsViewer(user: SessionUser): Promise<AccountsViewer> {
  const held = (user.heldRoles ?? [user.role]) as Role[];
  const isAdmin = canActAs(held, [Role.ADMIN]);
  const levels = isAdmin ? null : await getOpsAccess({ id: user.id, role: String(user.role), heldRoles: held });
  const allows = (feature: "accounts" | "quality" | "workforce" | "communications" | "clients", method: string) =>
    isAdmin || !levels || opsLevelAllows(levels[feature], method);
  return {
    id: user.id,
    isAdmin,
    canWriteNotes: allows("accounts", "PUT"),
    canUploadDocuments: allows("workforce", "POST"),
    canMessageStaff: allows("communications", "POST"),
    canSeeClients: allows("clients", "GET"),
    canSeeWorkforce: allows("workforce", "GET"),
    canOpenPeople: allows("accounts", "GET"),
    visibility: {
      // Unchanged rule: everyone admitted to the hub (ADMIN, OPS_MANAGER) saw
      // the rate on the account page.
      pay: true,
      quality: allows("quality", "GET"),
    },
  };
}
