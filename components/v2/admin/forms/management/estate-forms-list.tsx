"use client";

/**
 * ESTATE — Forms management (native v2 port of app/admin/forms).
 * Two tabs, driven natively (no @/components/{admin,ui,shared,forms}):
 *   • Templates — list form templates with New / Edit / Duplicate / Publish /
 *     Delete actions, submissions count per template.
 *   • Checklists — the per-service coverage editor (EstateChecklistsWorkspace).
 *
 * Endpoints (unchanged from v1):
 *   GET    /api/admin/form-templates                     → FormTemplate[]
 *   GET    /api/admin/form-submissions                   → FormSubmission[]
 *   POST   /api/admin/form-templates/:id/duplicate       → { template }
 *   POST   /api/admin/form-templates/:id/publish {action}→ { template }
 *   DELETE /api/admin/form-templates/:id  { security }    → { ok }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { EChipTabs, ETableShell, EInput, EConfirmModal } from "@/components/v2/admin/estate-kit";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, subRes] = await Promise.all([
        fetch("/api/admin/form-templates", { cache: "no-store" }),
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
  }, []);

  useEffect(() => {
    if (tab === "templates") void load();
    else setLoading(false);
  }, [tab, load]);

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

  const duplicate = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/form-templates/${id}/duplicate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not duplicate.");
      setNotice("Template duplicated as a new draft.");
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
    if (t.archivedAt || !t.isActive) return <EBadge tone="warning" soft>Draft</EBadge>;
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
              {notice}
            </EAlert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              {templates.length} template{templates.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
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
                {filtered.map((t) => {
                  const busy = busyId === t.id;
                  const published = t.isActive && !t.archivedAt;
                  return (
                    <tr key={t.id} className="hover:bg-[hsl(var(--e-muted))]">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[hsl(var(--e-foreground))]">{t.name}</p>
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
                })}
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
