"use client";

/**
 * People › Laundry partners and suppliers: the supplier records, read-only.
 * One place edits them (owner decision 2026-11-12): Inventory › Suppliers.
 * Reads the same directory that page uses; loading, failure and empty are
 * separate states, and an unmounted read is cancelled.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { SUPPLIER_KIND_LABELS, laundryRunsHref, type SupplierDirectoryResponse, type SupplierDirectoryRow } from "@/lib/suppliers/directory-types";

const SUPPLIERS_HREF = "/v2/admin/inventory?tab=suppliers";

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; rows: SupplierDirectoryRow[] };

function contactOf(row: SupplierDirectoryRow): string {
  const email = row.stock?.email ?? row.laundry?.email;
  const phone = row.stock?.phone ?? row.laundry?.phone;
  return [email, phone].filter(Boolean).join(" · ") || "No contact on file";
}

function isActive(row: SupplierDirectoryRow): boolean {
  return Boolean(row.stock?.isActive ?? row.laundry?.isActive);
}

export function SuppliersSection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch("/api/admin/inventory/suppliers/directory", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (SupplierDirectoryResponse & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error ?? `Could not load suppliers (${response.status}).`);
        setState({ status: "ready", rows: body.rows });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "failed", message: error instanceof Error ? error.message : "Could not load suppliers." });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section aria-labelledby="people-suppliers" className="flex flex-col gap-3 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="people-suppliers" className="text-[0.9375rem] font-[600]">Supplier records</h2>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Stock suppliers and laundry partners. Edited in Inventory › Suppliers.</p>
        </div>
        <EButton asChild size="sm" variant="outline">
          <Link href={SUPPLIERS_HREF}>Open Suppliers</Link>
        </EButton>
      </div>
      {state.status === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading suppliers…</p> : null}
      {state.status === "failed" ? (
        <EAlert tone="danger">
          {state.message} <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </EAlert>
      ) : null}
      {state.status === "ready" && state.rows.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No suppliers yet. Add them in Inventory › Suppliers.</p> : null}
      {state.status === "ready" && state.rows.length > 0 ? (
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {state.rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[0.8125rem]">
              <div className="min-w-0">
                <p className="font-[600]">{row.name}</p>
                <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{SUPPLIER_KIND_LABELS[row.kind]} · {contactOf(row)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.laundry ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.laundry.team.length} login{row.laundry.team.length === 1 ? "" : "s"} · {row.laundry.runCount} runs</span> : null}
                <EPill tone={isActive(row) ? "ok" : "neutral"}>{isActive(row) ? "Active" : "Inactive"}</EPill>
                {row.laundry ? <Link className="text-[0.75rem] underline" href={laundryRunsHref(row.laundry.id)}>Runs</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
