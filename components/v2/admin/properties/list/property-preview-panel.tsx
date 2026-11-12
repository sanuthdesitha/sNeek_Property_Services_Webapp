"use client";

/**
 * The property preview beside the list (`?open=<id>`), as drawn: name,
 * address and client, "Open property" and the more menu, the cover photo,
 * tabs Overview / Jobs / Care / Access / More, then Next cleans, Property care
 * due and Recent. Read from GET /api/admin/properties/:id/preview; a newer
 * property aborts the older read.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import type { PropertyPreview } from "@/lib/properties/preview-types";
import { propertyHref } from "@/lib/properties/links";
import { PropertyMoreMenu } from "../property-more-menu";
import { PreviewAccess, PreviewCare, PreviewJobs, PreviewOverview } from "./property-preview-sections";

type PanelTab = "overview" | "jobs" | "care" | "access";
const TABS: Array<{ key: PanelTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "care", label: "Care" },
  { key: "access", label: "Access" },
];

type Load = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; preview: PropertyPreview };

export function PropertyPreviewPanel({ propertyId, timeZone, onClose, onArchived }: { propertyId: string; timeZone: string; onClose: () => void; onArchived: () => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<PanelTab>("overview");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/preview`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (PropertyPreview & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || body.error) throw new Error(body?.error ?? `Could not load the property (${response.status}).`);
        setLoad({ status: "ready", preview: body });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "failed", message: error instanceof Error ? error.message : "Could not load the property." });
      });
    return () => controller.abort();
  }, [propertyId, revision]);

  const preview = load.status === "ready" ? load.preview : null;
  const name = preview?.name ?? "Property";

  return (
    <ESidePanel
      open
      label="Property preview"
      title={name}
      subtitle={preview ? <>{preview.address}{preview.suburb && !preview.address.includes(preview.suburb) ? `, ${preview.suburb}` : ""}<br />{preview.client.name}</> : null}
      onClose={onClose}
      toolbar={
        <>
          <EButton asChild size="sm">
            <Link href={propertyHref(propertyId)}>Open property</Link>
          </EButton>
          {preview ? <PropertyMoreMenu propertyId={propertyId} propertyName={preview.name} onArchived={onArchived} /> : null}
        </>
      }
    >
      {load.status === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading property…</p> : null}
      {load.status === "failed" ? (
        <div role="alert" className="space-y-2 text-[0.8125rem]">
          <p className="text-[hsl(var(--e-danger))]">{load.message}</p>
          <EButton size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Try again</EButton>
        </div>
      ) : null}
      {preview ? (
        <>
          {preview.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.imageUrl} alt="Cover photo" className="h-[120px] w-full rounded-[10px] object-cover" />
          ) : (
            <div aria-label="No cover photo" className="h-[120px] rounded-[10px] bg-[hsl(var(--e-gold-soft))]" />
          )}
          <div role="tablist" aria-label="Property preview sections" className="flex items-center gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))]">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={
                  "-mb-px min-h-[2.25rem] whitespace-nowrap border-b-2 px-2.5 text-[0.8125rem] " +
                  (tab === item.key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]")
                }
              >
                {item.label}
              </button>
            ))}
            <ERowMenu
              label="More sections"
              trigger={<span className="px-1 text-[0.8125rem]">More ▾</span>}
              items={[
                { key: "checklist", label: "Checklist and forms", href: propertyHref(propertyId, "checklist") },
                { key: "stock", label: "Stock", href: propertyHref(propertyId, "stock") },
                { key: "billing", label: "Billing rates", href: propertyHref(propertyId, "billing") },
                { key: "planning", label: "Care and planning", href: propertyHref(propertyId, "care") },
              ]}
            />
          </div>
          <div role="tabpanel" aria-label={TABS.find((item) => item.key === tab)?.label} className="flex flex-col gap-3">
            {tab === "overview" ? <PreviewOverview preview={preview} timeZone={timeZone} /> : null}
            {tab === "jobs" ? <PreviewJobs preview={preview} /> : null}
            {tab === "care" ? <PreviewCare preview={preview} /> : null}
            {tab === "access" ? <PreviewAccess preview={preview} /> : null}
          </div>
        </>
      ) : null}
    </ESidePanel>
  );
}
