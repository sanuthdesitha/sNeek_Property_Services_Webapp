"use client";

/**
 * Forms › Message templates › Message templates (board "Message templates",
 * 2026-11-17). The list is grouped by the category each template already
 * stores, with its channel and where it is used on every row; the editor sits
 * beside it (below it under 1024px; on a phone it replaces the list with a
 * back button). Same endpoints as before:
 *
 *   GET    /api/admin/message-templates          → MessageTemplate[]
 *   GET    /api/admin/message-templates/usage    → { usage }  (automations, campaigns)
 *   POST   /api/admin/message-templates          { name, triggerType, jobType, channel, category, subject, body, isActive }
 *   PATCH  /api/admin/message-templates/[id]     { …, expectedUpdatedAt } (409 when someone saved since)
 *   DELETE /api/admin/message-templates/[id]
 *
 * Unsaved changes are kept when another template is clicked, after a tier A
 * question. Loading, could not load and none yet are separate states; a failed
 * read never shows an empty list.
 */
import * as React from "react";
import { Plus, Search } from "lucide-react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EInput } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { MessageTemplateEditor } from "./message-template-editor";
import {
  EMPTY_DRAFT,
  FIRST_CATEGORIES,
  draftOf,
  groupByCategory,
  isMessageTemplateRecord,
  matchesFilter,
  sameDraft,
  usageSummary,
  type ListFilter,
  type MessageTemplateDraft,
  type MessageTemplateRecord,
  type TemplateUsage,
} from "./message-template-model";

type LoadState = { status: "loading" | "failed" | "ready"; rows: MessageTemplateRecord[] };
type UsageState = { status: "loading" | "failed" | "ready"; usage: Record<string, TemplateUsage> };
type Selection = { id: string | "new"; draft: MessageTemplateDraft } | null;

const FILTERS: ReadonlyArray<{ key: ListFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "off", label: "Switched off" },
];

export function MessageTemplatesWorkspace({ canWrite = true }: { canWrite?: boolean }) {
  const [load, setLoad] = React.useState<LoadState>({ status: "loading", rows: [] });
  const [usage, setUsage] = React.useState<UsageState>({ status: "loading", usage: {} });
  const [attempt, setAttempt] = React.useState(0);
  const [query, setQuery] = useRestorableState("message-templates-workspace:query", "");
  const [storedFilter, setFilter] = useRestorableState<ListFilter>("message-templates-workspace:filter", "all");
  // A remembered value is checked before use.
  const filter: ListFilter = FILTERS.some((option) => option.key === storedFilter) ? storedFilter : "all";
  const [selection, setSelection] = React.useState<Selection>(null);
  const [pending, setPending] = React.useState<{ next: Selection } | null>(null);
  const [showAllCategories, setShowAllCategories] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad((current) => ({ status: "loading", rows: current.rows }));
    fetch("/api/admin/message-templates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body)) throw new Error("load");
        setLoad({ status: "ready", rows: body.filter(isMessageTemplateRecord) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad((current) => ({ status: "failed", rows: current.rows }));
      });
    fetch("/api/admin/message-templates/usage", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { usage?: Record<string, TemplateUsage> } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.usage) throw new Error("usage");
        setUsage({ status: "ready", usage: body.usage });
      })
      .catch(() => {
        if (!controller.signal.aborted) setUsage({ status: "failed", usage: {} });
      });
    return () => controller.abort();
  }, [attempt]);

  const rows = load.rows;
  const record = selection && selection.id !== "new" ? rows.find((row) => row.id === selection.id) ?? null : null;
  const dirty = Boolean(selection && (selection.id === "new" ? !sameDraft(selection.draft, EMPTY_DRAFT) : record && !sameDraft(selection.draft, draftOf(record))));

  // Opening the first template once the list arrives, on wide screens only (a phone keeps the list).
  React.useEffect(() => {
    if (selection || load.status !== "ready" || rows.length === 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches) {
      const first = groupByCategory(rows)[0]?.rows[0];
      if (first) setSelection({ id: first.id, draft: draftOf(first) });
    }
  }, [load.status, rows, selection]);

  function choose(next: Selection) {
    if (dirty && canWrite) {
      setPending({ next });
      return;
    }
    setSelection(next);
  }

  function upsert(saved: MessageTemplateRecord) {
    setLoad((current) => {
      const exists = current.rows.some((row) => row.id === saved.id);
      return { ...current, rows: exists ? current.rows.map((row) => (row.id === saved.id ? saved : row)) : [...current.rows, saved] };
    });
    setSelection({ id: saved.id, draft: draftOf(saved) });
  }

  const visible = rows.filter((row) => matchesFilter(row, filter, query));
  const groups = groupByCategory(visible);
  const shownGroups = showAllCategories || query.trim() ? groups : groups.slice(0, FIRST_CATEGORIES);
  const hiddenGroups = groups.slice(shownGroups.length);
  const offCount = rows.filter((row) => !row.isActive).length;

  const list = (
    <ECard className="min-w-0 overflow-hidden p-0">
      <div className="space-y-3 p-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" aria-hidden="true" />
            <EInput
              type="search"
              aria-label="Search message templates"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, wording or category"
              className="pl-9 max-sm:h-11 max-sm:text-base"
            />
          </div>
          {canWrite ? (
            <EButton size="sm" className="max-sm:hidden" onClick={() => choose({ id: "new", draft: { ...EMPTY_DRAFT } })}>
              <Plus className="h-3.5 w-3.5" /> New
            </EButton>
          ) : null}
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={cn(
                "inline-flex min-h-8 items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[550] max-sm:min-h-11",
                filter === option.key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]",
              )}
            >
              {option.label}
              {option.key === "off" && load.status === "ready" ? ` ${offCount}` : ""}
            </button>
          ))}
        </div>
      </div>

      {load.status === "loading" && rows.length === 0 ? (
        <div role="status" className="space-y-2 border-t border-[hsl(var(--e-border))] p-3">
          <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading message templates…</span>
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-10 animate-pulse rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]" />)}
        </div>
      ) : load.status === "failed" && rows.length === 0 ? (
        <div role="alert" className="space-y-2 border-t border-[hsl(var(--e-border))] p-4 text-[0.8125rem]">
          <p>Message templates could not be loaded. Try again.</p>
          <EButton size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</EButton>
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t border-[hsl(var(--e-border))] p-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          No message templates yet. Create reusable booking, follow-up and feedback messages.
        </p>
      ) : (
        <>
          {load.status === "failed" ? (
            <p role="alert" className="border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-danger))]">
              The list could not be refreshed; showing the last one loaded. <button type="button" className="font-[600] underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </p>
          ) : null}
          {groups.length === 0 ? (
            <p className="border-t border-[hsl(var(--e-border))] p-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">No templates match. Clear the search or choose All.</p>
          ) : null}
          {shownGroups.map((group) => (
            <section key={group.category} aria-labelledby={`category-${group.category}`} className="border-t border-[hsl(var(--e-border))]">
              <h4 id={`category-${group.category}`} className="px-3 pb-1 pt-3 text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">
                {group.label} · {group.rows.length}
              </h4>
              <ul>
                {group.rows.map((row) => {
                  const active = selection?.id === row.id;
                  return (
                    <li key={row.id} className="border-t border-[hsl(var(--e-border))] first:border-t-0">
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => choose({ id: row.id, draft: draftOf(row) })}
                        className={cn(
                          "flex min-h-[3.25rem] w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-[hsl(var(--e-surface-raised))]",
                          active && "bg-[hsl(var(--e-primary-soft))]",
                        )}
                      >
                        <span className="min-w-0">
                          <span className={cn("block break-words text-[0.875rem] font-[550]", !row.isActive && "text-[hsl(var(--e-text-secondary))]")}>{row.name}</span>
                          <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                            {usageSummary(row, usage.usage[row.id], usage.status === "failed")}
                          </span>
                        </span>
                        <EPill tone={row.isActive ? "ok" : "neutral"}>{row.isActive ? "On" : "Off"}</EPill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hiddenGroups.length > 0 ? (
            <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <span className="min-w-0">
                {hiddenGroups.map((group) => group.label).join(", ")} · {hiddenGroups.reduce((sum, group) => sum + group.rows.length, 0)} more
              </span>
              <button type="button" className="min-h-11 font-[600] text-[hsl(var(--e-primary))] underline" onClick={() => setShowAllCategories(true)}>Show</button>
            </div>
          ) : null}
        </>
      )}
    </ECard>
  );

  const editor = selection ? (
    <MessageTemplateEditor
      key={selection.id}
      record={record}
      draft={selection.draft}
      onDraftChange={(draft) => setSelection((current) => (current ? { ...current, draft } : current))}
      usage={record ? usage.usage[record.id] ?? { automations: [], campaigns: [] } : null}
      usageFailed={usage.status === "failed"}
      canWrite={canWrite}
      onSaved={upsert}
      onDeleted={(id) => {
        setLoad((current) => ({ ...current, rows: current.rows.filter((row) => row.id !== id) }));
        setSelection(null);
      }}
      onDiscard={() => setSelection(record ? { id: record.id, draft: draftOf(record) } : null)}
      onBack={() => choose(null)}
    />
  ) : (
    <ECard className="hidden min-w-0 p-6 text-[0.875rem] text-[hsl(var(--e-text-secondary))] lg:block">
      {load.status === "ready" && rows.length === 0 ? "Create a template to start." : "Choose a template to see and edit it."}
    </ECard>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
        {/* On a phone the open editor replaces the list (Back returns to it). */}
        <div className={cn("min-w-0", selection && "max-sm:hidden")}>{list}</div>
        <div className="min-w-0">{editor}</div>
      </div>
      {canWrite && !selection ? (
        <div className="sm:hidden">
          <EButton className="w-full" onClick={() => choose({ id: "new", draft: { ...EMPTY_DRAFT } })}>
            <Plus className="h-4 w-4" /> New template
          </EButton>
        </div>
      ) : null}

      <EConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        tier="ordinary"
        title="Leave without saving your changes?"
        description="The changes to this template are not saved. Leaving drops them."
        confirmLabel="Leave without saving"
        onConfirm={() => {
          setSelection(pending?.next ?? null);
          setPending(null);
        }}
      />
    </div>
  );
}
