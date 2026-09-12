"use client";

import { buildHandoffReceipts, handoffTimeLabel, type HandoffConfirmation } from "@/lib/laundry/handoff-receipts";

export function LaundryHandoffReceipts({ confirmations }: { confirmations: readonly HandoffConfirmation[] }) {
  const receipts = buildHandoffReceipts(confirmations);
  return <details className="rounded border border-[hsl(var(--e-border))] p-3">
    <summary className="cursor-pointer text-sm font-semibold">Recorded handoffs ({receipts.length})</summary>
    <p className="mt-2 text-xs text-[hsl(var(--e-muted-foreground))]">These records show who recorded each action, not acceptance by a recipient. Pickup and return details may include later corrections shown below.</p>
    {!receipts.length ? <p className="mt-2 text-sm">No handoff confirmations recorded.</p> : <ol className="mt-3 space-y-3">{receipts.map(receipt => <li key={receipt.id} className="border-l-2 border-[hsl(var(--e-border))] pl-3 text-sm">
      <p className="font-medium">{receipt.label}</p>
      <p>Recorded by {receipt.actor} · {receipt.at ? <time dateTime={receipt.at}>{handoffTimeLabel(receipt.at)}</time> : "Time unavailable"}</p>
      {receipt.details.map((detail, i) => <p key={i}>{detail}</p>)}
      {receipt.photoUrl ? <a className="inline-flex min-h-11 items-center underline" href={receipt.photoUrl} target="_blank" rel="noreferrer">View recorded photo</a> : null}
    </li>)}</ol>}
  </details>;
}
