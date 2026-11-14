"use client";

/**
 * Discounts and plans tab (board "Marketing", 2026-11-16): discount codes and
 * public plans as tables with their rules and usage; each opens its editor
 * (every existing field kept). "Ended" is worked out from the end date;
 * nothing is deleted when a code ends. Codes apply on the public quote page.
 */
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { formatCurrency } from "@/lib/utils";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EField, EInput, EModal, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { formatOrgDay, isoToZonedInput, zonedInputToIso } from "@/lib/public-site/zoned-time";

const serviceOptions = MARKETED_SERVICES.map((s) => ({ value: s.jobType, label: s.shortLabel }));
const cadenceOptions = ["Weekly", "Fortnightly", "Monthly", "Quarterly", "Per booking", "Custom"];

type CampaignRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  minSubtotal: number | null;
  jobTypes: MarketedJobTypeValue[] | null;
  usageLimit: number | null;
  usageCount: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  serviceTypes: MarketedJobTypeValue[] | null;
  cadenceOptions: string[] | null;
  startingPrice: number | null;
  priceLabel: string | null;
  features: string[] | null;
  themeKey: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isPublished: boolean;
  sortOrder: number;
};

type Toast = { title: string; description?: string; tone: "success" | "danger" };

type CodeLiveState = "active" | "inactive" | "ended" | "not_started" | "used_up";

/** Worked out from the stored rules; nothing is deleted when a code ends. */
export function discountLiveState(row: CampaignRow, now: Date = new Date()): CodeLiveState {
  if (row.endsAt && new Date(row.endsAt).getTime() < now.getTime()) return "ended";
  if (!row.isActive) return "inactive";
  if (row.startsAt && new Date(row.startsAt).getTime() > now.getTime()) return "not_started";
  if (typeof row.usageLimit === "number" && row.usageCount >= row.usageLimit) return "used_up";
  return "active";
}

const LIVE_LABEL: Record<CodeLiveState, { label: string; tone: "ok" | "neutral" | "info" | "warn" }> = {
  active: { label: "Active", tone: "ok" },
  inactive: { label: "Switched off", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
  not_started: { label: "Starts later", tone: "info" },
  used_up: { label: "Used up", tone: "warn" },
};

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[hsl(var(--e-primary))]"
      />
      <span>{label}</span>
    </label>
  );
}

export function MarketingCampaignsManager({
  initialCampaigns,
  initialPlans,
  onToast,
  timeZone = "Australia/Sydney",
}: {
  initialCampaigns: CampaignRow[];
  initialPlans: PlanRow[];
  onToast: (t: Toast) => void;
  timeZone?: string;
}) {
  const [editor, setEditor] = useState<"code" | "plan" | null>(null);
  const toDateTimeInput = (value: string | null) => isoToZonedInput(value, timeZone);
  const toIsoOrNull = (value: string) => zonedInputToIso(value, timeZone);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [plans, setPlans] = useState(initialPlans);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ kind: "campaign" | "plan"; id: string } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [campaignForm, setCampaignForm] = useState({
    code: "",
    title: "",
    description: "",
    discountType: "PERCENT",
    discountValue: "10",
    minSubtotal: "",
    jobTypes: [] as MarketedJobTypeValue[],
    usageLimit: "",
    startsAt: "",
    endsAt: "",
    isActive: true,
  });
  const [planForm, setPlanForm] = useState({
    slug: "",
    name: "",
    tagline: "",
    description: "",
    serviceTypes: [] as MarketedJobTypeValue[],
    cadenceOptions: [] as string[],
    startingPrice: "",
    priceLabel: "",
    featuresText: "",
    themeKey: "",
    ctaLabel: "Register interest",
    ctaHref: "/contact",
    isPublished: true,
    sortOrder: "0",
  });


  const campaignFieldErrors = useMemo(
    () => ({
      code: campaignForm.code.trim().length >= 2 ? "" : "Code must be at least 2 characters.",
      title: campaignForm.title.trim().length >= 2 ? "" : "Title must be at least 2 characters.",
    }),
    [campaignForm.code, campaignForm.title]
  );
  const canSaveCampaign = !campaignFieldErrors.code && !campaignFieldErrors.title && !campaignSaving;

  function resetCampaignForm() {
    setEditingCampaignId(null);
    setCampaignForm({
      code: "",
      title: "",
      description: "",
      discountType: "PERCENT",
      discountValue: "10",
      minSubtotal: "",
      jobTypes: [],
      usageLimit: "",
      startsAt: "",
      endsAt: "",
      isActive: true,
    });
  }
  function resetPlanForm() {
    setEditingPlanId(null);
    setPlanForm({
      slug: "",
      name: "",
      tagline: "",
      description: "",
      serviceTypes: [],
      cadenceOptions: [],
      startingPrice: "",
      priceLabel: "",
      featuresText: "",
      themeKey: "",
      ctaLabel: "Register interest",
      ctaHref: "/contact",
      isPublished: true,
      sortOrder: "0",
    });
  }

  async function saveCampaign() {
    if (!canSaveCampaign) {
      onToast({ title: "Campaign save failed", description: campaignFieldErrors.code || campaignFieldErrors.title, tone: "danger" });
      return;
    }
    setCampaignSaving(true);
    const payload = {
      code: campaignForm.code.trim(),
      title: campaignForm.title.trim(),
      description: campaignForm.description || null,
      discountType: campaignForm.discountType,
      discountValue: Number(campaignForm.discountValue || 0),
      minSubtotal: campaignForm.minSubtotal ? Number(campaignForm.minSubtotal) : null,
      jobTypes: campaignForm.jobTypes,
      usageLimit: campaignForm.usageLimit ? Number(campaignForm.usageLimit) : null,
      startsAt: toIsoOrNull(campaignForm.startsAt),
      endsAt: toIsoOrNull(campaignForm.endsAt),
      isActive: campaignForm.isActive,
    };
    const res = await fetch(editingCampaignId ? `/api/admin/campaigns/${editingCampaignId}` : "/api/admin/campaigns", {
      method: editingCampaignId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setCampaignSaving(false);
    if (!res.ok) {
      onToast({ title: "Campaign save failed", description: body.error ?? "Could not save campaign.", tone: "danger" });
      return;
    }
    if (editingCampaignId) setCampaigns((cur) => cur.map((r) => (r.id === body.id ? body : r)));
    else setCampaigns((cur) => [body, ...cur]);
    onToast({ title: editingCampaignId ? "Discount code saved" : "Discount code created", tone: "success" });
    resetCampaignForm();
    setEditor(null);
  }

  async function savePlan() {
    setPlanSaving(true);
    const payload = {
      slug: planForm.slug,
      name: planForm.name,
      tagline: planForm.tagline || null,
      description: planForm.description || null,
      serviceTypes: planForm.serviceTypes,
      cadenceOptions: planForm.cadenceOptions,
      startingPrice: planForm.startingPrice ? Number(planForm.startingPrice) : null,
      priceLabel: planForm.priceLabel || null,
      features: planForm.featuresText.split(/\r?\n/).map((r) => r.trim()).filter(Boolean),
      themeKey: planForm.themeKey || null,
      ctaLabel: planForm.ctaLabel || null,
      ctaHref: planForm.ctaHref || null,
      isPublished: planForm.isPublished,
      sortOrder: Number(planForm.sortOrder || 0),
    };
    const res = await fetch(editingPlanId ? `/api/admin/subscriptions/${editingPlanId}` : "/api/admin/subscriptions", {
      method: editingPlanId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setPlanSaving(false);
    if (!res.ok) {
      onToast({ title: "Plan save failed", description: body.error ?? "Could not save subscription plan.", tone: "danger" });
      return;
    }
    if (editingPlanId) setPlans((cur) => cur.map((r) => (r.id === body.id ? body : r)));
    else setPlans((cur) => [...cur, body].sort((a, b) => a.sortOrder - b.sortOrder));
    onToast({ title: editingPlanId ? "Plan saved" : "Plan created", tone: "success" });
    resetPlanForm();
    setEditor(null);
  }

  async function runDelete() {
    if (!confirmState) return;
    setConfirmLoading(true);
    const { kind, id } = confirmState;
    const url = kind === "campaign" ? `/api/admin/campaigns/${id}` : `/api/admin/subscriptions/${id}`;
    const res = await fetch(url, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setConfirmLoading(false);
    if (!res.ok) {
      onToast({ title: "Delete failed", description: body.error ?? "Could not delete.", tone: "danger" });
      return;
    }
    if (kind === "campaign") {
      setCampaigns((cur) => cur.filter((r) => r.id !== id));
      if (editingCampaignId === id) resetCampaignForm();
      setEditor(null);
      onToast({ title: "Discount code deleted", tone: "success" });
    } else {
      setPlans((cur) => cur.filter((r) => r.id !== id));
      if (editingPlanId === id) resetPlanForm();
      setEditor(null);
      onToast({ title: "Plan deleted", tone: "success" });
    }
    setConfirmState(null);
  }

  function editCode(campaign: CampaignRow) {
    setEditingCampaignId(campaign.id);
    setCampaignForm({
      code: campaign.code,
      title: campaign.title,
      description: campaign.description ?? "",
      discountType: campaign.discountType,
      discountValue: String(campaign.discountValue),
      minSubtotal: campaign.minSubtotal ? String(campaign.minSubtotal) : "",
      jobTypes: campaign.jobTypes ?? [],
      usageLimit: campaign.usageLimit ? String(campaign.usageLimit) : "",
      startsAt: toDateTimeInput(campaign.startsAt),
      endsAt: toDateTimeInput(campaign.endsAt),
      isActive: campaign.isActive,
    });
    setEditor("code");
  }

  function editPlan(plan: PlanRow) {
    setEditingPlanId(plan.id);
    setPlanForm({
      slug: plan.slug,
      name: plan.name,
      tagline: plan.tagline ?? "",
      description: plan.description ?? "",
      serviceTypes: plan.serviceTypes ?? [],
      cadenceOptions: plan.cadenceOptions ?? [],
      startingPrice: typeof plan.startingPrice === "number" ? String(plan.startingPrice) : "",
      priceLabel: plan.priceLabel ?? "",
      featuresText: (plan.features ?? []).join("\n"),
      themeKey: plan.themeKey ?? "",
      ctaLabel: plan.ctaLabel ?? "Register interest",
      ctaHref: plan.ctaHref ?? "/contact",
      isPublished: plan.isPublished,
      sortOrder: String(plan.sortOrder ?? 0),
    });
    setEditor("plan");
  }

  function rulesOf(campaign: CampaignRow): string {
    const parts: string[] = [];
    if (campaign.minSubtotal) parts.push(`min ${formatCurrency(campaign.minSubtotal)}`);
    const services = (campaign.jobTypes ?? []).map((jt) => serviceOptions.find((o) => o.value === jt)?.label ?? jt);
    parts.push(services.length ? services.join(", ") : "all services");
    if (campaign.startsAt || campaign.endsAt) {
      const start = campaign.startsAt ? formatOrgDay(campaign.startsAt, timeZone) : "now";
      const end = campaign.endsAt ? formatOrgDay(campaign.endsAt, timeZone) : "no end";
      parts.push(`${start} – ${end}`);
    }
    return parts.join(" · ");
  }

  const cellClass = "px-3 py-2.5 align-top";
  const headClass = "px-3 py-2 font-[600]";

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <ECard className="min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <h2 className="text-[0.9375rem] font-[600]">Discount codes</h2>
          <EButton variant="outline" size="sm" onClick={() => { resetCampaignForm(); setEditor("code"); }}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New code
          </EButton>
        </div>
        {campaigns.length === 0 ? (
          <p className="px-4 py-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No discount codes yet.</p>
        ) : (
          <div role="region" aria-label="Discount codes" className="overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem] max-sm:block">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] max-sm:sr-only">
                <tr><th scope="col" className={headClass}>Code</th><th scope="col" className={headClass}>Value</th><th scope="col" className={headClass}>Rules</th><th scope="col" className={headClass}>Used</th><th scope="col" className={headClass}>Live</th></tr>
              </thead>
              <tbody className="max-sm:block">
                {campaigns.map((campaign) => {
                  const live = LIVE_LABEL[discountLiveState(campaign)];
                  return (
                    <tr key={campaign.id} className="border-t border-[hsl(var(--e-border))] max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:py-2">
                      <td className={`${cellClass} max-sm:col-span-2`}>
                        <button type="button" onClick={() => editCode(campaign)} className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold-soft))] px-1.5 py-0.5 font-mono text-[0.75rem] font-[600] text-[hsl(var(--e-gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                          {campaign.code}
                        </button>
                        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{campaign.title}</p>
                      </td>
                      <td className={`${cellClass} tabular-nums`}>{campaign.discountType === "PERCENT" ? `${campaign.discountValue}%` : formatCurrency(campaign.discountValue)}</td>
                      <td className={`${cellClass} text-[0.75rem] max-sm:col-span-2 max-sm:row-start-3`}>{rulesOf(campaign)}</td>
                      <td className={`${cellClass} tabular-nums text-[0.75rem]`}>{typeof campaign.usageLimit === "number" ? `${campaign.usageCount} of ${campaign.usageLimit}` : `${campaign.usageCount} · no limit`}</td>
                      <td className={cellClass}><EPill tone={live.tone}>{live.label}</EPill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Codes apply on the public quote page. &ldquo;Ended&rdquo; is worked out from the end date; nothing is deleted when it ends.
        </p>
      </ECard>

      <ECard className="min-w-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <h2 className="text-[0.9375rem] font-[600]">Public plans</h2>
          <EButton variant="outline" size="sm" onClick={() => { resetPlanForm(); setEditor("plan"); }}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New plan
          </EButton>
        </div>
        {plans.length === 0 ? (
          <p className="px-4 py-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No public plans yet.</p>
        ) : (
          <div role="region" aria-label="Public plans" className="overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem] max-sm:block">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] max-sm:sr-only">
                <tr><th scope="col" className={headClass}>Plan</th><th scope="col" className={headClass}>Price label</th><th scope="col" className={headClass}>Cadences</th><th scope="col" className={headClass}>On site</th></tr>
              </thead>
              <tbody className="max-sm:block">
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-t border-[hsl(var(--e-border))] max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:py-2">
                    <td className={`${cellClass} max-sm:col-span-2`}>
                      <button type="button" onClick={() => editPlan(plan)} className="text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                        {plan.name}
                      </button>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">/{plan.slug} · order {plan.sortOrder}</p>
                    </td>
                    <td className={cellClass}>{plan.priceLabel || (typeof plan.startingPrice === "number" ? `From ${formatCurrency(plan.startingPrice)}` : "Custom pricing")}</td>
                    <td className={`${cellClass} text-[0.75rem]`}>{(plan.cadenceOptions ?? []).join(", ").toLowerCase() || "–"}</td>
                    <td className={cellClass}><EPill tone={plan.isPublished ? "ok" : "neutral"}>{plan.isPublished ? "Published" : "Hidden"}</EPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Published plans show on the public plans page. The editor keeps every field: tagline, description, features, call to action, theme and services.
        </p>
      </ECard>

      <EModal open={editor === "code"} onClose={() => (campaignSaving ? undefined : setEditor(null))} eyebrow="Discount code" title={editingCampaignId ? `Edit ${campaignForm.code || "code"}` : "New discount code"} wide>
        <fieldset disabled={campaignSaving} className="space-y-4">
          <legend className="sr-only">Discount code</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Code">
              <EInput value={campaignForm.code} onChange={(e) => setCampaignForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" />
            </EField>
            <EField label="Title">
              <EInput value={campaignForm.title} onChange={(e) => setCampaignForm((c) => ({ ...c, title: e.target.value }))} placeholder="Welcome offer" />
            </EField>
          </div>
          {campaignFieldErrors.code || campaignFieldErrors.title ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{campaignFieldErrors.code || campaignFieldErrors.title}</p>
          ) : null}
          <EField label="Description">
            <ETextarea rows={3} value={campaignForm.description} onChange={(e) => setCampaignForm((c) => ({ ...c, description: e.target.value }))} />
          </EField>
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Type">
              <ESelect value={campaignForm.discountType} onChange={(e) => setCampaignForm((c) => ({ ...c, discountType: e.target.value }))}>
                <option value="PERCENT">Percent off</option>
                <option value="FIXED">Dollar amount off</option>
              </ESelect>
            </EField>
            <EField label="Value"><EInput type="number" min={0} value={campaignForm.discountValue} onChange={(e) => setCampaignForm((c) => ({ ...c, discountValue: e.target.value }))} /></EField>
            <EField label="Minimum quote"><EInput type="number" min={0} value={campaignForm.minSubtotal} onChange={(e) => setCampaignForm((c) => ({ ...c, minSubtotal: e.target.value }))} placeholder="Optional" /></EField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Starts (organisation time)"><EInput type="datetime-local" value={campaignForm.startsAt} onChange={(e) => setCampaignForm((c) => ({ ...c, startsAt: e.target.value }))} /></EField>
            <EField label="Ends (organisation time)"><EInput type="datetime-local" value={campaignForm.endsAt} onChange={(e) => setCampaignForm((c) => ({ ...c, endsAt: e.target.value }))} /></EField>
          </div>
          <EField label="Usage limit"><EInput type="number" min={1} value={campaignForm.usageLimit} onChange={(e) => setCampaignForm((c) => ({ ...c, usageLimit: e.target.value }))} placeholder="Optional" /></EField>
          <div className="space-y-2">
            <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Applies to services (none ticked: all services)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {serviceOptions.map((s) => (
                <CheckRow key={s.value} label={s.label} checked={campaignForm.jobTypes.includes(s.value)} onChange={(checked) => setCampaignForm((c) => ({ ...c, jobTypes: checked ? [...c.jobTypes, s.value] : c.jobTypes.filter((v) => v !== s.value) }))} />
              ))}
            </div>
          </div>
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <ESwitch checked={campaignForm.isActive} onCheckedChange={(v) => setCampaignForm((c) => ({ ...c, isActive: v }))} label="Code switched on" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton onClick={saveCampaign} disabled={!canSaveCampaign}>{campaignSaving ? "Saving…" : editingCampaignId ? "Save code" : "Create code"}</EButton>
            <EButton type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</EButton>
            {editingCampaignId ? (
              <EButton type="button" variant="ghost" className="ml-auto text-[hsl(var(--e-danger))]" onClick={() => setConfirmState({ kind: "campaign", id: editingCampaignId })}>Delete code…</EButton>
            ) : null}
          </div>
        </fieldset>
      </EModal>

      <EModal open={editor === "plan"} onClose={() => (planSaving ? undefined : setEditor(null))} eyebrow="Public plan" title={editingPlanId ? `Edit ${planForm.name || "plan"}` : "New public plan"} wide>
        <fieldset disabled={planSaving} className="space-y-4">
          <legend className="sr-only">Public plan</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Address (slug)"><EInput value={planForm.slug} onChange={(e) => setPlanForm((c) => ({ ...c, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="weekly-reset" /></EField>
            <EField label="Name"><EInput value={planForm.name} onChange={(e) => setPlanForm((c) => ({ ...c, name: e.target.value }))} /></EField>
          </div>
          <EField label="Tagline"><EInput value={planForm.tagline} onChange={(e) => setPlanForm((c) => ({ ...c, tagline: e.target.value }))} /></EField>
          <EField label="Description"><ETextarea rows={4} value={planForm.description} onChange={(e) => setPlanForm((c) => ({ ...c, description: e.target.value }))} /></EField>
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Starting price"><EInput type="number" min={0} value={planForm.startingPrice} onChange={(e) => setPlanForm((c) => ({ ...c, startingPrice: e.target.value }))} /></EField>
            <EField label="Price label"><EInput value={planForm.priceLabel} onChange={(e) => setPlanForm((c) => ({ ...c, priceLabel: e.target.value }))} placeholder="From $170 per week" /></EField>
            <EField label="Order on the page"><EInput type="number" min={0} value={planForm.sortOrder} onChange={(e) => setPlanForm((c) => ({ ...c, sortOrder: e.target.value }))} /></EField>
          </div>
          <div className="space-y-2">
            <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Services it covers</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {serviceOptions.map((s) => (
                <CheckRow key={s.value} label={s.label} checked={planForm.serviceTypes.includes(s.value)} onChange={(checked) => setPlanForm((c) => ({ ...c, serviceTypes: checked ? [...c.serviceTypes, s.value] : c.serviceTypes.filter((v) => v !== s.value) }))} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Cadences</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {cadenceOptions.map((c) => (
                <CheckRow key={c} label={c} checked={planForm.cadenceOptions.includes(c)} onChange={(checked) => setPlanForm((f) => ({ ...f, cadenceOptions: checked ? [...f.cadenceOptions, c] : f.cadenceOptions.filter((v) => v !== c) }))} />
              ))}
            </div>
          </div>
          <EField label="Features (one per line)"><ETextarea rows={5} value={planForm.featuresText} onChange={(e) => setPlanForm((c) => ({ ...c, featuresText: e.target.value }))} /></EField>
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Theme"><EInput value={planForm.themeKey} onChange={(e) => setPlanForm((c) => ({ ...c, themeKey: e.target.value }))} placeholder="ocean" /></EField>
            <EField label="Call to action label"><EInput value={planForm.ctaLabel} onChange={(e) => setPlanForm((c) => ({ ...c, ctaLabel: e.target.value }))} /></EField>
            <EField label="Call to action link"><EInput value={planForm.ctaHref} onChange={(e) => setPlanForm((c) => ({ ...c, ctaHref: e.target.value }))} /></EField>
          </div>
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <ESwitch checked={planForm.isPublished} onCheckedChange={(v) => setPlanForm((c) => ({ ...c, isPublished: v }))} label="Published on the public site" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton onClick={savePlan} disabled={planSaving}>{planSaving ? "Saving…" : editingPlanId ? "Save plan" : "Create plan"}</EButton>
            <EButton type="button" variant="outline" onClick={() => setEditor(null)}>Cancel</EButton>
            {editingPlanId ? (
              <EButton type="button" variant="ghost" className="ml-auto text-[hsl(var(--e-danger))]" onClick={() => setConfirmState({ kind: "plan", id: editingPlanId })}>Delete plan…</EButton>
            ) : null}
          </div>
        </fieldset>
      </EModal>

      <EConfirmDialog
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        tier="destructive"
        title={confirmState?.kind === "plan" ? "Delete this public plan?" : "Delete this discount code?"}
        description={
          confirmState?.kind === "plan"
            ? "It is removed from the public plans page and from this list. This cannot be undone. To keep it, switch off Published instead."
            : "The code stops working on the quote page and is removed from this list. This cannot be undone. To keep its history, switch it off instead."
        }
        confirmLabel={confirmState?.kind === "plan" ? "Delete plan" : "Delete code"}
        busy={confirmLoading}
        onConfirm={runDelete}
      />
    </div>
  );
}
