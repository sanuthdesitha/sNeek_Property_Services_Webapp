"use client";

/**
 * ESTATE — Forms management (native v2 port of app/admin/forms).
 * Two tabs, driven natively (no @/components/{admin,ui,shared,forms}):
 *   • Templates — list form templates with New / Edit / Duplicate / Publish /
 *     Delete actions, submissions count per template.
 *   • Checklists — the per-service coverage editor (EstateChecklistsWorkspace).
 *
 * Endpoints (unchanged from v1):
 *   GET    /api/admin/form-templates?includeDrafts=1     → FormTemplate[]
 *          (`includeDrafts` is REQUIRED here: duplicate + create both mint
 *          DRAFTS, and the default list filter is `isActive: true`, so without
 *          it a duplicated template never appeared — the "Duplicate does
 *          nothing" bug. `includeArchived=1` additionally shows retired rows.)
 *   GET    /api/admin/form-submissions                   → FormSubmission[]
 *   POST   /api/admin/form-templates/:id/duplicate       → { template }
 *   POST   /api/admin/form-templates/:id/publish {action}→ { template }
 *   DELETE /api/admin/form-templates/:id  { security }    → { ok }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Copy,
  FileText,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  BarChart3,
} from "lucide-react";
import { EButton, ECard, EBadge, EAlert } from "@/components/v2/ui/primitives";
import { EChipTabs, ETableShell, EInput, EConfirmModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { compareTemplateRecency } from "@/lib/forms/resolve-job-template";
import { EstateChecklistsWorkspace } from "./estate-checklists-workspace";

type TabKey = "templates" | "checklists";

interface TemplateRow {
  id: string;
  name: string;
  serviceType: string;
  version: number;
  isActive: boolean;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Registered as some property's per-job-type form override (see API). */
  propertyScoped?: boolean;
}

interface SubmissionRow {
  id: string;
  templateId: string | null;
}

function prettyType(jt: string) {
  return jt.replace(/_/g, " ");
}

export function EstateFormsList({ tab }: { tab: TabKey }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [countsByTemplate, setCountsByTemplate] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /** Newly created row (duplicate) — scrolled to and ring-highlighted once. */
  const [highlight, setHighlight] = useState<{ id: string; name: string } | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // includeDrafts=1 is what makes duplicates and freshly created templates
      // visible at all — the API defaults to live templates only.
      const query = showArchived ? "?includeArchived=1" : "?includeDrafts=1";
      const [tplRes, subRes] = await Promise.all([
        fetch(`/api/admin/form-templates${query}`, { cache: "no-store" }),
        fetch("/api/admin/form-submissions", { cache: "no-store" }),
      ]);
      const tplBody = await tplRes.json().catch(() => []);
      if (!tplRes.ok) throw new Error((tplBody as any)?.error ?? "Could not load templates.");
      setTemplates(Array.isArray(tplBody) ? tplBody : []);

      const subBody = await subRes.json().catch(() => []);
      const counts: Record<string, number> = {};
      if (Array.isArray(subBody)) {
        for (const sub of subBody as SubmissionRow[]) {
          if (sub.templateId) counts[sub.templateId] = (counts[sub.templateId] ?? 0) + 1;
        }
      }
      setCountsByTemplate(counts);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    if (tab === "templates") void load();
    else setLoading(false);
  }, [tab, load]);

  // Bring the freshly duplicated row into view once it has actually rendered.
  useEffect(() => {
    if (!highlight || loading) return;
    highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight, loading]);

  const filtered = useMemo(() => {
    const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name));
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        prettyType(t.serviceType).toLowerCase().includes(query)
    );
  }, [templates, search]);

  /**
   * The template the RUNTIME would pick for a job with no property override:
   * highest-version active GLOBAL template of that service type (property-scoped
   * templates are excluded — see app/api/jobs/[id]/form/route.ts). Computed from
   * the full list, not the filtered one, so searching can't move the marker.
   */
  const activeDefaultByService = useMemo(() => {
    const map: Record<string, string> = {};
    const byId = new Map(templates.map((t) => [t.id, t]));
    for (const t of templates) {
      if (!t.isActive || t.archivedAt || t.propertyScoped) continue;
      const current = byId.get(map[t.serviceType] ?? "");
      // Same total order the runtime uses (version → publishedAt → updatedAt →
      // createdAt → id), so this marker can never disagree with the job form.
      if (!current || compareTemplateRecency(t, current) < 0) map[t.serviceType] = t.id;
    }
    return map;
  }, [templates]);

  /** Filtered rows grouped by service type, service names A→Z. */
  const grouped = useMemo(() => {
    const map = new Map<string, TemplateRow[]>();
    for (const t of filtered) {
      const list = map.get(t.serviceType) ?? [];
      list.push(t);
      map.set(t.serviceType, list);
    }
    return Array.from(map.entries())
      .map(([serviceType, rows]) => ({
        serviceType,
        rows: [...rows].sort((a, b) => b.version - a.version || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => prettyType(a.serviceType).localeCompare(prettyType(b.serviceType)));
  }, [filtered]);

  const duplicate = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    setHighlight(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${id}/duplicate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `Could not duplicate (${res.status}).`);
      }
      const copy = body?.template;
      if (!copy?.id) throw new Error("Duplicated, but the server returned no template.");
      // The copy is a DRAFT — say so, otherwise "published" is assumed and the
      // owner reports the duplicate as missing from the live forms.
      setNotice(`“${copy.name}” created as a draft (v${copy.version}). Publish it when it's ready.`);
      setHighlight({ id: copy.id, name: copy.name });
      await load();
    } catch (err: any) {
      setError(err.message ?? "Could not duplicate.");
    } finally {
      setBusyId(null);
    }
  };

  const setPublishState = async (id: string, action: "publish" | "archive" | "unarchive") => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    setHighlight(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update template.");
      setNotice(
        action === "publish"
          ? "Template published."
          : action === "archive"
            ? "Template archived."
            : "Template unarchived."
      );
      await load();
    } catch (err: any) {
      setError(err.message ?? "Could not update template.");
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (credentials?: { pin?: string; password?: string }) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    setHighlight(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete template.");
      setNotice("Template deleted.");
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setError(err.message ?? "Could not delete template.");
    } finally {
      setDeleting(false);
    }
  };

  function statusBadge(t: TemplateRow) {
    // Draft (never published) and Archived (retired) both mean "not live", but
    // they need different actions — collapsing them into "Draft" hid the fact
    // that edits to an archived template reach nothing.
    if (t.archivedAt) return <EBadge tone="neutral" soft>Archived</EBadge>;
    if (!t.isActive) return <EBadge tone="warning" soft>Draft</EBadge>;
    return (
      <EBadge tone="success" soft>
        Published
      </EBadge>
    );
  }

  const tabs = [
    {
      key: "templates",
      label: "Templates",
      href: "/v2/admin/forms",
      active: tab === "templates",
      icon: <FileText className="h-3.5 w-3.5" />,
    },
    {
      key: "checklists",
      label: "Checklists",
      href: "/v2/admin/forms?tab=checklists",
      active: tab === "checklists",
      icon: <ListChecks className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="space-y-5">
      <EChipTabs tabs={tabs} />

      {tab === "checklists" ? (
        <EstateChecklistsWorkspace />
      ) : (
        <div className="space-y-4">
          {error ? (
            <EAlert tone="danger" title="Something went wrong">
              {error}
            </EAlert>
          ) : null}
          {notice ? (
            <EAlert tone="success" title="Done">
              <div className="flex flex-wrap items-center gap-3">
                <span>{notice}</span>
                {highlight ? (
                  <Link
                    href={`/v2/admin/forms/${highlight.id}/edit`}
                    className="font-semibold text-[hsl(var(--e-foreground))] underline underline-offset-2"
                  >
                    Open in builder
                  </Link>
                ) : null}
              </div>
            </EAlert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ESwitch
                checked={showArchived}
                onCheckedChange={setShowArchived}
                disabled={loading}
                label="Show archived"
              />
              <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </EButton>
              <EButton variant="outline" size="sm" asChild>
                <Link href="/v2/admin/forms/stats">
                  <BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Stats
                </Link>
              </EButton>
              <EButton size="sm" asChild>
                <Link href="/v2/admin/forms/new">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> New template
                </Link>
              </EButton>
            </div>
          </div>

          <ECard>
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
                Form templates
              </span>
              <EInput
                placeholder="Search name / service…"
                className="h-9 w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {loading ? (
              <p className="px-4 py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                Loading…
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                No form templates yet. Create one, or generate a draft from a service checklist.
              </p>
            ) : (
              <ETableShell
                className="border-t border-[hsl(var(--e-border))]"
                headers={[
                  { label: "Template" },
                  { label: "Service" },
                  { label: "Status" },
                  { label: "Version", align: "right" },
                  { label: "Submissions", align: "right" },
                  { label: "", align: "right" },
                ]}
              >
                {grouped.flatMap((group) => [
                  <tr key={`group-${group.serviceType}`} className="bg-[hsl(var(--e-surface-sunken))]">
                    <td
                      colSpan={6}
                      className="px-4 py-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-text-secondary))]"
                    >
                      {prettyType(group.serviceType)} · {group.rows.length}
                    </td>
                  </tr>,
                  ...group.rows.map((t) => {
                  const busy = busyId === t.id;
                  const published = t.isActive && !t.archivedAt;
                  const isActiveDefault = activeDefaultByService[t.serviceType] === t.id;
                  const isNew = highlight?.id === t.id;
                  return (
                    <tr
                      key={t.id}
                      ref={isNew ? highlightRef : undefined}
                      className={`hover:bg-[hsl(var(--e-muted))] ${
                        isNew
                          ? "bg-[hsl(var(--e-success-soft))] ring-1 ring-inset ring-[hsl(var(--e-success))]"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[hsl(var(--e-foreground))]">{t.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {isActiveDefault ? (
                            <EBadge tone="gold" soft>
                              Active default
                            </EBadge>
                          ) : null}
                          {t.propertyScoped ? (
                            <EBadge tone="info" soft>
                              Property-scoped
                            </EBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {prettyType(t.serviceType)}
                      </td>
                      <td className="px-4 py-2.5">{statusBadge(t)}</td>
                      <td className="e-tnum px-4 py-2.5 text-right text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        v{t.version}
                      </td>
                      <td className="e-tnum px-4 py-2.5 text-right text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {countsByTemplate[t.id] ?? 0}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <EButton size="sm" variant="outline" className="h-8 px-2" asChild>
                            <Link href={`/v2/admin/forms/${t.id}/edit`}>Edit</Link>
                          </EButton>
                          <EButton
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => void duplicate(t.id)}
                            disabled={busy}
                            title="Duplicate as a new draft"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1 hidden sm:inline">Duplicate</span>
                          </EButton>
                          {published ? (
                            <EButton
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => void setPublishState(t.id, "archive")}
                              disabled={busy}
                              title="Archive (unpublish)"
                            >
                              <span className="hidden sm:inline">Archive</span>
                              <span className="sm:hidden">Arch.</span>
                            </EButton>
                          ) : (
                            <EButton
                              size="sm"
                              variant="outline-gold"
                              className="h-8 px-2"
                              onClick={() => void setPublishState(t.id, "publish")}
                              disabled={busy}
                              title="Publish"
                            >
                              <Send className="h-3.5 w-3.5" />
                              <span className="ml-1 hidden sm:inline">Publish</span>
                            </EButton>
                          )}
                          <EButton
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => setDeleteTarget(t)}
                            disabled={busy}
                            title="Delete template"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" />
                          </EButton>
                        </div>
                      </td>
                    </tr>
                  );
                  }),
                ])}
              </ETableShell>
            )}
          </ECard>
        </div>
      )}

      <EConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete form template"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” will be deactivated and unavailable for future jobs. Verify to continue.`
            : undefined
        }
        confirmLabel="Delete template"
        requireSecurity
        danger
        loading={deleting}
        onConfirm={doDelete}
      />
    </div>
  );
}
