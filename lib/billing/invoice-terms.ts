/**
 * Server side of the payment-terms rule (`invoice-due.ts`): reads the live
 * terms for a client and snapshots them on an invoice when it is first issued.
 */
import type { Prisma } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { effectivePaymentTermsDays, paymentTermsDaysFrom } from "./invoice-due";

/** Statuses at which an invoice is an issued document whose terms are frozen. */
export const TERMS_SNAPSHOT_STATUSES: ReadonlySet<string> = new Set(["SENT", "PART_PAID", "PAID", "VOID"]);

export async function organisationDefaultTermsDays(): Promise<number> {
  const settings = await getAppSettings();
  return paymentTermsDaysFrom(settings.invoicing?.defaultPaymentTermsDays);
}

/** The live terms for a client (its own, else the organisation default). */
export async function liveTermsDaysForClient(
  database: Pick<Prisma.TransactionClient, "client">,
  clientId: string,
): Promise<number> {
  const [client, organisationDefaultDays] = await Promise.all([
    database.client.findUnique({ where: { id: clientId }, select: { paymentTermsDays: true } }),
    organisationDefaultTermsDays(),
  ]);
  return effectivePaymentTermsDays({ clientTermsDays: client?.paymentTermsDays ?? null, organisationDefaultDays });
}

/**
 * The `paymentTermsDays` value to write when an invoice moves to `nextStatus`:
 * the live terms when it is being issued for the first time, otherwise
 * undefined (leave the column alone; an existing snapshot never changes).
 */
export async function termsSnapshotFor(
  database: Pick<Prisma.TransactionClient, "client">,
  invoice: { clientId: string; paymentTermsDays: number | null },
  nextStatus: string | null | undefined,
): Promise<number | undefined> {
  if (invoice.paymentTermsDays !== null) return undefined;
  if (!nextStatus || !TERMS_SNAPSHOT_STATUSES.has(nextStatus)) return undefined;
  return liveTermsDaysForClient(database, invoice.clientId);
}
