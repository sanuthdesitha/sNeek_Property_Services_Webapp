"use client";

/**
 * Delivery profiles (board "Delivery profiles", 2026-11-16): who receives each
 * client's job reports and invoices by email.
 *
 * - One row per active client; an empty list shows the real fallback (the
 *   client email the send paths add) as a dashed chip, never "nobody".
 * - Email is the only transport. Nothing on this page sends.
 * - The stored "auto-send" switches are read by nothing, so they are shown as
 *   "Not in use" and cannot be turned on; their stored values are kept.
 * - Results per address come from the sending log: Queued is not delivered.
 * - Saving sends the stale-write token; a newer save by someone else is shown
 *   with "Keep mine" or "Load theirs", and the draft stays.
 * - The list and client selection freeze while saving; a failed save keeps
 *   the edits.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Info } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EButton, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EToneCard, EToneRowCell, toneMutedClass, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import {
  SEND_RESULT_MEANING,
  SEND_RESULT_WORDS,
  deliveryCsv,
  isValidAddress,
  matchesFilter,
  matchesSearch,
  normalizeAddress,
  type DeliveryAddress,
  type DeliveryFilter,
  type DeliveryOverview,
  type DeliveryOverviewRow,
  type DeliveryProfileView,
  type RecentSend,
  type SendResult,
} from "@/lib/commercial/delivery-model";

const MUTED = "text-[hsl(var(--e-muted-foreground))]";
const PAGE_SIZE = 25;
const H2 = "font-[family-name:var(--e-font-serif)] text-[1.375rem] font-medium leading-tight";

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: DeliveryOverview };

function formatWhen(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "EEE d MMM HH:mm");
}

/* ── Result marks ────────────────────────────────────────────────────────── */

function ResultShape({ result }: { result: SendResult }) {
  const common = "inline-block h-3 w-3 shrink-0";
  if (result === "handed_over") {
    return <svg aria-hidden viewBox="0 0 12 12" className={cn(common, "text-[hsl(var(--e-success))]")}><circle cx="6" cy="6" r="5" fill="currentColor" /></svg>;
  }
  if (result === "queued") {
    return <svg aria-hidden viewBox="0 0 12 12" className={cn(common, "text-[hsl(var(--e-info))]")}><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
  }
  if (result === "failed") {
    return <svg aria-hidden viewBox="0 0 12 12" className={cn(common, "text-[hsl(var(--e-danger))]")}><path d="M6 1 L11 11 L1 11 Z" fill="currentColor" /></svg>;
  }
  return <svg aria-hidden viewBox="0 0 12 12" className={cn(common, "text-[hsl(var(--e-text-secondary))]")}><path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" fill="currentColor" /></svg>;
}

function ResultMark({ result, className }: { result: SendResult; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold", className)}>
      <ResultShape result={result} />
      {SEND_RESULT_WORDS[result]}
    </span>
  );
}

/* ── Address chips ──────────────────────────────────────────────────────── */

function AddressChip({ address, fallbackLabel }: { address: DeliveryAddress; fallbackLabel?: string }) {
  const bounced = Boolean(address.bounce);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-2.5 py-0.5 text-[0.75rem]",
        address.source === "client_email" ? "border-dashed border-[hsl(var(--e-border-strong))]" : "border-[hsl(var(--e-border-strong))]",
        bounced && "border-solid border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]",
      )}
    >
      {bounced ? <span aria-hidden>▲</span> : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{address.email}</span>
      {bounced ? <span className="whitespace-nowrap text-[0.6875rem]">on bounce list</span> : null}
      {!bounced && address.source === "client_email" ? <span className={cn("whitespace-nowrap text-[0.6875rem]", MUTED)}>{fallbackLabel ?? "client email"}</span> : null}
    </span>
  );
}

function RouteChips({ custom, fallback, emptyText }: { custom: DeliveryAddress[]; fallback: DeliveryAddress[]; emptyText: string }) {
  if (!custom.length && !fallback.length) {
    return <span className="inline-flex rounded-[var(--e-radius-pill)] border border-dashed border-[hsl(var(--e-border-strong))] px-2.5 py-0.5 text-[0.75rem]">{emptyText}</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {custom.map((address) => <AddressChip key={address.email} address={address} />)}
      {fallback.map((address) => <AddressChip key={address.email} address={address} fallbackLabel={custom.length ? "client email" : "fallback"} />)}
    </span>
  );
}

/* ── List ───────────────────────────────────────────────────────────────── */

function rowTone(row: DeliveryOverviewRow): "problem" | "attention" | null {
  if (row.problems.includes("bounce")) return "problem";
  if (row.problems.includes("no_invoice_address") || row.problems.includes("no_report_address")) return "attention";
  return null;
}

function rowReason(row: DeliveryOverviewRow): string | null {
  if (row.problems.includes("bounce")) return "Bounced";
  if (row.problems.includes("no_invoice_address")) return "No invoice address";
  if (row.problems.includes("no_report_address")) return "No report address";
  return null;
}

function LastSentCell({ row, timeZone }: { row: DeliveryOverviewRow; timeZone: string }) {
  if (!row.lastSent) return <span className={MUTED}>Nothing sent yet</span>;
  return (
    <span className="block min-w-0">
      <ResultMark result={row.lastSent.result} className="text-[0.8125rem]" />
      <span className={cn("block break-words text-[0.75rem]", MUTED)}>
        {row.lastSent.subject ?? "Email"} · {formatWhen(row.lastSent.at, timeZone)}
      </span>
    </span>
  );
}

function ClientName({ row, onOpen, disabled }: { row: DeliveryOverviewRow; onOpen: () => void; disabled: boolean }) {
  return (
    <button type="button" className="text-left font-semibold underline-offset-2 hover:underline disabled:opacity-60" onClick={onOpen} disabled={disabled}>
      {row.client.name}
    </button>
  );
}

function DeliveryTable({ rows, timeZone, selected, onOpen, frozen }: { rows: DeliveryOverviewRow[]; timeZone: string; selected: string | null; onOpen: (id: string) => void; frozen: boolean }) {
  return (
    <>
      <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Client delivery profiles" tabIndex={0}>
        <table className="w-full min-w-[640px] text-left text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Client</th>
              <th scope="col" className="px-3 py-2 font-medium">Reports go to</th>
              <th scope="col" className="px-3 py-2 font-medium">Invoices go to</th>
              <th scope="col" className="px-3 py-2 font-medium">Last sent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = rowTone(row);
              const reason = rowReason(row);
              return (
                <tr key={row.client.id} className={cn("border-t border-[hsl(var(--e-border))] align-top", selected === row.client.id && "bg-[hsl(var(--e-primary)/0.08)]")} data-client-row={row.client.id}>
                  <EToneRowCell tone={selected === row.client.id ? null : tone} className="px-3 py-2.5">
                    <ClientName row={row} onOpen={() => onOpen(row.client.id)} disabled={frozen} />
                    {reason ? <span className="ml-1.5 inline-flex rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface))] px-2 text-[0.6875rem] font-semibold">{reason}</span> : null}
                    <span className={cn("block text-[0.75rem]", MUTED)}>
                      {row.client.propertyCount} {row.client.propertyCount === 1 ? "property" : "properties"}
                      {row.profile.updatedAt ? ` · edited ${formatInTimeZone(new Date(row.profile.updatedAt), timeZone, "d MMM")}` : ""}
                      {row.client.portalUsers.length === 0 ? " · no portal login" : ""}
                    </span>
                  </EToneRowCell>
                  <td className="px-3 py-2.5"><RouteChips custom={row.reports.custom} fallback={row.reports.fallback} emptyText="none on file" /></td>
                  <td className="px-3 py-2.5"><RouteChips custom={row.invoices.custom} fallback={row.invoices.fallback} emptyText="none on file" /></td>
                  <td className="px-3 py-2.5"><LastSentCell row={row} timeZone={timeZone} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden" aria-label="Client delivery profiles">
        {rows.map((row) => {
          const reason = rowReason(row);
          return (
            <li key={row.client.id} className="space-y-2 px-3.5 py-3 text-[0.8125rem]">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="min-h-11 text-left font-semibold disabled:opacity-60" onClick={() => onOpen(row.client.id)} disabled={frozen}>
                  {row.client.name}
                </button>
                {reason ? <span className={cn("rounded-[var(--e-radius-pill)] px-2 py-0.5 text-[0.6875rem] font-semibold", toneNoticeClass(rowTone(row) ?? "info"))}>{reason}</span> : null}
              </div>
              <p className={MUTED}>Reports</p>
              <RouteChips custom={row.reports.custom} fallback={row.reports.fallback} emptyText="none on file" />
              <p className={MUTED}>Invoices</p>
              <RouteChips custom={row.invoices.custom} fallback={row.invoices.fallback} emptyText="none on file" />
              <LastSentCell row={row} timeZone={timeZone} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────────── */

type Draft = { reports: string[]; invoices: string[]; reportsText: string; invoicesText: string };

function draftFrom(profile: DeliveryProfileView): Draft {
  return { reports: [...profile.reportRecipients], invoices: [...profile.invoiceRecipients], reportsText: "", invoicesText: "" };
}

/** The list as it would be saved: chips plus a valid address still in the box. */
function finalList(list: string[], text: string): string[] {
  const extra = text.split(/[,;\s]+/).map(normalizeAddress).filter(Boolean);
  return Array.from(new Set([...list, ...extra].map(normalizeAddress)));
}

function boxProblem(text: string): string | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  const bad = parts.find((part) => !isValidAddress(part));
  return bad ? `"${bad}" is not an email address. Fix it or remove it; Save waits.` : null;
}

function ChipsField({
  id,
  label,
  list,
  text,
  onList,
  onText,
  help,
}: {
  id: string;
  label: string;
  list: string[];
  text: string;
  onList: (next: string[]) => void;
  onText: (next: string) => void;
  help: React.ReactNode;
}) {
  const problem = boxProblem(text);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  function commit() {
    if (!text.trim() || problem) return;
    onList(finalList(list, text));
    onText("");
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]">{label}</label>
      <div className={cn("flex flex-wrap gap-1.5 rounded-[var(--e-radius)] border bg-[hsl(var(--e-surface))] p-2", problem ? "border-[hsl(var(--e-danger))]" : "border-[hsl(var(--e-border-strong))]")}>
        {list.map((email) => (
          <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-2 py-0.5 text-[0.75rem]">
            <span className="min-w-0 break-all">{email}</span>
            <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-full max-sm:h-8 max-sm:w-8" aria-label={`Remove ${email}`} onClick={() => onList(list.filter((item) => item !== email))}>
              ✕
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={text}
          placeholder="Add an email"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${errorId} ${helpId}` : helpId}
          onChange={(event) => onText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
          }}
          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-[16px] outline-none sm:text-[0.8125rem]"
        />
      </div>
      {problem ? <p id={errorId} role="alert" className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">{problem}</p> : null}
      <p id={helpId} className={cn("mt-1 text-[0.75rem]", MUTED)}>{help}</p>
    </div>
  );
}

type Conflict = { current: DeliveryProfileView };

function DeliveryEditor({
  row,
  canEdit,
  readOnlyReason,
  timeZone,
  onSaving,
  onSaved,
}: {
  row: DeliveryOverviewRow;
  canEdit: boolean;
  readOnlyReason: string | null;
  timeZone: string;
  onSaving: (saving: boolean) => void;
  onSaved: () => void;
}) {
  const [baseline, setBaseline] = React.useState<DeliveryProfileView>(row.profile);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(row.profile));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);
  const clientEmail = row.client.email ? normalizeAddress(row.client.email) : null;

  const reports = finalList(draft.reports, draft.reportsText);
  const invoices = finalList(draft.invoices, draft.invoicesText);
  const invalid = Boolean(boxProblem(draft.reportsText) || boxProblem(draft.invoicesText));
  const dirty = reports.join(",") !== baseline.reportRecipients.join(",") || invoices.join(",") !== baseline.invoiceRecipients.join(",");
  const invoicePreview = Array.from(new Set([...invoices, ...(clientEmail ? [clientEmail] : [])]));

  async function save(expected: string | null) {
    setSaving(true);
    onSaving(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch("/api/admin/client-delivery-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: row.client.id, reportRecipients: reports, invoiceRecipients: invoices, expectedUpdatedAt: expected }),
      });
      const body = (await response.json().catch(() => null)) as ({ error?: string; code?: string; current?: DeliveryProfileView; updatedAt?: string } & Record<string, unknown>) | null;
      if (response.status === 409 && body?.code === "STALE_WRITE" && body.current) {
        setConflict({ current: body.current });
        return;
      }
      if (!response.ok || !body) {
        setError(`Not saved: ${body?.error ?? "the server refused the change"}. Your edits are kept.`);
        return;
      }
      const next: DeliveryProfileView = { ...baseline, reportRecipients: reports, invoiceRecipients: invoices, updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : baseline.updatedAt };
      setBaseline(next);
      setDraft(draftFrom(next));
      setConflict(null);
      setSaved(`Saved ${row.client.name}. The next Send uses these addresses.`);
      onSaved();
    } catch {
      setError("Not saved: the server could not be reached. Your edits are kept.");
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }

  function loadTheirs(current: DeliveryProfileView) {
    setBaseline(current);
    setDraft(draftFrom(current));
    setConflict(null);
  }

  const reportFallback = row.client.email
    ? <>Always added as well: the client&apos;s own email on file, {row.client.email} (shown once). With an empty list it is used alone. Documents sent from the client page use this list, or the client&apos;s portal users{row.client.portalUsers.length ? ` (today ${row.client.portalUsers.map((user) => user.name).join(", ")})` : ""} when it is empty.</>
    : <>The client has no email on file, so an empty list means &quot;Share report&quot; asks for an address. Documents sent from the client page go to the client&apos;s portal users{row.client.portalUsers.length ? ` (today ${row.client.portalUsers.map((user) => user.name).join(", ")})` : " (none today)"}.</>;
  const invoiceFallback = row.client.email
    ? <>Always added as well: the client&apos;s own email on file, {row.client.email} (shown once).</>
    : <>The client has no email on file: with an empty list, Send refuses until an address is given.</>;

  return (
    <div className="space-y-4">
      {conflict ? (
        <div role="alert" className={cn("space-y-2 rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem]", toneNoticeClass("attention"))}>
          <p className="font-semibold">
            {conflict.current.updatedBy?.name ?? "Someone"} changed this{conflict.current.updatedAt ? ` at ${formatInTimeZone(new Date(conflict.current.updatedAt), timeZone, "HH:mm")}` : ""}.
          </p>
          <p className={toneMutedClass("attention")}>Your edits stay. Reports now go to {conflict.current.reportRecipients.join(", ") || "the fallback"}; invoices to {conflict.current.invoiceRecipients.join(", ") || "the fallback"}.</p>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" onClick={() => void save(conflict.current.updatedAt)} disabled={saving}>Keep mine</EButton>
            <EButton size="sm" variant="outline" onClick={() => loadTheirs(conflict.current)} disabled={saving}>Load theirs</EButton>
          </div>
        </div>
      ) : null}
      <fieldset disabled={saving || !canEdit} className="space-y-4">
        <ChipsField
          id={`reports-${row.client.id}`}
          label="Job reports go to"
          list={draft.reports}
          text={draft.reportsText}
          onList={(next) => setDraft((current) => ({ ...current, reports: next }))}
          onText={(next) => setDraft((current) => ({ ...current, reportsText: next }))}
          help={reportFallback}
        />
        <ChipsField
          id={`invoices-${row.client.id}`}
          label="Invoices go to"
          list={draft.invoices}
          text={draft.invoicesText}
          onList={(next) => setDraft((current) => ({ ...current, invoices: next }))}
          onText={(next) => setDraft((current) => ({ ...current, invoicesText: next }))}
          help={invoiceFallback}
        />
      </fieldset>
      <ECard className="p-3">
        <h3 className="text-[0.875rem] font-semibold">Sending automatically</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { label: "Reports: when a job is approved", note: 'Not in use. Reports are sent with "Share report" on the job.', stored: baseline.autoSendReports },
            { label: "Invoices: when issued", note: "Not in use. Invoices go when someone presses Send.", stored: baseline.autoSendInvoices },
          ].map((item) => (
            <div key={item.label} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5 text-[0.75rem]" data-auto-send="not-in-use">
              <label className="flex items-start gap-2 font-semibold">
                <input type="checkbox" disabled checked={false} aria-describedby={`${row.client.id}-${item.label}`} className="mt-0.5" />
                {item.label}
              </label>
              <p id={`${row.client.id}-${item.label}`} className={cn("mt-1", MUTED)}>{item.note} Stored value: {item.stored ? "on" : "off"}.</p>
            </div>
          ))}
        </div>
        <p className={cn("mt-2 text-[0.75rem]", MUTED)}>Stored values are kept and shown here, so nothing is lost if the owner turns the feature on. Today nothing reads them.</p>
      </ECard>
      <ECard className="p-3 text-[0.8125rem]">
        <h3 className="font-semibold">Preview: sending an invoice now goes to</h3>
        {invoicePreview.length ? (
          <ul className="mt-1 space-y-0.5">
            {invoicePreview.map((email) => (
              <li key={email} className="break-all">
                <span className="font-semibold">{email}</span> <span className={MUTED}>{invoices.includes(email) ? (email === clientEmail ? "from this profile and the client email" : "from this profile") : "the client email"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">Nobody: Send refuses until an address is given.</p>
        )}
        <p className={cn("mt-1 text-[0.75rem]", MUTED)}>One email, email transport only. The sending log shows each address&apos;s result after sending.</p>
      </ECard>
      <div aria-live="polite" className="text-[0.8125rem]">
        {saved ? <p>{saved}</p> : null}
        {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <EButton className="flex-1" onClick={() => void save(baseline.updatedAt)} disabled={saving || invalid || !dirty || Boolean(conflict)}>
            {saving ? "Saving…" : `Save ${row.client.name}`}
          </EButton>
          <EButton variant="ghost" onClick={() => { setDraft(draftFrom(baseline)); setError(null); }} disabled={saving || (!dirty && !draft.reportsText && !draft.invoicesText)}>
            Reset
          </EButton>
        </div>
      ) : (
        <p className={cn("text-[0.8125rem]", MUTED)}>{readOnlyReason ?? "Read only."}</p>
      )}
      <p className={cn("text-[0.75rem]", MUTED)}>
        Addresses are checked as you type; a bad one stays in the box, marked, and Save waits. The list and the client selection lock while saving; a failed save keeps your edits.
      </p>
    </div>
  );
}

/* ── Recent sends ───────────────────────────────────────────────────────── */

type SendsState = { status: "loading" } | { status: "failed" } | { status: "ready"; sends: RecentSend[] };

function useRecentSends(clientId: string | null, reloadKey: number): SendsState | null {
  const [state, setState] = React.useState<SendsState | null>(null);
  React.useEffect(() => {
    if (!clientId) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/client-delivery-profiles/${encodeURIComponent(clientId)}/sends`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as { sends?: RecentSend[] } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.sends) throw new Error("failed");
        setState({ status: "ready", sends: body.sends });
      } catch {
        if (!controller.signal.aborted) setState({ status: "failed" });
      }
    })();
    return () => controller.abort();
  }, [clientId, reloadKey]);
  return state;
}

function RecentSends({ row, state, timeZone, onRetry }: { row: DeliveryOverviewRow; state: SendsState | null; timeZone: string; onRetry: () => void }) {
  return (
    <ECard className="min-w-0 overflow-hidden">
      {!state || state.status === "loading" ? (
        <p role="status" className="p-4 text-[0.875rem]">Loading recent sends for {row.client.name}…</p>
      ) : state.status === "failed" ? (
        <p role="alert" className="p-4 text-[0.875rem]">
          Recent sends could not be loaded. <button type="button" className="underline underline-offset-2" onClick={onRetry}>Try again</button>
        </p>
      ) : state.sends.length === 0 ? (
        <p className="p-4 text-[0.875rem]">No email to these addresses is in the sending log yet.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]" aria-label={`Recent sends to ${row.client.name}`}>
          {state.sends.map((send) => (
            <li key={send.id} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_9rem] sm:gap-3">
              <span className={MUTED}>{formatWhen(send.at, timeZone)}</span>
              <span className="min-w-0 break-words">{send.subject ?? "Email"} · {send.address}</span>
              <span>
                <ResultMark result={send.result} />
                {send.reason ? <span className={cn("block text-[0.75rem]", MUTED)}>{send.reason}</span> : null}
              </span>
              {send.result === "failed" ? <span className={cn("text-[0.75rem] sm:col-span-3", MUTED)}>Not retried automatically. Send it again from the invoice or the job.</span> : null}
            </li>
          ))}
        </ul>
      )}
    </ECard>
  );
}

function WordsCard() {
  const order: SendResult[] = ["queued", "handed_over", "failed", "not_sent", "unknown"];
  return (
    <ECard className="p-4 text-[0.8125rem]">
      <h3 className="font-semibold">What the words mean</h3>
      <ul className="mt-2 space-y-1.5">
        {order.map((result) => (
          <li key={result}><ResultMark result={result} /> {SEND_RESULT_MEANING[result]}</li>
        ))}
      </ul>
      <p className="mt-2"><Link href="/v2/admin/diagnostics?tab=email" className="underline underline-offset-2">System health › Email</Link> holds the bounce list.</p>
    </ECard>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────────── */

export function DeliveryProfilesScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = useIsPhone();
  const selectedId = params.get("client");
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [stale, setStale] = React.useState(false);
  const [filter, setFilter] = React.useState<DeliveryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [saving, setSaving] = React.useState(false);
  const [sendsKey, setSendsKey] = React.useState(0);
  const controller = React.useRef<AbortController | null>(null);
  const hasData = React.useRef(false);
  hasData.current = state.status === "ready";

  const load = React.useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStale(false);
    try {
      const response = await fetch("/api/admin/client-delivery-profiles/overview", { cache: "no-store", signal: current.signal });
      const body = (await response.json().catch(() => null)) as (DeliveryOverview & { error?: string }) | null;
      if (current.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error ?? "failed");
      setState({ status: "ready", data: body });
    } catch {
      if (current.signal.aborted) return;
      // Keep the last good rows with a stale notice; never blank them.
      if (hasData.current) setStale(true);
      else setState({ status: "failed", message: "Delivery profiles could not be loaded." });
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const setSelected = React.useCallback((id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("client", id);
    else next.delete("client");
    const search = next.toString();
    router.replace(`/v2/admin/delivery-profiles${search ? `?${search}` : ""}`, { scroll: false });
  }, [params, router]);

  const data = state.status === "ready" ? state.data : null;
  const rows = data?.rows ?? [];
  const visible = rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, query));
  const selectedRow = rows.find((row) => row.client.id === selectedId) ?? null;
  const sends = useRecentSends(selectedRow?.client.id ?? null, sendsKey);
  const autoStored = rows.filter((row) => row.profile.autoSendReports || row.profile.autoSendInvoices).length;

  function exportCsv() {
    const blob = new Blob([deliveryCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "client-delivery-profiles.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const chips: Array<{ key: DeliveryFilter; label: string; count: number | null }> = [
    { key: "all", label: "All active", count: data ? rows.length : null },
    { key: "custom", label: "Custom recipients", count: data ? rows.filter((row) => matchesFilter(row, "custom")).length : null },
    { key: "fallback", label: "Using fallback only", count: data ? rows.filter((row) => matchesFilter(row, "fallback")).length : null },
    { key: "problem", label: "Address problem", count: data ? rows.filter((row) => matchesFilter(row, "problem")).length : null },
  ];

  const exportButton = (
    <EButton variant="outline" onClick={exportCsv} disabled={!data || visible.length === 0}>
      <Download aria-hidden className="h-4 w-4" /> Export CSV
    </EButton>
  );

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Setup · Notifications · Client delivery"
        title="Delivery profiles"
        description="Who receives each client's job reports and invoices by email. One row per active client; empty means the usual fallback address is used, never nobody."
        actions={<span className="max-sm:hidden">{exportButton}</span>}
      />

      <details className="group rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] sm:open:border-0 sm:open:bg-transparent" open={!phone}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-[0.875rem] font-semibold sm:hidden">
          How sending works <span aria-hidden className="group-open:rotate-90">▸</span>
        </summary>
        <ol className="grid grid-cols-1 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[0.8125rem] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["1 · Someone presses Send", "On the invoice, the job report or the quote. Nothing in this page sends on its own."],
            ["2 · Addresses are worked out", "This profile's list for that kind, plus the fallback below. Duplicates removed."],
            ["3 · Transport: email only", "Reports and invoices go by email through the email service. Never SMS or app push."],
            ["4 · Result per address", "Queued, handed over, failed, or not sent. Shown in the sending log below."],
          ].map(([title, text], index) => (
            <li key={title} className={cn("p-3", index > 0 && "border-t border-[hsl(var(--e-border))] sm:border-t-0 sm:border-l")}>
              <p className="font-semibold">{title}</p>
              <p className={cn("mt-1", MUTED)}>{text}</p>
            </li>
          ))}
        </ol>
      </details>

      <div className={cn("flex gap-2 rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem]", toneNoticeClass("attention"))} data-auto-send-notice="">
        <span aria-hidden className="font-bold">!</span>
        <p className="min-w-0">
          <strong>&quot;Auto-send&quot; switches are saved but nothing reads them.</strong>{" "}
          <span className={toneMutedClass("attention")}>
            Today no invoice or report is ever sent automatically because of this page, whatever the switch says. Until the owner decides, they are shown as &quot;Not in use&quot; and cannot be turned on{autoStored ? ` (${autoStored} ${autoStored === 1 ? "client has" : "clients have"} one stored on)` : ""}.
          </span>
        </p>
      </div>

      {state.status === "failed" ? (
        <div role="alert" className={cn("rounded-[var(--e-radius-lg)] p-4 text-[0.875rem]", toneNoticeClass("problem"))}>
          <p className="font-semibold">Delivery profiles could not be loaded.</p>
          <p className={toneMutedClass("problem")}>No row is shown as &quot;fallback&quot; while the real list is unknown.</p>
          <EButton size="sm" variant="outline" className="mt-2" onClick={() => { setState({ status: "loading" }); void load(); }}>Try again</EButton>
        </div>
      ) : null}
      {stale ? (
        <p role="alert" className={cn("rounded-[var(--e-radius)] p-2 text-[0.8125rem]", toneNoticeClass("attention"))}>
          The latest read failed; these rows are from the previous one. <button type="button" className="underline" onClick={() => void load()}>Try again</button>
        </p>
      ) : null}

      <div className={cn("grid min-w-0 grid-cols-1 gap-4", selectedRow && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="delivery-search">Search client or address</label>
            <input
              id="delivery-search"
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setShown(PAGE_SIZE); }}
              placeholder="Search client or address"
              className="h-10 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:w-56 sm:text-[0.8125rem] max-sm:h-11"
            />
            <EFilterChips label="Show clients" chips={chips} active={filter} onChange={(key) => { setFilter(key); setShown(PAGE_SIZE); }} phoneLayout="carousel" />
          </div>
          <ECard className="min-w-0 overflow-hidden">
            {state.status === "loading" ? (
              <div role="status" aria-label="Loading delivery profiles" className="space-y-2 p-4">
                {[0, 1, 2].map((index) => <div key={index} className="h-8 animate-pulse rounded bg-[hsl(var(--e-surface-raised))] motion-reduce:animate-none" />)}
              </div>
            ) : data && rows.length === 0 ? (
              <p className="p-4 text-[0.875rem]">No active clients yet. Add a client to set where reports and invoices go.</p>
            ) : data && visible.length === 0 ? (
              <p className="p-4 text-[0.875rem]">No client matches this search or filter.</p>
            ) : data ? (
              <>
                <DeliveryTable rows={visible.slice(0, shown)} timeZone={data.timeZone} selected={selectedRow?.client.id ?? null} onOpen={(id) => setSelected(id)} frozen={saving} />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem]">
                  <span className={MUTED}>Dashed = the client email, used because the list is empty or always added. &quot;Last sent&quot; is the last email to these addresses in the sending log.</span>
                  {visible.length > shown ? <EButton size="sm" variant="outline" onClick={() => setShown((count) => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, visible.length - shown)} more</EButton> : null}
                </div>
              </>
            ) : null}
          </ECard>
        </div>
        {selectedRow && data ? (
          <ESidePanel
            open
            label="Client delivery"
            title={selectedRow.client.name}
            toolbar={<span className="e-eyebrow">Client delivery</span>}
            onClose={() => { if (!saving) setSelected(null); }}
          >
            <DeliveryEditor
              key={selectedRow.client.id}
              row={selectedRow}
              canEdit={data.canEdit}
              readOnlyReason={data.readOnlyReason}
              timeZone={data.timeZone}
              onSaving={setSaving}
              onSaved={() => { void load(); setSendsKey((key) => key + 1); }}
            />
          </ESidePanel>
        ) : null}
      </div>

      {selectedRow && data ? (
        <section className="space-y-3" aria-labelledby="recent-sends-title">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="recent-sends-title" className={H2}>What happened to recent sends</h2>
            <p className={cn("text-[0.8125rem]", MUTED)}>{selectedRow.client.name} · from the sending log, {data.timeZone === "Australia/Sydney" ? "Sydney time" : data.timeZone}</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <RecentSends row={selectedRow} state={sends} timeZone={data.timeZone} onRetry={() => setSendsKey((key) => key + 1)} />
            <WordsCard />
          </div>
        </section>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <EToneCard header={<h2 className="text-[0.9375rem] font-semibold">Not this page: people&apos;s own notifications</h2>}>
          <p className="text-[0.8125rem]">
            How alerts reach staff and clients (inbox, email, SMS, push, per role) lives in <Link href="/v2/admin/notifications" className="underline underline-offset-2">Notifications › Types and audiences</Link>, and each person&apos;s own switches on their People panel.
          </p>
        </EToneCard>
        <EToneCard header={<h2 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold"><Info aria-hidden className="h-4 w-4" /> Bounce list</h2>}>
          <p className="text-[0.8125rem]">
            A report is never sent to an address on the bounce list; an invoice is still tried, because a stale mark must not silently stop an invoice. The row shows it with ▲ and &quot;on bounce list&quot;, so a missing report is explained before the client calls.
          </p>
        </EToneCard>
      </div>

      {data ? <EPhoneActionBar label="Delivery profiles actions" primary={exportButton} hidden={Boolean(selectedRow)} /> : null}
    </div>
  );
}
