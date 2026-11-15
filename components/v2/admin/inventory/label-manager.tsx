"use client";

/**
 * SHELF LABELS: three numbered steps (board "Shelf labels", 2026-11-17).
 *
 *   1 Make labels    where the label goes (a property or General), find items,
 *                    tick them, "Make N labels". Items already labelled for
 *                    that place are marked BEFORE pressing Make and cannot be
 *                    ticked: a label is made once per item and place, because
 *                    re-making would orphan the tag already on the shelf.
 *   2 Labels for X   every label for that place; newly made ones carry
 *                    "Made just now" and come ticked for printing. Select all,
 *                    Clear, filter by item or code.
 *   3 Print N        Barcode (default) or QR, Many per page (3 across on plain
 *                    A4, as before) or One per page, and a real A4 preview of
 *                    what prints. Nothing ticked: Print is off.
 *
 * Nothing on this page deletes, retires or replaces a label (owner default:
 * old labels keep scanning). Changing the place clears both ticks and keeps
 * the item search; its read is cancelled and a late answer for another place
 * is ignored. Make is all or nothing on the server; while it runs every field
 * and the place are frozen; a failed Make keeps the ticks.
 */

import * as React from "react";
import { Plus, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { ENote } from "@/components/v2/ui/form-dialog-parts";
import { LabelSheet, LABELS_PER_SHEET, type LabelLayout, type PrintableLabel } from "@/components/v2/inventory/label-sheet";
import { DEFAULT_SYMBOLOGY, type BarcodeSymbology } from "@/lib/inventory/label-codes";

type LabelRow = {
  id: string;
  code: string;
  packSize: number;
  isActive: boolean;
  item: { id: string; name: string; unit: string | null; category: string | null };
  property: { id: string; name: string; suburb: string | null } | null;
};

type ItemRow = { id: string; name: string; category: string; unit: string };

type PropertyOption = { id: string; name: string };

type Loaded = { labels: LabelRow[]; items: ItemRow[]; truncated: boolean };

type LoadState = { status: "loading" } | { status: "failed" } | { status: "ready"; data: Loaded };

type MakeOutcome = { kind: "made"; made: number; skipped: number; place: string } | { kind: "failed"; ticked: number } | null;

const GENERAL = "GENERAL";
const ITEM_LIMIT = 200;
const LABELS_SHOWN = 8;
const MUTED = "text-[hsl(var(--e-text-secondary))]";
const FIELD = "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] [color-scheme:inherit] max-sm:h-11 max-sm:text-[1rem]";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function StepTitle({ number, children, aside }: { number: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2.5 text-[1rem] font-[650]">
        <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--e-primary))] text-[0.75rem] font-bold text-[hsl(var(--e-primary-foreground))]">{number}</span>
        <span><span className="sr-only">Step {number}: </span>{children}</span>
      </h2>
      {aside ? <div className={cn("text-[0.75rem]", MUTED)}>{aside}</div> : null}
    </div>
  );
}

/** Two or three choices as one segmented control (native radios, so arrow keys work). */
function Segmented<T extends string>({ legend, name, value, options, onChange, hint }: { legend: string; name: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void; hint?: string }) {
  const hintId = React.useId();
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className="mb-1.5 text-[0.75rem] font-[600]">{legend}</legend>
      <div className="flex gap-0.5 rounded-[10px] bg-[hsl(var(--e-muted))] p-[3px]">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-3 text-[0.8125rem] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))] max-sm:min-h-11",
              value === option.value ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : MUTED,
            )}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p id={hintId} className={cn("text-[0.75rem]", MUTED)}>{hint}</p> : null}
    </fieldset>
  );
}

function GreyRows({ count }: { count: number }) {
  return (
    <ul aria-hidden className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-3 py-3"><span className="h-4 w-4 rounded bg-[hsl(var(--e-surface-raised))]" /><span className="h-3 flex-1 animate-pulse rounded bg-[hsl(var(--e-surface-raised))]" /></li>
      ))}
    </ul>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function LabelManager({ properties }: { properties: PropertyOption[] }) {
  const [scope, setScope] = React.useState<string>(GENERAL);
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" });
  const [reload, setReload] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [labelFilter, setLabelFilter] = React.useState("");
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [selectedLabels, setSelectedLabels] = React.useState<Set<string>>(new Set());
  const [madeNow, setMadeNow] = React.useState<Set<string>>(new Set());
  const [showAllLabels, setShowAllLabels] = React.useState(false);
  const [symbology, setSymbology] = React.useState<BarcodeSymbology>(DEFAULT_SYMBOLOGY);
  const [layout, setLayout] = React.useState<LabelLayout>("sheet");
  const [making, setMaking] = React.useState(false);
  const [outcome, setOutcome] = React.useState<MakeOutcome>(null);
  const scopeRef = React.useRef(scope);
  scopeRef.current = scope;

  const placeName = scope === GENERAL ? "General" : properties.find((property) => property.id === scope)?.name ?? "this property";

  React.useEffect(() => {
    const controller = new AbortController();
    const requested = scope;
    setLoad((current) => (current.status === "ready" && reload > 0 ? current : { status: "loading" }));
    Promise.all([
      fetch(`/api/admin/inventory/labels?propertyId=${encodeURIComponent(requested)}`, { cache: "no-store", signal: controller.signal }),
      fetch("/api/admin/inventory/items", { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([labelRes, itemRes]) => {
        const labelBody = (await labelRes.json().catch(() => null)) as { labels?: LabelRow[]; truncated?: boolean } | null;
        const itemBody = (await itemRes.json().catch(() => null)) as ItemRow[] | { items?: ItemRow[] } | null;
        if (controller.signal.aborted || scopeRef.current !== requested) return;
        const items = Array.isArray(itemBody) ? itemBody : itemBody?.items;
        if (!labelRes.ok || !itemRes.ok || !Array.isArray(labelBody?.labels) || !Array.isArray(items)) {
          setLoad({ status: "failed" });
          return;
        }
        setLoad({ status: "ready", data: { labels: labelBody.labels, items, truncated: labelBody.truncated === true } });
      })
      .catch(() => {
        if (!controller.signal.aborted && scopeRef.current === requested) setLoad({ status: "failed" });
      });
    return () => controller.abort();
    // `reload` re-reads the same place; a new place starts from loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, reload]);

  function changeScope(next: string) {
    setScope(next);
    setSelectedItems(new Set());
    setSelectedLabels(new Set());
    setMadeNow(new Set());
    setOutcome(null);
    setShowAllLabels(false);
    setReload(0);
  }

  const data = load.status === "ready" ? load.data : null;
  const labelledHere = React.useMemo(() => new Set((data?.labels ?? []).filter((row) => row.isActive).map((row) => row.item.id)), [data]);

  const matchingItems = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true));
  }, [data, search]);
  const visibleItems = matchingItems.slice(0, ITEM_LIMIT);
  const makeCount = Array.from(selectedItems).filter((id) => !labelledHere.has(id)).length;

  const orderedLabels = React.useMemo(() => {
    const rows = data?.labels ?? [];
    const needle = labelFilter.trim().toLowerCase();
    const filtered = needle ? rows.filter((row) => row.item.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle)) : rows;
    return [...filtered.filter((row) => madeNow.has(row.id)), ...filtered.filter((row) => !madeNow.has(row.id))];
  }, [data, labelFilter, madeNow]);
  const shownLabels = showAllLabels ? orderedLabels : orderedLabels.slice(0, LABELS_SHOWN);
  const totalLabels = data?.labels.length ?? 0;

  const printable: PrintableLabel[] = (data?.labels ?? [])
    .filter((row) => selectedLabels.has(row.id))
    .sort((a, b) => Number(madeNow.has(b.id)) - Number(madeNow.has(a.id)))
    .map((row) => ({ code: row.code, itemName: row.item.name, propertyName: row.property?.name ?? null, unit: row.item.unit }));

  async function make() {
    const ids = Array.from(selectedItems).filter((id) => !labelledHere.has(id));
    if (ids.length === 0 || making) return;
    const place = placeName;
    const requested = scope;
    setMaking(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/admin/inventory/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: ids, ...(requested !== GENERAL ? { propertyId: requested } : {}) }),
      });
      const body = (await response.json().catch(() => null)) as { created?: Array<{ id: string }>; skipped?: number } | null;
      if (!response.ok || !Array.isArray(body?.created)) {
        setOutcome({ kind: "failed", ticked: ids.length });
        return;
      }
      const fresh = new Set(body.created.map((row) => row.id));
      setOutcome({ kind: "made", made: fresh.size, skipped: body.skipped ?? 0, place });
      setSelectedItems(new Set());
      // Newly made labels come ticked for printing (as before); the tag says why.
      setMadeNow(fresh);
      setSelectedLabels(fresh);
      setShowAllLabels(false);
      setReload((value) => value + 1);
    } catch {
      setOutcome({ kind: "failed", ticked: ids.length });
    } finally {
      setMaking(false);
    }
  }

  const loading = load.status === "loading";
  const failed = load.status === "failed";

  return (
    <div className="space-y-5">
      {failed ? (
        <ECard role="alert" className="space-y-2 p-4">
          <p className="text-[0.875rem] font-[600]">Labels could not be loaded.</p>
          <p className={cn("text-[0.8125rem]", MUTED)}>Nothing is shown rather than an empty list that invites making duplicates.</p>
          <EButton size="sm" variant="outline" onClick={() => { setLoad({ status: "loading" }); setReload((value) => value + 1); }}>Try again</EButton>
        </ECard>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Step 1 ─────────────────────────────────────────────────── */}
        <ECard className="min-w-0 space-y-3 p-5 max-sm:p-4" aria-labelledby="labels-step-1">
          <div id="labels-step-1"><StepTitle number={1} aside="a label is made once per item and place">Make labels</StepTitle></div>
          <fieldset disabled={making} className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0 space-y-1">
                <span className="text-[0.75rem] font-[600]">Where the label goes</span>
                <select value={scope} onChange={(event) => changeScope(event.target.value)} className={FIELD} aria-describedby="labels-place-hint">
                  <option value={GENERAL}>General (any property)</option>
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-[0.75rem] font-[600]">Find an item</span>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items" className={FIELD} />
              </label>
            </div>
            <p id="labels-place-hint" className={cn("text-[0.75rem]", MUTED)}>A property label means &ldquo;this item at this property&rdquo;. General works at any property, for the store room or the van.</p>

            {loading ? <GreyRows count={6} /> : data ? (
              visibleItems.length === 0 ? (
                <p className={cn("rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]", MUTED)}>{data.items.length === 0 ? "No stock items yet. Add items in Stock first." : `No items match “${search}”.`}</p>
              ) : (
                <ul aria-label="Items" className="max-h-80 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                  {visibleItems.map((item) => {
                    const done = labelledHere.has(item.id);
                    return (
                      <li key={item.id} className={cn(done && "bg-[hsl(var(--e-surface-raised))]")}>
                        <label className={cn("flex min-h-11 items-center gap-3 px-3 py-2", done ? "cursor-not-allowed" : "cursor-pointer")}>
                          <input type="checkbox" checked={!done && selectedItems.has(item.id)} disabled={done} onChange={() => setSelectedItems((current) => toggle(current, item.id))} className="h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" aria-describedby={done ? `labelled-${item.id}` : undefined} />
                          <span className={cn("min-w-0 flex-1 truncate text-[0.875rem]", done && MUTED)}>{item.name}</span>
                          {done ? <span id={`labelled-${item.id}`} className="shrink-0 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Already labelled here</span> : null}
                          <span className={cn("shrink-0 text-[0.75rem]", MUTED)}>{item.unit}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
            {data && matchingItems.length > ITEM_LIMIT ? <p className={cn("text-[0.75rem]", MUTED)}>Showing {ITEM_LIMIT} of {matchingItems.length} items; search to find the rest.</p> : null}

            <div className="flex flex-wrap items-center gap-3">
              <EButton variant="gold" onClick={() => void make()} disabled={making || !data || makeCount === 0}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {making ? "Making labels…" : makeCount > 0 ? `Make ${plural(makeCount, "label")}` : "Make labels"}
              </EButton>
              <p className={cn("min-w-0 flex-1 text-[0.75rem]", MUTED)}>A label is never made twice for the same place: the one on the shelf would stop scanning.</p>
            </div>
          </fieldset>
          {outcome?.kind === "made" ? (
            <p role="status" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-sidebar-bg))] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-sidebar-fg))]">
              {outcome.made > 0 ? `${plural(outcome.made, "label")} made and ticked for printing.` : "No labels made."}
              {outcome.skipped > 0 ? ` ${outcome.skipped} skipped: already labelled for ${outcome.place}.` : ""}
            </p>
          ) : null}
          {outcome?.kind === "failed" ? (
            <ENote tone="problem" role="alert">The labels were not made. Your {plural(outcome.ticked, "ticked item")} {outcome.ticked === 1 ? "is" : "are"} still ticked; try again, nothing is half made.</ENote>
          ) : null}
        </ECard>

        {/* ── Step 2 ─────────────────────────────────────────────────── */}
        <ECard className="min-w-0 space-y-3 p-5 max-sm:p-4" aria-labelledby="labels-step-2">
          <div id="labels-step-2">
            <StepTitle number={2} aside={data ? `${selectedLabels.size} selected` : undefined}>
              {scope === GENERAL ? "General labels" : `Labels for ${placeName}`}
              {data ? <span className="ml-2 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]">{totalLabels}</span> : null}
            </StepTitle>
          </div>
          {loading ? <GreyRows count={5} /> : data && totalLabels === 0 ? (
            <p className={cn("rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-4 text-[0.8125rem]", MUTED)}>No labels for {placeName} yet. Tick items in step 1 and make them.</p>
          ) : data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <EButton size="sm" variant="outline" onClick={() => setSelectedLabels(new Set(data.labels.map((row) => row.id)))}>Select all {totalLabels}</EButton>
                <EButton size="sm" variant="outline" onClick={() => setSelectedLabels(new Set())} disabled={selectedLabels.size === 0}>Clear</EButton>
                <label className="ml-auto min-w-0 max-sm:ml-0 max-sm:w-full">
                  <span className="sr-only">Filter labels by item or code</span>
                  <input type="search" value={labelFilter} onChange={(event) => { setLabelFilter(event.target.value); setShowAllLabels(false); }} placeholder="Filter by item or code" className={cn(FIELD, "h-8 sm:w-52")} />
                </label>
              </div>
              {orderedLabels.length === 0 ? (
                <p className={cn("text-[0.8125rem]", MUTED)}>No label matches &ldquo;{labelFilter}&rdquo;.</p>
              ) : (
                <ul aria-label="Labels" className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                  {shownLabels.map((row) => (
                    <li key={row.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                        <input type="checkbox" checked={selectedLabels.has(row.id)} onChange={() => setSelectedLabels((current) => toggle(current, row.id))} className="h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
                        <span className="min-w-0 flex-1 truncate text-[0.875rem]">{row.item.name}</span>
                        {madeNow.has(row.id) ? <span className="shrink-0 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold-soft))] px-2 py-0.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-gold-ink))]">Made just now</span> : null}
                        {!row.isActive ? <span className={cn("shrink-0 text-[0.6875rem]", MUTED)}>Switched off</span> : null}
                        <span className="shrink-0 font-mono text-[0.6875rem] text-[hsl(var(--e-text-secondary))] max-sm:hidden">{row.code}</span>
                      </label>
                    </li>
                  ))}
                  {orderedLabels.length > LABELS_SHOWN ? (
                    <li>
                      <button type="button" onClick={() => setShowAllLabels((value) => !value)} className="min-h-11 w-full px-3 py-2 text-center text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]" aria-expanded={showAllLabels}>
                        {showAllLabels ? "Show fewer" : `Show ${orderedLabels.length - LABELS_SHOWN} more`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
              {data.truncated ? <p className={cn("text-[0.75rem]", MUTED)}>Showing the newest 1,000 labels for this place.</p> : null}
              <p className={cn("text-[0.75rem]", MUTED)}>Every label carries readable text (item, property, code) so a shelf can be counted when a phone will not scan. Labels cannot be deleted here; replacing one that fell off is &ldquo;tick it, print 1&rdquo;.</p>
            </>
          ) : null}
        </ECard>
      </div>

      {/* ── Step 3 (hidden while there are no labels for this place) ───── */}
      {data && totalLabels > 0 ? (
        <ECard className="min-w-0 p-5 max-sm:p-4" aria-labelledby="labels-step-3">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <div id="labels-step-3"><StepTitle number={3}>{printable.length > 0 ? `Print ${plural(printable.length, "label")}` : "Print"}</StepTitle></div>
              <Segmented<BarcodeSymbology>
                legend="Code"
                name="label-code"
                value={symbology}
                onChange={setSymbology}
                options={[{ value: "CODE128", label: "Barcode" }, { value: "QR", label: "QR" }]}
                hint="Barcode (Code 128) is what handheld scanners read. QR reads better at an angle with a phone camera."
              />
              <Segmented<LabelLayout>
                legend="Layout"
                name="label-layout"
                value={layout}
                onChange={setLayout}
                options={[{ value: "sheet", label: "Many per page" }, { value: "single", label: "One per page" }]}
                hint={`Many: 3 across on A4 (${LABELS_PER_SHEET} a page), for setting up a property. One: a single replacement.`}
              />
              <label className="block space-y-1">
                <span className="text-[0.75rem] font-[600]">Paper</span>
                <select className={FIELD} value="a4-plain" onChange={() => undefined} aria-describedby="labels-paper-hint">
                  <option value="a4-plain">A4 plain, 3 across, cut by hand</option>
                </select>
                <span id="labels-paper-hint" className={cn("block text-[0.75rem]", MUTED)}>Other sheet sizes are added only when you tell us which label paper you buy.</span>
              </label>
              <EButton variant="gold" className="w-full" disabled={printable.length === 0} onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden /> {printable.length > 0 ? `Print ${printable.length}` : "Print"}
              </EButton>
              <p className={cn("text-[0.75rem]", MUTED)}>Only the sheet prints: the menu and buttons are hidden, margins are 10 mm, and a label is never split across two pages. Barcodes are drawn sharp, not as screen pictures, so they scan off paper.</p>
            </div>
            <div className="min-w-0 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface-sunken))] p-5 max-sm:p-3">
              {printable.length > 0 ? (
                <div className="mx-auto max-w-[34rem]">
                  <LabelSheet labels={printable} symbology={symbology} layout={layout} />
                </div>
              ) : (
                <div className="mx-auto flex aspect-[210/297] max-w-[34rem] items-center justify-center bg-white p-6 text-center text-[0.8125rem] text-black/60 shadow-[0_2px_10px_hsl(160_30%_10%/0.18)]" role="status">
                  Tick labels in step 2 to see them here.
                </div>
              )}
            </div>
          </div>
        </ECard>
      ) : null}
    </div>
  );
}
