/**
 * The editor's DRAFT panel (Wave D): clients for Bill to, the client's terms
 * and this invoice's own terms for Due, the period as calendar days, and the
 * real count of finished jobs of this client that are on no live invoice.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { finishedUnbilledWhere } from "./client-invoice-add-jobs";
import { organisationDefaultTermsDays } from "./invoice-terms";
import { effectivePaymentTermsDays } from "./invoice-due";
import type { EditorDraftPanel } from "./client-invoice-editor-types";

type DraftInvoice = {
  clientId: string;
  paymentTermsDays: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  client: { paymentTermsDays: number | null };
};

function dayIn(value: Date | null, timezone: string): string | null {
  return value ? formatInTimeZone(value, timezone, "yyyy-MM-dd") : null;
}

export async function loadDraftPanel(invoice: DraftInvoice, options: { timezone: string; editable: boolean }): Promise<EditorDraftPanel> {
  const [clients, organisationDefaultDays, unbilledJobs] = await Promise.all([
    options.editable
      ? db.client.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }] })
      : Promise.resolve([]),
    organisationDefaultTermsDays(),
    db.job
      .count({ where: finishedUnbilledWhere(invoice.clientId) })
      .catch(() => null),
  ]);
  return {
    clients: clients.map((client) => ({ id: client.id, name: client.name })),
    clientTermsDays: effectivePaymentTermsDays({ clientTermsDays: invoice.client.paymentTermsDays, organisationDefaultDays }),
    termsOverride: invoice.paymentTermsDays,
    periodStartDay: dayIn(invoice.periodStart, options.timezone),
    periodEndDay: dayIn(invoice.periodEnd, options.timezone),
    unbilledJobs,
  };
}
