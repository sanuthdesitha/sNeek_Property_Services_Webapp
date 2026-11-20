"use client";

/**
 * Properties › Devices needing attention (2026-11-20): battery devices across
 * properties that are low, need charging with no clean scheduled, could not be
 * charged at the last clean, are offline, out of date or not known, or whose
 * provider connection is not working. Rendered inside the page's lazy
 * disclosure, so it loads only when opened. Each row opens the property's
 * Care and planning tab, where the Devices panel is.
 */
import * as React from "react";
import Link from "next/link";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ATTENTION_LABEL, batteryText, PROVIDER_LABEL, type DeviceAttentionRow } from "@/lib/property-devices/types";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: DeviceAttentionRow[]; brokenProviders: string[] };

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

export function DevicesAttentionList({ timeZone }: { timeZone: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const requestRef = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoad({ status: "loading" });
    try {
      const response = await fetch("/api/admin/property-devices/attention", { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as { rows?: DeviceAttentionRow[]; brokenProviders?: string[]; error?: string } | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(body?.rows)) throw new Error(body?.error ?? "Could not load the devices.");
      setLoad({ status: "ready", rows: body!.rows!, brokenProviders: body?.brokenProviders ?? [] });
    } catch (error) {
      if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the devices." });
    }
  }, []);

  React.useEffect(() => {
    void reload();
    return () => requestRef.current?.abort();
  }, [reload]);

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading devices…</p>;
  if (load.status === "error") {
    return (
      <EAlert tone="danger" title="Could not load">
        {load.message} <EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton>
      </EAlert>
    );
  }
  return (
    <div className="min-w-0 space-y-3">
      {load.brokenProviders.length ? (
        <EAlert tone="danger" title="Provider connection not working">
          {load.brokenProviders.map((provider) => PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL] ?? provider).join(" and ")}: readings from it are going out of date. Enter battery levels by hand on each property, and check Settings, Ring and Minut devices.
        </EAlert>
      ) : null}
      {load.rows.length === 0 ? <p className={MUTED}>No device needs attention.</p> : (
        <ul>
          {load.rows.map((row) => (
            <li key={row.deviceId} className="flex flex-wrap items-start justify-between gap-2 border-t border-[hsl(var(--e-border))] py-2.5 first:border-t-0">
              <div className="min-w-0">
                <Link href={`/v2/admin/properties/${row.propertyId}?tab=care`} className="break-words text-[0.875rem] font-[600] underline-offset-2 hover:underline">{row.propertyName} · {row.deviceName}</Link>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {PROVIDER_LABEL[row.provider]} · {batteryText(row.lastBatteryPercent)}
                  {row.lastReadingAt ? ` · read ${new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(row.lastReadingAt))}` : " · no reading"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {row.reasons.map((reason) => <EPill key={reason} tone={reason === "LOW" || reason === "NO_CLEAN_SCHEDULED" || reason === "COULD_NOT_CHARGE" || reason === "CONNECTION_BROKEN" ? "bad" : "warn"}>{ATTENTION_LABEL[reason]}</EPill>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
