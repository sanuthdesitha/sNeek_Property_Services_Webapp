import type { StayPreparation } from "./stay-preparation";
export function stayPreparationText(plan: StayPreparation): string {
  const quantity = (value: number | null) => value === null ? "Unknown" : String(value);
  return ["Stay preparation — planning estimate", `Job: ${plan.jobId}`, `Generated: ${plan.generatedAt}`,
    `Incoming stay: ${plan.startDate ?? "Unknown"} to ${plan.endDate ?? "Unknown"}; ${quantity(plan.nights)} nights (${plan.staySource}).`,
    `Prepare for: ${quantity(plan.guests)} guests (${plan.guestBasis === "PROPERTY_MAX" ? "property maximum fallback; booking count unknown" : plan.guestBasis}).`,
    plan.towelInstruction,
    "Estimates do not deduct inventory, reserve stock, place orders, or confirm completion. Remaining means estimated demand less cleaner-reported supplied/used; unrecorded usage remains unknown. A ledger deduction alone does not prove supply.",
    ...plan.rows.map(row => `${row.name} (${row.unit}): estimated ${quantity(row.estimated)}; verified available ${quantity(row.available)}; cleaner-reported supplied/used ${quantity(row.supplied)}; remaining estimate ${quantity(row.remaining)}. Ledger deduction for this job ${quantity(row.ledgerUsed)}. Ledger balance ${row.ledgerCount} at ${row.ledgerAt}. ${row.reliability}. Observed: ${row.observedAt ?? "Unknown"}. Urgent report: ${row.reportId ?? "None"}${row.reportStage ? ` (${row.reportStage})` : ""}.`),
  ].filter(Boolean).join("\n\n");
}
export function stayPreparationPrintHtml(plans: StayPreparation[]) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stay preparation estimate</title><style>body{font:14px sans-serif;margin:32px}pre{white-space:pre-wrap;line-height:1.5;break-after:page}</style></head><body>${plans.map(plan => `<pre>${escape(stayPreparationText(plan))}</pre>`).join("")}</body></html>`;
}
