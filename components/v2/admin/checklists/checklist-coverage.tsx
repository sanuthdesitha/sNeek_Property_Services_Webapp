"use client";

/**
 * ESTATE — Checklist coverage (board "Checklist coverage", 2026-11-17).
 * Every active property with its checklist status: tiles that filter (approved,
 * draft, needs review, none, amenities not captured), checkbox selection with
 * a bulk bar, ONE header action for "the ones with none", tier A before any
 * drafts are created, and the client survey link popover with its expiry date
 * (copy, and "Email it to the client": email only, through the email design
 * system). "Open forms" lands on the property's Checklist and forms tab.
 *
 * Endpoints:
 *   GET   /api/admin/checklist-coverage                          → { properties }
 *   POST  /api/admin/checklist-coverage           { propertyIds }→ { created, skipped, results }
 *   POST  /api/admin/checklist-coverage/amenities-links { propertyIds } → { results }
 *   POST  /api/admin/properties/:id/amenities-link              → { url, expiresAt }
 *   POST  /api/admin/properties/:id/amenities-link/email { token, idempotencyKey }
 *
 * A property with no checklist is not blocked from jobs (cleaners get the job
 * type form) and a checklist that needs review stays in use until reviewed.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EButton, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EFilterBar, EFilterBarInlineOnly } from "@/components/v2/ui/filter-bar";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EstatePortal } from "@/components/v2/ui/portal-root";
import { toneNoticeClass, toneRowCellClass, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import {
  STATUS_WORDS,
  TILE_LABEL,
  layoutWords,
  matchesSearch,
  matchesTile,
  oldestDraftDays,
  statusOf,
  tileCounts,
  type CoverageRow,
  type CoverageTile,
} from "./coverage-model";

type LoadState = { status: "loading" | "failed" | "ready"; error: string | null };
type BulkOutcome = { created: number; skipped: number; createdNames: string[]; skippedNames: string[]; createdBy: string | null; at: string | null };
type AmenitiesFilter = "any" | "captured" | "missing";

const DAY = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Sydney" });
const DAY_TIME = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" });
const TILES: readonly CoverageTile[] = ["all", "APPROVED", "DRAFT", "STALE", "NONE", "no-amenities"];

function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function tileTone(tile: CoverageTile): string {
  if (tile === "NONE") return toneRowCellClass("problem");
  if (tile === "DRAFT" || tile === "STALE") return toneRowCellClass("attention");
  return "";
}

function tileNote(tile: CoverageTile, counts: Record<CoverageTile, number>, oldest: number | null, filtered: boolean): string {
  switch (tile) {
    case "all":
      return filtered ? "show all" : "showing all";
    case "APPROVED":
      return "in use by cleaners";
    case "DRAFT":
      return oldest === null ? "waiting for approval" : `oldest ${oldest} day${oldest === 1 ? "" : "s"}`;
    case "STALE":
      return "property changed after approval";
    case "NONE":
      return "cleaners get the job type form only";
    default:
      return counts["no-amenities"] > 0 ? "ask the client with a survey link" : "all captured";
  }
}

function reasonOf(row: CoverageRow): string | null {
  const status = statusOf(row);
  if (status === "DRAFT") return day(row.profileCreatedAt) ? `created ${day(row.profileCreatedAt)}` : null;
  if (status === "STALE") return day(row.profileUpdatedAt) ? `amenities changed ${day(row.profileUpdatedAt)}` : "amenities changed";
  return null;
}

function SurveyLink({ row }: { row: CoverageRow }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "making" | "ready" | "failed"; url?: string; expiresAt?: string; error?: string }>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState<{ status: "idle" | "sending" | "sent" | "failed"; text?: string }>({ status: "idle" });
  const emailKey = useRef(newKey());
  const titleId = useId();

  async function make() {
    setState({ status: "making" });
    setCopied(false);
    setEmail({ status: "idle" });
    emailKey.current = newKey();
    try {
      const res = await fetch(`/api/admin/properties/${row.id}/amenities-link`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.url !== "string") throw new Error(body.error ?? "The link could not be made.");
      setState({ status: "ready", url: body.url, expiresAt: body.expiresAt });
    } catch (cause) {
      setState({ status: "failed", error: cause instanceof Error ? cause.message : "The link could not be made." });
    }
  }

  async function copy() {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function sendEmail() {
    if (!state.url) return;
    const token = state.url.split("/").pop() ?? "";
    setEmail({ status: "sending" });
    try {
      const res = await fetch(`/api/admin/properties/${row.id}/amenities-link/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, idempotencyKey: emailKey.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Not sent (${res.status}).`);
      const words =
        body.state === "provider_accepted" ? `Handed to the email provider for ${body.to}. That is not proof it arrived.`
        : body.state === "already_requested" ? "Already sent for this link."
        : body.state === "skipped" ? "Not sent: this address is on the do-not-email list or email is switched off for clients."
        : "Not sent: the email provider refused it.";
      setEmail({ status: body.state === "provider_accepted" || body.state === "already_requested" ? "sent" : "failed", text: words });
    } catch (cause) {
      setEmail({ status: "failed", text: cause instanceof Error ? cause.message : "Not sent." });
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next && state.status === "idle") void make(); }}>
      <Popover.Trigger asChild>
        <button type="button" className="min-h-9 px-2 text-[0.8125rem] font-[550] text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))] max-sm:min-h-11">
          Client link
        </button>
      </Popover.Trigger>
      <EstatePortal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          aria-labelledby={titleId}
          className="z-[70] w-[22rem] max-w-[calc(100vw-2rem)] rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.8125rem] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-3)]"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 id={titleId} className="font-[600]">Amenities survey · {row.name}</h3>
            <Popover.Close aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[hsl(var(--e-surface-raised))]"><X className="h-4 w-4" /></Popover.Close>
          </div>
          <p className="mt-1 text-[hsl(var(--e-text-secondary))]">For {row.clientName || "the client"} to tell us what the property has. Answers fill the Amenities column.</p>
          {state.status === "making" ? <p role="status" className="mt-3">Making the link…</p> : null}
          {state.status === "failed" ? (
            <div role="alert" className="mt-3 space-y-2">
              <p className="text-[hsl(var(--e-danger))]">{state.error}</p>
              <EButton size="sm" variant="outline" onClick={() => void make()}>Try again</EButton>
            </div>
          ) : null}
          {state.status === "ready" && state.url ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[0.75rem]" title={state.url}>{state.url}</code>
                <EButton size="sm" variant="outline" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</EButton>
              </div>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                Valid until {day(state.expiresAt) ?? "–"} (14 days). Creating a new link does not cancel this one.{" "}
                {row.clientHasEmail === false ? (
                  <span>The client has no billing email, so it cannot be emailed from here.</span>
                ) : (
                  <button type="button" disabled={email.status === "sending" || email.status === "sent"} onClick={() => void sendEmail()} className="font-[600] text-[hsl(var(--e-primary))] underline disabled:no-underline disabled:opacity-60">
                    {email.status === "sending" ? "Emailing…" : "Email it to the client"}
                  </button>
                )}
              </p>
              {email.text ? <p role={email.status === "failed" ? "alert" : "status"} className={email.status === "failed" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}>{email.text}</p> : null}
            </div>
          ) : null}
        </Popover.Content>
      </EstatePortal>
    </Popover.Root>
  );
}

export function EstateChecklistCoverage() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading", error: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useRestorableState("checklist-coverage:search", "");
  const [storedTile, setTile] = useRestorableState<CoverageTile>("checklist-coverage:tile", "all");
  const [clientFilter, setClientFilter] = useState("");
  const [amenities, setAmenities] = useState<AmenitiesFilter>("any");
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [linksNote, setLinksNote] = useState<string | null>(null);
  const [linksBusy, setLinksBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const tile: CoverageTile = TILES.includes(storedTile) ? storedTile : "all";

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoad((current) => ({ status: "loading", error: current.error }));
    try {
      const res = await fetch("/api/admin/checklist-coverage", { cache: "no-store", signal });
      const body = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(body.error ?? "Coverage could not be loaded. Try again.");
      setRows(Array.isArray(body.properties) ? body.properties : []);
      setLoad({ status: "ready", error: null });
    } catch (cause) {
      if (!signal?.aborted) setLoad({ status: "failed", error: cause instanceof Error ? cause.message : "Coverage could not be loaded. Try again." });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  // A different filter set starts with no selection.
  useEffect(() => {
    setSelected(new Set());
  }, [tile, search, clientFilter, amenities]);

  const ready = load.status === "ready" || rows.length > 0;
  const counts = tileCounts(rows);
  const oldest = oldestDraftDays(rows, new Date());
  const missing = rows.filter((row) => statusOf(row) === "NONE");
  const clients = useMemo(() => Array.from(new Set(rows.map((row) => row.clientName).filter(Boolean))).sort(), [rows]);
  const filtered = rows.filter(
    (row) =>
      matchesTile(row, tile) &&
      matchesSearch(row, search) &&
      (!clientFilter || row.clientName === clientFilter) &&
      (amenities === "any" || (amenities === "captured" ? row.hasFeatures : !row.hasFeatures)),
  );
  const visible = showAll ? filtered : filtered.slice(0, 25);
  const allChecked = visible.length > 0 && visible.every((row) => selected.has(row.id));
  const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? "a property";
  const selectedIds = Array.from(selected);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createDrafts(propertyIds: string[]) {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/checklist-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `the server answered ${res.status}`);
      const results: Array<{ propertyId: string; outcome: string }> = Array.isArray(body.results) ? body.results : [];
      setOutcome({
        created: body.created ?? 0,
        skipped: body.skipped ?? 0,
        createdNames: results.filter((r) => r.outcome === "created").map((r) => nameOf(r.propertyId)),
        skippedNames: results.filter((r) => r.outcome !== "created").map((r) => nameOf(r.propertyId)),
        createdBy: body.createdBy ?? null,
        at: body.at ?? null,
      });
      setConfirm(null);
      setSelected(new Set());
      await reload();
    } catch (cause) {
      // The selection stays, so Try again sends the same list.
      setCreateError(`The drafts were not created: ${cause instanceof Error ? cause.message : "the server could not be reached"}. Nothing changed.`);
    } finally {
      setCreating(false);
    }
  }

  async function copyLinks() {
    setLinksBusy(true);
    setLinksNote(null);
    try {
      const res = await fetch("/api/admin/checklist-coverage/amenities-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds: selectedIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `the server answered ${res.status}`);
      const made = (body.results ?? []).filter((r: { outcome: string }) => r.outcome === "made") as Array<{ name: string; url: string }>;
      const text = made.map((r) => `${r.name}: ${r.url}`).join("\n");
      await navigator.clipboard.writeText(text).catch(() => undefined);
      setLinksNote(`${made.length} client link${made.length === 1 ? "" : "s"} copied, valid 14 days.${made.length < selectedIds.length ? ` ${selectedIds.length - made.length} could not be made.` : ""}`);
    } catch (cause) {
      setLinksNote(`The links were not made: ${cause instanceof Error ? cause.message : "the server could not be reached"}.`);
    } finally {
      setLinksBusy(false);
    }
  }

  const confirmNames = confirm ? confirm.map(nameOf) : [];
  const createLabel = `Create drafts for the ${missing.length} with none…`;
  const headerActions = (
    <>
      <EButton variant="outline" size="sm" onClick={() => void reload()} disabled={load.status === "loading"}>Refresh</EButton>
      {ready && missing.length > 0 ? (
        <EButton size="sm" className="max-sm:hidden" onClick={() => { setCreateError(null); setConfirm(missing.map((row) => row.id)); }}>{createLabel}</EButton>
      ) : null}
    </>
  );

  const activeFilters = [
    ...(tile !== "all" ? [{ key: "tile", label: `Status: ${TILE_LABEL[tile]}`, onRemove: () => setTile("all") }] : []),
    ...(clientFilter ? [{ key: "client", label: `Client: ${clientFilter}`, onRemove: () => setClientFilter("") }] : []),
    ...(amenities !== "any" ? [{ key: "amenities", label: amenities === "captured" ? "Amenities captured" : "Amenities not captured", onRemove: () => setAmenities("any") }] : []),
  ];

  return (
    <div className="min-w-0 space-y-4">
      <EPageHeader
        eyebrow={
          <span>
            <Link href="/v2/admin/forms?tab=blocks" className="underline">Forms</Link> · Checklist blocks · Rollout
          </span>
        }
        title="Checklist coverage"
        description="Which properties have their own checklist, which are drafts waiting for approval, and which have none yet. Drafts are built from the checklist blocks, filtered by each property's amenities."
        actions={headerActions}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Filter by status">
        {TILES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tile === key}
            onClick={() => setTile(key)}
            className={cn(
              "min-w-0 rounded-[var(--e-radius-lg)] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              tile === key ? "border-[hsl(var(--e-primary))] ring-1 ring-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border))]",
              key === "all" && tile === "all" ? "bg-[hsl(var(--e-primary-soft))]" : tileTone(key) || "bg-[hsl(var(--e-surface))]",
            )}
          >
            <span className="block text-[0.75rem]">{TILE_LABEL[key]}</span>
            <span className="e-tnum block font-serif text-[1.625rem] leading-tight">{ready ? counts[key] : "–"}</span>
            <span className="block text-[0.6875rem] opacity-80">{ready ? tileNote(key, counts, oldest, tile !== "all") : "–"}</span>
          </button>
        ))}
      </div>

      <EFilterBar label="Filter properties" active={activeFilters} onClear={() => { setTile("all"); setClientFilter(""); setAmenities("any"); }} resultLabel={`Show ${filtered.length} propert${filtered.length === 1 ? "y" : "ies"}`}>
        <EInput aria-label="Search property, suburb or client" placeholder="Search property, suburb or client" className="w-full sm:w-[18rem] max-sm:h-11 max-sm:text-base" value={search} onChange={(event) => setSearch(event.target.value)} />
        <ESelect aria-label="Client" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="h-9 w-auto max-sm:h-11">
          <option value="">Client: all</option>
          {clients.map((client) => <option key={client} value={client}>{client}</option>)}
        </ESelect>
        <ESelect aria-label="Status" value={tile} onChange={(event) => setTile(event.target.value as CoverageTile)} className="h-9 w-auto max-sm:h-11">
          {TILES.filter((key) => key !== "no-amenities").map((key) => <option key={key} value={key}>Status: {key === "all" ? "all" : TILE_LABEL[key]}</option>)}
        </ESelect>
        <ESelect aria-label="Amenities" value={amenities} onChange={(event) => setAmenities(event.target.value as AmenitiesFilter)} className="h-9 w-auto max-sm:h-11">
          <option value="any">Amenities: all</option>
          <option value="captured">Amenities: captured</option>
          <option value="missing">Amenities: not captured</option>
        </ESelect>
        <EFilterBarInlineOnly>
          {activeFilters.length > 0 ? <EButton variant="ghost" size="sm" onClick={() => { setTile("all"); setClientFilter(""); setAmenities("any"); }}>Clear filters</EButton> : null}
        </EFilterBarInlineOnly>
      </EFilterBar>

      {outcome ? (
        <div role="status" className={cn("flex flex-wrap items-start justify-between gap-3 rounded-[var(--e-radius-lg)] px-4 py-3 text-[0.8125rem]", toneNoticeClass("good"))}>
          <div className="min-w-0 space-y-0.5">
            <p className="font-[600]">{outcome.created} draft checklist{outcome.created === 1 ? "" : "s"} created, {outcome.skipped} skipped</p>
            <p>
              {outcome.createdBy ? `Created by ${outcome.createdBy}` : "Created"}
              {outcome.at ? `, ${DAY_TIME.format(new Date(outcome.at))}` : ""}. Each one waits for approval in the property&apos;s Checklist and forms tab; cleaners keep the job type form until then.
            </p>
            {outcome.skippedNames.length > 0 ? <p>Skipped (already set up): {outcome.skippedNames.join(", ")}.</p> : null}
          </div>
          <EButton size="sm" variant="outline" onClick={() => setOutcome(null)}>Done</EButton>
        </div>
      ) : null}
      {linksNote ? <p role="status" className="text-[0.8125rem]">{linksNote}</p> : null}

      <ECard className="min-w-0 overflow-hidden p-0">
        {load.status === "loading" && rows.length === 0 ? (
          <div role="status" className="space-y-2 p-4">
            <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading coverage…</span>
            {[0, 1, 2, 3].map((index) => <div key={index} className="h-11 animate-pulse rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]" />)}
          </div>
        ) : load.status === "failed" && rows.length === 0 ? (
          <div role="alert" className="space-y-2 p-6 text-center text-[0.875rem]">
            <p>Coverage could not be loaded. Try again.</p>
            <EButton size="sm" variant="outline" onClick={() => void reload()}>Try again</EButton>
          </div>
        ) : rows.length > 0 && counts.APPROVED === rows.length && tile === "all" && !search ? (
          <p className="p-6 text-center text-[0.875rem]">All {rows.length} properties have an approved checklist.</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-[0.875rem] text-[hsl(var(--e-text-secondary))]">No properties match. Clear the search.</p>
        ) : (
          <>
            {load.status === "failed" ? (
              <p role="alert" className="border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-danger))]">Coverage could not be refreshed; showing the last one loaded.</p>
            ) : null}
            <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Checklist coverage" tabIndex={0}>
              <table className="w-full min-w-[60rem] text-left text-[0.8125rem]">
                <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2">
                      <input type="checkbox" aria-label="Select all shown" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((row) => row.id)))} />
                    </th>
                    <th scope="col" className="px-4 py-2 font-[550]">Property ↑</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Client</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Layout</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Amenities</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Checklist</th>
                    <th scope="col" className="px-4 py-2 font-[550]">Approved</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--e-border))]">
                  {visible.map((row) => {
                    const status = statusOf(row);
                    const words = STATUS_WORDS[status];
                    const reason = reasonOf(row);
                    const tone = status === "NONE" ? toneRowCellClass("problem") : status === "DRAFT" || status === "STALE" ? toneRowCellClass("attention") : "";
                    return (
                      <tr key={row.id} className={cn(selected.has(row.id) && "bg-[hsl(var(--e-primary-soft))]")}>
                        <td className={cn("px-4 py-2.5", tone)}>
                          <input type="checkbox" aria-label={`Select ${row.name}`} className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                        </td>
                        <th scope="row" className={cn("px-4 py-2.5 text-left font-normal", tone)}>
                          <span className="block font-[600]">{row.name}</span>
                          <span className="block text-[0.75rem] opacity-80">{row.suburb}</span>
                        </th>
                        <td className="px-4 py-2.5">{row.clientName || "–"}</td>
                        <td className="px-4 py-2.5">{layoutWords(row)}</td>
                        <td className="px-4 py-2.5"><EPill tone={row.hasFeatures ? "info" : "neutral"}>{row.hasFeatures ? "Captured" : "Not captured"}</EPill></td>
                        <td className="px-4 py-2.5">
                          <EPill tone={words.tone}>{words.label}</EPill>
                          {reason ? <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{reason}</span> : null}
                        </td>
                        <td className="px-4 py-2.5">{day(row.approvedAt) ?? (status === "NONE" ? "Never" : "Not yet")}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <SurveyLink row={row} />
                            <EButton size="sm" variant="outline" asChild>
                              <Link href={`/v2/admin/properties/${row.id}?tab=checklist`}>Open forms</Link>
                            </EButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden" aria-label="Checklist coverage">
              {visible.map((row) => {
                const status = statusOf(row);
                const words = STATUS_WORDS[status];
                const reason = reasonOf(row);
                return (
                  <li key={row.id} className={cn("space-y-2 px-4 py-3", status === "NONE" ? tonePhoneBandClass("problem") : status === "DRAFT" || status === "STALE" ? tonePhoneBandClass("attention") : "")}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" aria-label={`Select ${row.name}`} className="mt-1 h-5 w-5 accent-[hsl(var(--e-primary))]" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-[600]">{row.name}</p>
                        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{row.suburb} · {row.clientName || "–"} · {layoutWords(row)}</p>
                      </div>
                      <EPill tone={words.tone}>{words.label}</EPill>
                    </div>
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                      Amenities {row.hasFeatures ? "captured" : "not captured"} · Approved {day(row.approvedAt) ?? (status === "NONE" ? "never" : "not yet")}{reason ? ` · ${reason}` : ""}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <SurveyLink row={row} />
                      <EButton size="sm" variant="outline" asChild><Link href={`/v2/admin/properties/${row.id}?tab=checklist`}>Open forms</Link></EButton>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              <span className="min-w-0">{visible.length} of {filtered.length} · sorted by property · tinted rows need a person: wine for no checklist, honey for a draft or review, with the reason in the pill</span>
              {filtered.length > visible.length ? <button type="button" className="min-h-11 font-[600] text-[hsl(var(--e-primary))] underline" onClick={() => setShowAll(true)}>Show all {filtered.length}</button> : null}
            </div>
          </>
        )}
      </ECard>

      <EBulkBar
        count={selected.size}
        noun={{ one: "property", many: "properties" }}
        onClear={() => setSelected(new Set())}
        busy={creating || linksBusy}
        summary={<span className="min-w-0 truncate">{selectedIds.slice(0, 3).map(nameOf).join(", ")}{selectedIds.length > 3 ? ` and ${selectedIds.length - 3} more` : ""}</span>}
        note="Properties that already have a checklist are skipped and counted as skipped (already set up), never replaced."
      >
        <EBulkButton onClick={() => { setCreateError(null); setConfirm(selectedIds); }}>Create {selected.size} draft{selected.size === 1 ? "" : "s"}…</EBulkButton>
        <EBulkButton onClick={() => void copyLinks()}>Copy {selected.size} client link{selected.size === 1 ? "" : "s"}</EBulkButton>
      </EBulkBar>

      <EPhoneActionBar
        label="Checklist coverage actions"
        hidden={selected.size > 0 || !ready || missing.length === 0}
        primary={<EButton className="w-full" onClick={() => { setCreateError(null); setConfirm(missing.map((row) => row.id)); }}>{createLabel}</EButton>}
      />

      <EConfirmDialog
        open={confirm !== null}
        onClose={() => { if (!creating) setConfirm(null); }}
        tier="ordinary"
        title={`Create ${confirm?.length ?? 0} draft checklist${confirm?.length === 1 ? "" : "s"}?`}
        description={`For ${confirmNames.slice(0, 2).join(", ")}${confirmNames.length > 2 ? ` and ${confirmNames.length - 2} more` : ""}, from the checklist blocks and their amenities. Each waits for approval; cleaners keep the job type form until then.`}
        confirmLabel="Create drafts"
        busy={creating}
        error={createError}
        onConfirm={() => (confirm ? createDrafts(confirm) : undefined)}
      />
    </div>
  );
}
