import "server-only";
import { ClientInvoiceStatus, type Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";

export async function getPortalInvoiceSummary(id: string, portal: "admin" | "client") {
  const session = await requireSession();
  let scope: Prisma.ClientInvoiceWhereInput = {};
  if (portal === "admin") {
    if (session.user.role !== Role.ADMIN && session.user.role !== Role.OPS_MANAGER) throw new Error("FORBIDDEN");
  } else {
    if (session.user.role !== Role.CLIENT && session.user.role !== Role.VA) throw new Error("FORBIDDEN");
    const settings = await getAppSettings();
    if (settings === DEFAULT_SETTINGS && await db.appSetting.findUnique({ where: { key: "app" }, select: { key: true } })) {
      throw new Error("Invoice visibility is unavailable.");
    }
    const ctx = await requireClientPortal({ settings, permission: "invoicesView" });
    if (!isClientModuleEnabled(ctx.visibility, "finance")) throw new Error("FORBIDDEN");
    scope = {
      clientId: ctx.clientId,
      status: { notIn: [ClientInvoiceStatus.DRAFT, ClientInvoiceStatus.VOID] },
      ...(ctx.propertyIds ? { lines: { some: {}, every: { job: { property: propertyScopeWhere(ctx) } } } } : {}),
    };
  }
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) return null;
  return db.clientInvoice.findFirst({ where: { AND: [{ id }, scope] }, select: {
    id: true, invoiceNumber: true, status: true, totalAmount: true, createdAt: true,
    sentAt: true, periodStart: true, periodEnd: true,
  } });
}
