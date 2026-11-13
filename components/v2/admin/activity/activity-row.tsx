"use client";

/**
 * One Activity log row. From 640px up it is the native disclosure it always
 * was (summary row, field-by-field change and the raw before / after folded
 * underneath). On a phone (board "M-SettingsActivityGrowth") the row reads as
 * a sentence under "when · who" and opens the same detail as a full-screen
 * sheet; the actual person and the person they were testing as stay apart.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import type { ActivityRowView } from "@/lib/admin/activity-format";

function ActivityDetail({ row }: { row: ActivityRowView }) {
  return (
    <>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Record <span className="font-mono">{row.entityId}</span>
        {row.ipAddress ? ` · ${row.ipAddress}` : ""}
        {row.jobId ? <> · <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${row.jobId}`}>Open job</Link></> : null}
      </p>
      {row.changes.length > 0 ? (
        <table className="w-full text-left text-[0.8125rem]">
          <caption className="sr-only">Changed fields</caption>
          <thead><tr className="text-[0.6875rem] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Before</th><th className="py-1">After</th></tr></thead>
          <tbody>
            {row.changes.map((change) => (
              <tr key={change.field} className="border-t border-[hsl(var(--e-border))] align-top">
                <td className="py-1 pr-3 font-[550]">{change.field}</td>
                <td className="py-1 pr-3 [overflow-wrap:anywhere]">{change.before}</td>
                <td className="py-1 [overflow-wrap:anywhere]">{change.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No field-by-field change recorded for this action.</p>
      )}
      {row.before != null || row.after != null ? (
        <details>
          <summary className="cursor-pointer text-[0.75rem] font-[550]">Raw before and after</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(["before", "after"] as const).map((side) => (
              <div key={side} className="min-w-0">
                <p className="e-eyebrow mb-1">{side === "before" ? "Before" : "After"}</p>
                <pre className="max-h-64 overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.6875rem]">{row[side] != null ? JSON.stringify(row[side], null, 2) : "—"}</pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function WhoLine({ row }: { row: ActivityRowView }) {
  return (
    <>
      {row.actual.role ?? "role unknown"}
      {row.testingAs ? <>, testing as <b className="font-[600] text-[hsl(var(--e-foreground))]">{row.testingAs.name}</b></> : null}
    </>
  );
}

function PhoneRow({ row, timezone }: { row: ActivityRowView; timezone: string }) {
  const [open, setOpen] = React.useState(false);
  const when = formatInTimeZone(new Date(row.at), timezone, "d MMM HH:mm");
  return (
    <div className="border-b border-[hsl(var(--e-border))] last:border-0">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <span className="e-tnum">{when}</span> · <span className="font-[600] text-[hsl(var(--e-foreground))]">{row.actual.name}</span>, <WhoLine row={row} />
          </span>
          <span className="mt-0.5 block text-[0.875rem] [overflow-wrap:anywhere]">{row.sentence}</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            <EPill>{row.entity}</EPill>
            {row.testingAs ? <EPill tone="warn">Test as</EPill> : null}
          </span>
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
      </button>
      <ESidePanel
        open={open}
        label="Activity entry"
        title={row.sentence}
        subtitle={`${row.entity} · ${when}`}
        onClose={() => setOpen(false)}
      >
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Done by</dt>
          <dd>{row.actual.name}, {row.actual.role ?? "role unknown"}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Acting as</dt>
          <dd>{row.testingAs ? <>Testing as <b className="font-[600]">{row.testingAs.name}</b></> : "Not testing as anyone"}</dd>
        </dl>
        <ActivityDetail row={row} />
      </ESidePanel>
    </div>
  );
}

export function ActivityRow({ row, timezone }: { row: ActivityRowView; timezone: string }) {
  const phone = useIsPhone();
  if (phone) return <PhoneRow row={row} timezone={timezone} />;
  return (
    <details className="group border-b border-[hsl(var(--e-border))] last:border-0">
      <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-4 py-3 hover:bg-[hsl(var(--e-muted))] sm:grid-cols-[120px_200px_minmax(0,1fr)_auto] sm:items-center sm:gap-3 [&::-webkit-details-marker]:hidden">
        <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{formatInTimeZone(new Date(row.at), timezone, "d MMM HH:mm")}</span>
        <span className="min-w-0 text-[0.8125rem]">
          <span className="font-[600]">{row.actual.name}</span>
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <WhoLine row={row} />
          </span>
        </span>
        <span className="min-w-0 text-[0.8125rem] [overflow-wrap:anywhere]">{row.sentence}</span>
        <span className="flex items-center gap-2">
          <EPill>{row.entity}</EPill>
          {row.testingAs ? <EPill tone="warn">Test as</EPill> : null}
        </span>
      </summary>
      <div className="space-y-3 bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3">
        <ActivityDetail row={row} />
      </div>
    </details>
  );
}
