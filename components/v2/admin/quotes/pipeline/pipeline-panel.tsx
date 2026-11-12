"use client";

/**
 * The pipeline's side panel (?open=quote:<id> | lead:<id>).
 * Quote: lines, GST and total (read from GET /api/admin/quotes/[id]), the
 * margin check, the existing activity timeline, Send / Edit / PDF.
 * Lead: contact, estimate, status, and the lead actions.
 */
import * as React from "react";
import Link from "next/link";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import QuoteTimeline from "@/components/v2/admin/quotes/quote-timeline";
import { formatCurrency } from "@/lib/utils";
import type { PipelineRow } from "@/lib/quotes/pipeline-types";
import { MarginPill, StatusPill, prettify } from "./pipeline-format";

type QuoteLine = { label?: string; qty?: number; total?: number };
type QuoteDetail = { lineItems?: QuoteLine[]; subtotal?: number; gstAmount?: number; totalAmount?: number; frequency?: string | null; validUntil?: string | null };

type PanelProps = {
  row: PipelineRow;
  onClose: () => void;
  onSend: () => void;
  onCounter: () => void;
  onLeadStatus: (status: string) => void;
  onConvertLead: () => void;
  busy: boolean;
};

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUOTED", "CONVERTED", "LOST"];

function QuoteBody({ row, onSend }: Pick<PanelProps, "row" | "onSend">) {
  const [detail, setDetail] = React.useState<QuoteDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/quotes/${row.id}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (QuoteDetail & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!res.ok || !body) setError(body?.error ?? "Could not load the quote.");
        else setDetail(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load the quote.");
      });
    return () => controller.abort();
  }, [row.id]);

  const lines = Array.isArray(detail?.lineItems) ? detail!.lineItems! : [];
  return (
    <>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {!detail && !error ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading the quote…</p> : null}
      {detail ? (
        <table className="w-full text-[0.8125rem]">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-[hsl(var(--e-border))]">
                <td className="py-1.5 pr-2">{line.label ?? "Line"}{line.qty && line.qty !== 1 ? ` × ${line.qty}` : ""}</td>
                <td className="e-tnum py-1.5 text-right">{formatCurrency(Number(line.total ?? 0))}</td>
              </tr>
            ))}
            <tr><td className="py-1.5 text-[hsl(var(--e-muted-foreground))]">GST</td><td className="e-tnum py-1.5 text-right text-[hsl(var(--e-muted-foreground))]">{formatCurrency(Number(detail.gstAmount ?? 0))}</td></tr>
            <tr><td className="py-1.5 font-[600]">Total{detail.frequency && detail.frequency !== "one_off" ? ` per ${detail.frequency.replace(/ly$/, "")}` : ""}</td><td className="e-tnum py-1.5 text-right font-[600]">{formatCurrency(Number(detail.totalAmount ?? 0))}</td></tr>
          </tbody>
        </table>
      ) : null}
      <section aria-label="Margin check" className="space-y-1.5 rounded-[10px] border border-[hsl(var(--e-border))] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="e-eyebrow">Margin check</p>
          {row.margin == null ? <EPill>Unknown</EPill> : row.belowFloor ? <EPill tone="warn">Under floor</EPill> : <EPill tone="ok">Above floor</EPill>}
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {row.margin == null
            ? "Cannot be worked out: the rate card has no rack rate or cleaner cost, or the quote has no price."
            : `${(row.margin * 100).toFixed(0)}% estimated from the current rate card's cleaner cost against the rack rate (the same model as the quote's margin-floor warning).`}
        </p>
      </section>
      <section aria-label="Timeline" className="rounded-[10px] border border-[hsl(var(--e-border))] p-3">
        <QuoteTimeline quoteId={row.id} />
      </section>
      <div className="flex flex-wrap gap-2">
        {row.status === "DRAFT" || row.status === "SENT" ? (
          <EButton size="sm" className="grow justify-center" onClick={onSend}>{row.status === "SENT" ? "Send again" : `Send to ${row.name.split(" ")[0]}`}</EButton>
        ) : null}
        <EButton size="sm" variant="outline" asChild><Link href={`/v2/admin/quotes/${row.id}`}>Open quote</Link></EButton>
        <EButton size="sm" variant="outline" asChild><a href={`/api/admin/quotes/${row.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></EButton>
      </div>
      {row.status === "ACCEPTED" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Accepted: convert it to a job from the quote page.</p> : null}
    </>
  );
}

function LeadBody({ row, onCounter, onLeadStatus, onConvertLead, busy }: Omit<PanelProps, "onClose" | "onSend">) {
  return (
    <>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Email</dt>
        <dd className="[overflow-wrap:anywhere]">{row.email ? <a className="text-[hsl(var(--e-primary))] hover:underline" href={`mailto:${row.email}`}>{row.email}</a> : "—"}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Phone</dt>
        <dd>{row.phone ? <a className="text-[hsl(var(--e-primary))] hover:underline" href={`tel:${row.phone}`}>{row.phone}</a> : "—"}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Estimate</dt>
        <dd className="e-tnum">{row.estimateMin != null || row.estimateMax != null ? `${formatCurrency(Number(row.estimateMin ?? 0))} – ${formatCurrency(Number(row.estimateMax ?? 0))}` : "None given"}</dd>
      </dl>
      <label className="flex flex-col gap-1">
        <span className="text-[0.75rem] font-[550]">Lead status</span>
        <select className="h-10 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem]" value={row.status} disabled={busy} onChange={(e) => onLeadStatus(e.target.value)}>
          {LEAD_STATUSES.map((status) => <option key={status} value={status}>{prettify(status)}</option>)}
        </select>
      </label>
      <fieldset disabled={busy} className="flex flex-wrap gap-2">
        <EButton size="sm" asChild><Link href={`/v2/admin/quotes/new?leadId=${encodeURIComponent(row.id)}`}>Make quote</Link></EButton>
        <EButton size="sm" variant="outline" onClick={onCounter}>Counter offer</EButton>
        {row.clientId ? (
          <EButton size="sm" variant="outline" asChild><Link href={`/v2/admin/clients/${row.clientId}`}>View client</Link></EButton>
        ) : (
          <EButton size="sm" variant="outline" onClick={onConvertLead}>Convert to client</EButton>
        )}
        {row.status !== "LOST" ? <EButton size="sm" variant="ghost" onClick={() => onLeadStatus("LOST")}>Dismiss lead</EButton> : null}
      </fieldset>
    </>
  );
}

export function PipelinePanel(props: PanelProps) {
  const { row } = props;
  return (
    <ESidePanel
      open
      label={row.kind === "quote" ? `Quote ${row.reference}` : "Lead"}
      onClose={props.onClose}
      toolbar={<span className="flex items-center gap-2"><span className="e-eyebrow">{row.kind === "quote" ? `Quote ${row.reference}` : "Lead"}</span><StatusPill row={row} /><MarginPill row={row} /></span>}
      title={row.name}
      subtitle={[row.suburb, prettify(row.serviceType), row.frequency && row.frequency !== "one_off" ? row.frequency : null].filter(Boolean).join(" · ")}
    >
      {row.kind === "quote" ? <QuoteBody row={row} onSend={props.onSend} /> : <LeadBody {...props} />}
    </ESidePanel>
  );
}
