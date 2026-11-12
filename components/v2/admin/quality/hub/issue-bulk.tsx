"use client";

/**
 * Bulk "Mark fixed" for the Issues tab: one request to
 * POST /api/admin/quality/issues/bulk, which answers per row. Refused rows
 * stay selected with their reasons; done and unchanged rows are cleared.
 */
import * as React from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { FIXED_RECTIFICATION_STATUSES, titleCaseKey, type FixedRectificationStatus } from "@/lib/quality/types";
import type { BulkFixResponse } from "@/lib/quality/bulk-fix";

export type BulkOutcomeNote = { id: string; reason: string };

function isBulkResponse(body: unknown): body is BulkFixResponse {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as BulkFixResponse).results);
}

export async function postBulkMarkFixed(ids: string[], status: FixedRectificationStatus): Promise<BulkFixResponse> {
  const response = await fetch("/api/admin/quality/issues/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark-fixed", ids, status }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isBulkResponse(body)) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    throw new Error(typeof error === "string" && error ? error : "The issues could not be marked fixed.");
  }
  return body;
}

export function IssueBulkBar({
  selected,
  onSelectionChange,
  onDone,
  describe,
}: {
  describe: (id: string) => string;
  selected: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  onDone: () => void;
}) {
  const [status, setStatus] = React.useState<FixedRectificationStatus>("FIXED_BY_MANAGER");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [refused, setRefused] = React.useState<BulkOutcomeNote[]>([]);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await postBulkMarkFixed(Array.from(selected), status);
      const stillSelected = result.results.filter((row) => row.outcome === "refused");
      setRefused(stillSelected.map((row) => ({ id: row.id, reason: row.reason ?? "Refused." })));
      onSelectionChange(new Set(stillSelected.map((row) => row.id)));
      const { done, unchanged, refused: refusedCount } = result.summary;
      setMessage(`${done} marked fixed · ${unchanged} unchanged · ${refusedCount} refused`);
      onDone();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The issues could not be marked fixed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <EBulkBar
        count={selected.size}
        noun={{ one: "issue", many: "issues" }}
        busy={busy}
        onClear={() => {
          onSelectionChange(new Set());
          setRefused([]);
        }}
        note="Only issues whose fix is still owed are changed. Add minutes or photos from the issue itself."
      >
        <label className="inline-flex items-center gap-1.5 text-[0.75rem]">
          <span className="sr-only">Fixed by</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as FixedRectificationStatus)}
            className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-sidebar-hairline))] bg-transparent px-2 text-[0.75rem] text-[hsl(var(--e-sidebar-active-bg))] [&>option]:text-black"
          >
            {FIXED_RECTIFICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {titleCaseKey(value)}
              </option>
            ))}
          </select>
        </label>
        <EBulkButton onClick={() => void run()}>{busy ? "Saving…" : "Mark fixed"}</EBulkButton>
      </EBulkBar>
      {message ? (
        <div role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem]">
          <p>{message}</p>
          {refused.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-[hsl(var(--e-text-secondary))]">
              {refused.map((row) => (
                <li key={row.id}>
                  <span className="font-[600]">{describe(row.id)}:</span> {row.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
