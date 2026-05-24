import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { logger } from "@/lib/logger";

/**
 * Generate an invoice for a user covering all uninvoiced completed jobs / shopping
 * settlements for their associated Client since their lastInvoiceGeneratedAt
 * (or all-time if null), then email the client a notification.
 *
 * For CLIENT-role users only. Cleaner payroll runs are handled separately by the
 * existing PayrollRun flow.
 *
 * The underlying generator (`generateClientInvoice`) determines billable jobs by
 * comparing job rates to existing ClientInvoiceLine.jobId entries, so it
 * inherently avoids double-billing. lastInvoiceGeneratedAt is updated as a
 * cadence checkpoint.
 */
export async function generateInvoiceForUser(
  userId: string
): Promise<{ invoiceId: string | null; reason: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      clientId: true,
      lastInvoiceGeneratedAt: true,
    },
  });
  if (!user) return { invoiceId: null, reason: "User not found" };

  // Auto-invoicing supports CLIENT users only for now.
  // Cleaner payroll cycles continue to use the existing PayrollRun flow.
  if (user.role !== "CLIENT") {
    return {
      invoiceId: null,
      reason: "Auto-invoicing only supported for CLIENT role currently",
    };
  }

  // Resolve the client record — prefer the explicit User.clientId link, fall
  // back to email match.
  let client: { id: string } | null = null;
  if (user.clientId) {
    client = await db.client.findUnique({
      where: { id: user.clientId },
      select: { id: true },
    });
  }
  if (!client && user.email) {
    client = await db.client.findFirst({
      where: { email: user.email },
      select: { id: true },
    });
  }
  if (!client) return { invoiceId: null, reason: "No matching Client record" };

  const sinceDate = user.lastInvoiceGeneratedAt ?? null;
  const now = new Date();

  let invoice: { id: string; invoiceNumber: string; totalAmount: number } | null = null;
  try {
    invoice = (await generateClientInvoice({
      clientId: client.id,
      periodStart: sinceDate,
      periodEnd: now,
    })) as any;
  } catch (err: any) {
    // generateClientInvoice throws on "no billable jobs" or "missing rates" —
    // treat both as no-op; advance checkpoint only when there was simply
    // nothing to bill.
    const message: string = err?.message ?? String(err);
    if (/No billable completed jobs/i.test(message)) {
      await (db as any).user.update({
        where: { id: userId },
        data: { lastInvoiceGeneratedAt: now },
      });
      return { invoiceId: null, reason: "No new jobs to invoice" };
    }
    logger.warn({ err, userId, clientId: client.id }, "[auto-invoice] generation failed");
    return { invoiceId: null, reason: message };
  }

  if (!invoice) return { invoiceId: null, reason: "Invoice creation failed" };

  // Email the client a notification that an invoice has been generated.
  if (user.email) {
    await sendEmailDetailed({
      to: user.email,
      subject: `Your invoice ${invoice.invoiceNumber} from sNeek Property Services`,
      html: `<p>Hi ${user.name ?? "there"},</p>
<p>Your latest invoice <strong>${invoice.invoiceNumber}</strong> is ready, total <strong>$${invoice.totalAmount.toFixed(2)}</strong>.</p>
<p>You can review it in your client portal under Billing.</p>
<p>Thanks,<br/>sNeek Property Services</p>`,
      transactional: true,
    }).catch((e) => {
      logger.warn({ err: e, userId, invoiceId: invoice?.id }, "[auto-invoice] email send failed");
      return null;
    });
  }

  await (db as any).user.update({
    where: { id: userId },
    data: { lastInvoiceGeneratedAt: now },
  });

  return { invoiceId: invoice.id, reason: "Generated" };
}
