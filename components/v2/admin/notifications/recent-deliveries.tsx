"use client";

import { EPill } from "@/components/v2/ui/pill";
import type { DeliveryLogRow } from "@/lib/notifications/delivery-log-map";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import { useNotificationRead } from "./use-notification-read";
import { formatDeliveryTime, stateTone } from "./delivery-format";

type Page = { rows: DeliveryLogRow[]; total: number };

function parsePage(body: unknown): Page {
  const value = body as Partial<Page> | null;
  if (!value || !Array.isArray(value.rows) || typeof value.total !== "number") throw new Error("bad page");
  return { rows: value.rows, total: value.total };
}

/** The last 20 deliveries recorded for one type, across pipeline and direct rows. */
export function RecentDeliveries({ typeKey }: { typeKey: string }) {
  const read = useNotificationRead(`/api/admin/notifications/deliveries?type=${encodeURIComponent(typeKey)}&pageSize=20`, parsePage, "Could not load recent deliveries.");
  return (
    <section aria-labelledby="type-recent" className="space-y-2">
      <h3 id="type-recent" className="font-semibold">Last 20 deliveries</h3>
      {read.loading && !read.data ? <p role="status" className="text-xs">Loading deliveries…</p> : null}
      {read.error ? (
        <p role="alert" className="text-xs">
          {read.error}{" "}
          <button type="button" className="underline" onClick={read.reload}>Retry</button>
        </p>
      ) : null}
      {read.data && read.data.rows.length === 0 ? (
        <p className="text-xs text-[hsl(var(--e-muted-foreground))]">No deliveries recorded for this type. Legacy rows are matched by subject, so some older sends may show as unclassified in the delivery log.</p>
      ) : null}
      <ul className="space-y-1.5">
        {read.data?.rows.map((row) => (
          <li key={row.id} className="rounded border border-[hsl(var(--e-border))] p-2 text-xs [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-1.5">
              <EPill tone={stateTone(row.state)}>{row.stateLabel}</EPill>
              <span>{TRANSPORT_LABEL[row.transport]}</span>
              <span className="text-[hsl(var(--e-muted-foreground))]">· {row.path}</span>
            </div>
            <p className="mt-1">{row.recipientLabel} · {formatDeliveryTime(row.time)}</p>
            {row.error ? <p className="text-[hsl(var(--e-danger))]">{row.error}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
