"use client";

/**
 * ESTATE onboarding surveys board — v2-native port of the v1 admin onboarding
 * list (app/admin/onboarding/page.tsx): the property onboarding surveys with
 * their status, searchable/filterable, plus delete for drafts/rejected.
 * Same endpoints as v1:
 *   GET    /api/admin/onboarding/surveys?status=&search=
 *   DELETE /api/admin/onboarding/surveys/[id]
 * The v2-native survey wizard + detail review live at /v2/admin/onboarding/new
 * (components/v2/admin/onboarding/wizard.tsx) and /v2/admin/onboarding/[id]
 * (components/v2/admin/onboarding/survey-detail.tsx).
 */

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ClipboardCheck, Eye, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { EInput, ESelect, EModal } from "@/components/v2/admin/estate-kit";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "gold";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

type SurveyRow = {
  id: string;
  surveyNumber: string;
  status: string;
  propertyName?: string | null;
  propertyAddress?: string | null;
  propertySuburb?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sizeSqm?: number | null;
  createdAt: string;
  createdPropertyId?: string | null;
  _count?: { appliances?: number };
};

export function OnboardingSurveysBoard() {
  const [surveys, setSurveys] = React.useState<SurveyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const loadSurveys = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/onboarding/surveys?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => []);
      setSurveys(Array.isArray(data) ? data : []);
    } catch {
      setSurveys([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  React.useEffect(() => {
    loadSurveys();
    // Initial load + reload on status filter change; search is applied on Enter/button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Delete failed");
      }
      toast({ title: "Survey deleted" });
      setSurveys((prev) => prev.filter((s) => s.id !== deleteId));
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="Property onboarding"
        description="Survey new properties and onboard cleaning contracts."
        actions={
          <EButton asChild variant="gold" size="sm">
            <Link href="/v2/admin/onboarding/new">
              <Plus className="h-3.5 w-3.5" /> New survey
            </Link>
          </EButton>
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
          <EInput
            className="pl-8"
            placeholder="Search surveys…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadSurveys()}
          />
        </div>
        <ESelect className="w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.keys(STATUS_LABELS).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </ESelect>
        <EButton variant="outline" size="sm" onClick={loadSurveys}>
          Search
        </EButton>
      </div>

      {loading ? (
        <p className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading surveys…
        </p>
      ) : surveys.length === 0 ? (
        <ECard>
          <ECardBody>
            <EEmptyState
              eyebrow="Onboarding"
              title="No surveys yet"
              description="Create your first property onboarding survey to capture rooms, appliances, and access details."
              action={
                <EButton asChild variant="outline" size="sm">
                  <Link href="/v2/admin/onboarding/new">Create your first survey</Link>
                </EButton>
              }
            />
          </ECardBody>
        </ECard>
      ) : (
        <div className="space-y-2">
          {surveys.map((survey) => (
            <ECard key={survey.id} className="transition-colors hover:border-[hsl(var(--e-border-strong))]">
              <ECardBody className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/v2/admin/onboarding/${survey.id}`}
                        className="inline-flex items-center gap-1.5 text-[0.875rem] font-[600] hover:underline"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" />
                        {survey.surveyNumber}
                      </Link>
                      <EBadge tone={STATUS_TONES[survey.status] ?? "neutral"} soft>
                        {STATUS_LABELS[survey.status] ?? survey.status}
                      </EBadge>
                      {survey.createdPropertyId ? (
                        <EBadge tone="gold" soft>
                          Property created
                        </EBadge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {survey.propertyName ?? survey.propertyAddress ?? "No property name"}
                      {survey.propertySuburb ? ` — ${survey.propertySuburb}` : ""}
                    </p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      {survey.bedrooms ?? 0} bed, {survey.bathrooms ?? 0} bath
                      {survey.sizeSqm ? ` · ${survey.sizeSqm} sqm` : ""}
                      {survey._count?.appliances ? ` · ${survey._count.appliances} appliance(s)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="hidden text-[0.75rem] text-[hsl(var(--e-text-faint))] sm:block">
                      {format(new Date(survey.createdAt), "dd MMM yyyy")}
                    </p>
                    <div className="flex items-center gap-1">
                      <EButton asChild variant="ghost" size="icon" aria-label="View survey">
                        <Link href={`/v2/admin/onboarding/${survey.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </EButton>
                      {survey.status === "DRAFT" ? (
                        <EButton asChild variant="ghost" size="icon" aria-label="Edit survey">
                          <Link href={`/v2/admin/onboarding/new?edit=${survey.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </EButton>
                      ) : null}
                      {survey.status === "DRAFT" || survey.status === "REJECTED" ? (
                        <EButton
                          variant="ghost"
                          size="icon"
                          aria-label="Delete survey"
                          onClick={() => setDeleteId(survey.id)}
                        >
                          <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                        </EButton>
                      ) : null}
                    </div>
                  </div>
                </div>
              </ECardBody>
            </ECard>
          ))}
        </div>
      )}

      <EModal open={Boolean(deleteId)} onClose={() => !deleting && setDeleteId(null)} eyebrow="Onboarding" title="Delete survey">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            This will permanently delete this survey and all its data. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setDeleteId(null)} disabled={deleting}>
              Cancel
            </EButton>
            <EButton variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
