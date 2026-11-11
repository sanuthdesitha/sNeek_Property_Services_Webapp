import "server-only";
/**
 * Who may open and who may change a client invoice, using the same rules
 * middleware applies: ADMIN always (independently of operations packs); an
 * OPS_MANAGER only with the finance feature, and "manage" on it to PATCH. The
 * page uses this to show a view-only editor instead of controls that would 403.
 */
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath, type OpsLevels } from "@/lib/rbac/ops-catalog";

type AccessUser = { id: string; role: string; heldRoles?: string[] };
export type InvoiceEditorAccess = { canView: boolean; canManage: boolean };

function accessFrom(levels: OpsLevels | null, invoiceId: string): InvoiceEditorAccess {
  if (!levels) return { canView: true, canManage: true };
  const id = encodeURIComponent(invoiceId);
  return {
    canView: canUseOpsPath(levels, `/v2/admin/finance/invoices/${id}`),
    canManage: canUseOpsPath(levels, `/api/admin/invoices/${id}`, "PATCH"),
  };
}

export async function invoiceEditorAccess(user: AccessUser, invoiceId: string): Promise<InvoiceEditorAccess> {
  return accessFrom(await getOpsAccess(user), invoiceId);
}

export async function canManageInvoices(user: AccessUser, invoiceId: string): Promise<boolean> {
  return (await invoiceEditorAccess(user, invoiceId)).canManage;
}
