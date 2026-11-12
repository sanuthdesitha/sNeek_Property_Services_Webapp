import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getSupplierById, listSupplierCatalog } from "@/lib/inventory/suppliers";
import { buildSupplierDirectory, type LaundryPartnerRecord, type SupplierDirectoryResponse } from "@/lib/suppliers/directory-types";

/**
 * Laundry partners are suppliers (owner, 2026-11-12: "Laundry partners is also
 * suppliers, so need to link them and show them in suppliers list").
 *
 * - The Suppliers list shows stock suppliers (AppSetting catalog) and laundry
 *   partners (LaundrySupplier) together; a partner linked to a stock supplier
 *   (`stockSupplierId`, unique) is one business and one row.
 * - LAUNDRY portal accounts belong to a partner through `User.laundrySupplierId`.
 *   That team is who "Ask laundry team" requests address
 *   (recipient scope LAUNDRY_TASK_SUPPLIER_TEAM).
 *
 * Nothing here changes a laundry run, a price or an invoice.
 */

export class PartnerLinkError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type PartnerLinkChange = {
  /** undefined = unchanged; null = unlink. */
  stockSupplierId?: string | null;
  /** undefined = unchanged; the complete team otherwise. */
  teamUserIds?: string[];
};

export async function loadSupplierDirectory(): Promise<SupplierDirectoryResponse> {
  const [stock, partners, runCounts, laundryUsers] = await Promise.all([
    listSupplierCatalog(),
    db.laundrySupplier.findMany({
      orderBy: { name: "asc" },
      include: { teamMembers: { where: { role: Role.LAUNDRY }, select: { id: true, name: true, email: true, isActive: true }, orderBy: { name: "asc" } } },
    }),
    db.laundryTask.groupBy({ by: ["supplierId"], where: { supplierId: { not: null } }, _count: { _all: true } }),
    db.user.findMany({ where: { role: Role.LAUNDRY }, select: { id: true, name: true, email: true, isActive: true, laundrySupplierId: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
  ]);
  const countBySupplier = new Map(runCounts.map((row) => [row.supplierId as string, row._count._all]));
  const laundry: LaundryPartnerRecord[] = partners.map((partner) => ({
    id: partner.id,
    name: partner.name,
    phone: partner.phone,
    email: partner.email,
    address: partner.address,
    pricePerKg: partner.pricePerKg,
    avgTurnaround: partner.avgTurnaround,
    reliabilityScore: partner.reliabilityScore,
    notes: partner.notes,
    isActive: partner.isActive,
    stockSupplierId: partner.stockSupplierId,
    team: partner.teamMembers,
    runCount: countBySupplier.get(partner.id) ?? 0,
  }));
  return { ...buildSupplierDirectory(stock, laundry), laundryUsers };
}

/**
 * Link a partner to a stock supplier and/or set its team, in one transaction,
 * audited with the actor. Refusals: the stock supplier does not exist (404),
 * is already linked to another partner (409), or a team member is not a
 * LAUNDRY portal account (400). Moving a person from another partner's team is
 * allowed and recorded.
 */
export async function applyPartnerLinks(actorId: string, supplierId: string, change: PartnerLinkChange, tx?: Prisma.TransactionClient): Promise<void> {
  if (change.stockSupplierId === undefined && change.teamUserIds === undefined) return;
  if (change.stockSupplierId) {
    const stock = await getSupplierById(change.stockSupplierId);
    if (!stock) throw new PartnerLinkError(404, "That stock supplier no longer exists.");
  }
  const run = async (client: Prisma.TransactionClient) => {
    const partner = await client.laundrySupplier.findUnique({ where: { id: supplierId }, select: { id: true, stockSupplierId: true } });
    if (!partner) throw new PartnerLinkError(404, "Laundry partner not found.");
    const before = { stockSupplierId: partner.stockSupplierId, teamUserIds: [] as string[] };
    const after: Record<string, unknown> = {};

    if (change.stockSupplierId !== undefined && change.stockSupplierId !== partner.stockSupplierId) {
      if (change.stockSupplierId) {
        const holder = await client.laundrySupplier.findFirst({ where: { stockSupplierId: change.stockSupplierId, id: { not: supplierId } }, select: { name: true } });
        if (holder) throw new PartnerLinkError(409, `That stock supplier is already linked to ${holder.name}.`);
      }
      await client.laundrySupplier.update({ where: { id: supplierId }, data: { stockSupplierId: change.stockSupplierId } });
      after.stockSupplierId = change.stockSupplierId;
    }

    if (change.teamUserIds !== undefined) {
      const ids = Array.from(new Set(change.teamUserIds));
      const current = await client.user.findMany({ where: { laundrySupplierId: supplierId }, select: { id: true } });
      before.teamUserIds = current.map((row) => row.id);
      if (ids.length) {
        const users = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true, laundrySupplierId: true } });
        const missing = ids.filter((id) => !users.some((user) => user.id === id));
        if (missing.length) throw new PartnerLinkError(400, "A team member account no longer exists.");
        if (users.some((user) => user.role !== Role.LAUNDRY)) throw new PartnerLinkError(400, "Only laundry portal accounts can be on a laundry partner's team.");
        after.movedFrom = users.filter((user) => user.laundrySupplierId && user.laundrySupplierId !== supplierId).map((user) => ({ userId: user.id, from: user.laundrySupplierId }));
        await client.user.updateMany({ where: { id: { in: ids } }, data: { laundrySupplierId: supplierId } });
      }
      await client.user.updateMany({ where: { laundrySupplierId: supplierId, id: { notIn: ids } }, data: { laundrySupplierId: null } });
      after.teamUserIds = ids;
    }

    if (Object.keys(after).length) {
      await client.auditLog.create({
        data: { userId: actorId, action: "LAUNDRY_PARTNER_LINKS_UPDATED", entity: "LaundrySupplier", entityId: supplierId, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
      });
    }
  };
  try {
    if (tx) await run(tx);
    else await db.$transaction(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PartnerLinkError(409, "That stock supplier is already linked to another laundry partner.");
    }
    throw error;
  }
}

/** A stock supplier is being deleted: unlink any partner (the partner itself stays). */
export async function unlinkStockSupplier(actorId: string, stockSupplierId: string): Promise<void> {
  const partner = await db.laundrySupplier.findFirst({ where: { stockSupplierId }, select: { id: true } });
  if (!partner) return;
  await applyPartnerLinks(actorId, partner.id, { stockSupplierId: null });
}
