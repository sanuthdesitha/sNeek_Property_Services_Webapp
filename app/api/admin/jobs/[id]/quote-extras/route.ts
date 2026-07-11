import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  parseJobInternalNotes,
  serializeJobInternalNotes,
  type JobAdditional,
} from "@/lib/jobs/meta";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { wrapEmailHtml } from "@/lib/email-templates";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";

/**
 * Post-conversion job extras ("quote extras anytime"):
 *   GET    → the extras currently on the job (internalNotes meta) + pricing.
 *   POST   → { add: [{ id?, label, price, instructions? }], removeLabels?, note? }
 *   DELETE → { removeLabels: string[] }
 *
 * Every change appends/removes Additionals in the SAME meta shape the cleaner
 * form reads, bumps the job's fixedPrice (seeded from the source quote's total
 * when null), updates invoiceNote, writes an AuditLog with before/after price,
 * and emails the client a branded "Your booking has been updated" note that
 * ALWAYS states the new total — these are confirmed changes to their job.
 */

const addSchema = z.object({
  id: z.string().trim().optional(),
  label: z.string().trim().min(1),
  price: z.number().min(0),
  instructions: z.string().trim().optional(),
});

const postSchema = z
  .object({
    add: z.array(addSchema).optional(),
    removeLabels: z.array(z.string().trim().min(1)).optional(),
    note: z.string().trim().optional(),
  })
  .refine((b) => (b.add?.length ?? 0) > 0 || (b.removeLabels?.length ?? 0) > 0, {
    message: "Provide extras to add or labels to remove.",
  });

const deleteSchema = z.object({
  removeLabels: z.array(z.string().trim().min(1)).min(1),
});

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

async function loadJobWithQuote(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      scheduledDate: true,
      fixedPrice: true,
      invoiceNote: true,
      internalNotes: true,
      property: {
        select: {
          id: true,
          name: true,
          client: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!job) return { job: null, quote: null };
  const quote = await db.quote.findFirst({
    where: { convertedJobId: job.id },
    select: {
      id: true,
      totalAmount: true,
      client: { select: { id: true, name: true, email: true } },
      lead: { select: { name: true, email: true } },
    },
  });
  return { job, quote };
}

function extrasView(meta: ReturnType<typeof parseJobInternalNotes>) {
  const prices = meta.additionalPrices ?? {};
  return meta.additionals.map((extra) => ({
    id: extra.id,
    label: extra.label,
    instructions: extra.instructions ?? null,
    // Extras that converted with the quote have their price inside the quote
    // total → no separate price entry (null = "included in quoted total").
    price: prices[extra.id] ?? null,
  }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { job, quote } = await loadJobWithQuote(params.id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const meta = parseJobInternalNotes(job.internalNotes);
    return NextResponse.json({
      extras: extrasView(meta),
      fixedPrice: job.fixedPrice,
      quoteTotal: quote?.totalAmount ?? null,
      effectivePrice: job.fixedPrice ?? quote?.totalAmount ?? null,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

async function applyExtrasChange(
  jobId: string,
  input: { add?: z.infer<typeof addSchema>[]; removeLabels?: string[]; note?: string },
  actorUserId: string
) {
  const { job, quote } = await loadJobWithQuote(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settings = await getAppSettings();
  const meta = parseJobInternalNotes(job.internalNotes);
  const additionals: JobAdditional[] = [...meta.additionals];
  const prices: Record<string, number> = { ...(meta.additionalPrices ?? {}) };

  // Price baseline: agreed fixed price, else the quoted total (the job was
  // converted from a quote whose total the client accepted).
  const beforePrice = job.fixedPrice ?? quote?.totalAmount ?? null;

  // ── Removals (by label, case-insensitive) ─────────────────────────────────
  const removed: Array<{ id: string; label: string; grossPrice: number }> = [];
  for (const rawLabel of input.removeLabels ?? []) {
    const wanted = rawLabel.trim().toLowerCase();
    const idx = additionals.findIndex((a) => a.label.trim().toLowerCase() === wanted);
    if (idx === -1) {
      return NextResponse.json(
        { error: `No extra named "${rawLabel}" on this job.` },
        { status: 400 }
      );
    }
    const [extra] = additionals.splice(idx, 1);
    const exGst = prices[extra.id] ?? 0; // quoted-in extras reverse $0 — their price lives in the quote total
    delete prices[extra.id];
    removed.push({
      id: extra.id,
      label: extra.label,
      grossPrice: calculateGstBreakdown(exGst, settings.pricing).totalAmount,
    });
  }

  // ── Additions ─────────────────────────────────────────────────────────────
  const usedIds = new Set([...additionals.map((a) => a.id), ...removed.map((r) => r.id)]);
  const added: Array<{ id: string; label: string; exGstPrice: number; grossPrice: number }> = [];
  for (const item of input.add ?? []) {
    let id = item.id && item.id.trim() ? item.id.trim() : "";
    if (!id || usedIds.has(id)) {
      const base = id || item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "extra";
      let n = 1;
      id = base;
      while (usedIds.has(id)) id = `${base}-${++n}`;
    }
    usedIds.add(id);
    const exGst = Number(item.price.toFixed(2));
    additionals.push({
      id,
      label: item.label,
      instructions: item.instructions || undefined,
    });
    prices[id] = exGst;
    added.push({
      id,
      label: item.label,
      exGstPrice: exGst,
      grossPrice: calculateGstBreakdown(exGst, settings.pricing).totalAmount,
    });
  }

  // ── New total ─────────────────────────────────────────────────────────────
  const delta =
    added.reduce((sum, a) => sum + a.grossPrice, 0) -
    removed.reduce((sum, r) => sum + r.grossPrice, 0);
  const afterPrice = Number(Math.max(0, (beforePrice ?? 0) + delta).toFixed(2));

  // ── Invoice note lines ────────────────────────────────────────────────────
  const noteLines: string[] = [];
  for (const a of added) noteLines.push(`+ Extra: ${a.label} (${money(a.grossPrice)})`);
  for (const r of removed) noteLines.push(`− Removed extra: ${r.label} (−${money(r.grossPrice)})`);
  const invoiceNote = [job.invoiceNote?.trim(), noteLines.join("\n")]
    .filter(Boolean)
    .join("\n");

  await db.job.update({
    where: { id: job.id },
    data: {
      fixedPrice: afterPrice,
      invoiceNote: invoiceNote || null,
      internalNotes:
        serializeJobInternalNotes({
          ...meta,
          additionals,
          additionalPrices: Object.keys(prices).length > 0 ? prices : undefined,
        }) ?? null,
    },
  });

  await db.auditLog.create({
    data: {
      userId: actorUserId,
      jobId: job.id,
      action: removed.length > 0 && added.length === 0 ? "JOB_EXTRAS_REMOVED" : "JOB_EXTRAS_ADDED",
      entity: "Job",
      entityId: job.id,
      before: { fixedPrice: beforePrice, extras: meta.additionals.map((a) => a.label) } as any,
      after: {
        fixedPrice: afterPrice,
        extras: additionals.map((a) => a.label),
        added: added.map((a) => ({ label: a.label, price: a.exGstPrice })),
        removed: removed.map((r) => r.label),
        note: input.note || undefined,
      } as any,
    },
  });

  // ── Email the client — every update, always with the new total ────────────
  const client = job.property?.client ?? quote?.client ?? null;
  const profileRecipients = await resolveClientDeliveryRecipients({
    clientId: client?.id,
    fallbackEmail: client?.email ?? null,
    kind: "invoice",
  });
  const recipients = profileRecipients.length
    ? profileRecipients
    : quote?.lead?.email
      ? [quote.lead.email]
      : [];

  let emailed = false;
  if (recipients.length > 0) {
    const clientName = client?.name ?? quote?.lead?.name ?? "there";
    const dateLabel = new Date(job.scheduledDate).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const addedRows = added
      .map(
        (a) =>
          `<li style="margin:4px 0;">${escapeHtml(a.label)} — <strong>${money(a.grossPrice)}</strong>${
            a.exGstPrice !== a.grossPrice ? " inc GST" : ""
          }</li>`
      )
      .join("");
    const removedRows = removed
      .map((r) => `<li style="margin:4px 0;">${escapeHtml(r.label)}${r.grossPrice > 0 ? ` — −${money(r.grossPrice)}` : ""}</li>`)
      .join("");
    const innerHtml = `
      <h2 class="h2" style="margin:0 0 14px;font-size:24px;font-weight:600;">Your booking has been updated</h2>
      <p style="margin:0 0 14px;">Hi ${escapeHtml(clientName)},</p>
      <p style="margin:0 0 14px;">
        We've updated your booking${job.property?.name ? ` at <strong>${escapeHtml(job.property.name)}</strong>` : ""}
        scheduled for <strong>${escapeHtml(dateLabel)}</strong> (job ${escapeHtml(job.jobNumber)}).
      </p>
      ${addedRows ? `<p style="margin:0 0 6px;font-weight:600;">Added to your service:</p><ul style="margin:0 0 14px;padding-left:20px;">${addedRows}</ul>` : ""}
      ${removedRows ? `<p style="margin:0 0 6px;font-weight:600;">Removed from your service:</p><ul style="margin:0 0 14px;padding-left:20px;">${removedRows}</ul>` : ""}
      ${input.note ? `<p style="margin:0 0 14px;">${escapeHtml(input.note)}</p>` : ""}
      <p style="margin:0 0 6px;font-size:16px;">
        Updated total for this booking: <strong>${money(afterPrice)}</strong>
      </p>
      <p style="margin:14px 0 0;color:#6b6b66;font-size:13px;">
        If anything here doesn't look right, just reply or contact us and we'll sort it out.
      </p>
    `;
    const html = wrapEmailHtml(
      { companyName: settings.companyName, logoUrl: settings.logoUrl },
      innerHtml
    );
    const subject = `Your booking has been updated — ${settings.companyName}`;
    const sent = await sendEmailDetailed({ to: recipients, subject, html });
    emailed = sent.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject,
        body: `Job ${job.jobNumber} extras update sent to ${recipients.join(", ")} (new total ${money(afterPrice)})`,
        status: sent.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent.ok ? new Date() : undefined,
        errorMsg: sent.ok ? undefined : sent.error ?? "Email provider returned failure.",
      },
    });
  }

  const nextMeta = parseJobInternalNotes(
    serializeJobInternalNotes({
      ...meta,
      additionals,
      additionalPrices: Object.keys(prices).length > 0 ? prices : undefined,
    }) ?? null
  );
  return NextResponse.json({
    ok: true,
    extras: extrasView(nextMeta),
    fixedPrice: afterPrice,
    beforePrice,
    priceDelta: Number(delta.toFixed(2)),
    added: added.map((a) => a.label),
    removed: removed.map((r) => r.label),
    emailed,
    recipients,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = postSchema.parse(await req.json());
    return await applyExtrasChange(params.id, body, session.user.id);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = deleteSchema.parse(await req.json());
    return await applyExtrasChange(params.id, { removeLabels: body.removeLabels }, session.user.id);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
