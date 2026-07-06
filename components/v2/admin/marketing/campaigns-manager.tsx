"use client";

import { useMemo, useState } from "react";
import { Plus, Rocket, Tag } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { formatCurrency } from "@/lib/utils";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  ESwitch,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

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

function toDateTimeInput(value: string | null) {
  return value ? value.slice(0, 16) : "";
}
function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

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
}: {
  initialCampaigns: CampaignRow[];
  initialPlans: PlanRow[];
  onToast: (t: Toast) => void;
}) {
  const [tab, setTab] = useState<"campaigns" | "plans">("campaigns");
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

  const activeCampaignCount = useMemo(() => campaigns.filter((c) => c.isActive).length, [campaigns]);
  const publishedPlanCount = useMemo(() => plans.filter((p) => p.isPublished).length, [plans]);

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
    onToast({ title: editingCampaignId ? "Campaign updated" : "Campaign created", tone: "success" });
    resetCampaignForm();
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
    onToast({ title: editingPlanId ? "Plan updated" : "Plan created", tone: "success" });
    resetPlanForm();
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
      onToast({ title: "Campaign removed", tone: "success" });
    } else {
      setPlans((cur) => cur.filter((r) => r.id !== id));
      if (editingPlanId === id) resetPlanForm();
      onToast({ title: "Plan removed", tone: "success" });
    }
    setConfirmState(null);
  }

  const tabBtn = (key: "campaigns" | "plans", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-current={tab === key ? "page" : undefined}
      className={`rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors ${
        tab === key
          ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
          : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Active campaigns" value={activeCampaignCount} icon={<Tag className="h-4 w-4" />} />
        <EStatCard label="Published plans" value={publishedPlanCount} icon={<Rocket className="h-4 w-4" />} />
        <EStatCard label="Quote-ready services" value={serviceOptions.length} />
      </div>

      <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {tabBtn("campaigns", "Discount campaigns")}
        {tabBtn("plans", "Subscription plans")}
      </div>

      {tab === "campaigns" ? (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <ECard>
            <ECardHeader className="pb-3"><ECardTitle className="text-[0.95rem]">{editingCampaignId ? "Edit campaign" : "New campaign"}</ECardTitle></ECardHeader>
            <ECardBody className="space-y-4 pt-0">
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Code">
                  <EInput value={campaignForm.code} onChange={(e) => setCampaignForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" />
                  {campaignFieldErrors.code ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{campaignFieldErrors.code}</p> : null}
                </EField>
                <EField label="Title">
                  <EInput value={campaignForm.title} onChange={(e) => setCampaignForm((c) => ({ ...c, title: e.target.value }))} placeholder="Welcome offer" />
                  {campaignFieldErrors.title ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{campaignFieldErrors.title}</p> : null}
                </EField>
              </div>
              <EField label="Description">
                <ETextarea rows={3} value={campaignForm.description} onChange={(e) => setCampaignForm((c) => ({ ...c, description: e.target.value }))} />
              </EField>
              <div className="grid gap-4 sm:grid-cols-3">
                <EField label="Type"><EInput value={campaignForm.discountType} onChange={(e) => setCampaignForm((c) => ({ ...c, discountType: e.target.value.toUpperCase() }))} placeholder="PERCENT or FIXED" /></EField>
                <EField label="Value"><EInput type="number" min={0} value={campaignForm.discountValue} onChange={(e) => setCampaignForm((c) => ({ ...c, discountValue: e.target.value }))} /></EField>
                <EField label="Min subtotal"><EInput type="number" min={0} value={campaignForm.minSubtotal} onChange={(e) => setCampaignForm((c) => ({ ...c, minSubtotal: e.target.value }))} placeholder="Optional" /></EField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Starts at"><EInput type="datetime-local" value={campaignForm.startsAt} onChange={(e) => setCampaignForm((c) => ({ ...c, startsAt: e.target.value }))} /></EField>
                <EField label="Ends at"><EInput type="datetime-local" value={campaignForm.endsAt} onChange={(e) => setCampaignForm((c) => ({ ...c, endsAt: e.target.value }))} /></EField>
              </div>
              <EField label="Usage limit"><EInput type="number" min={1} value={campaignForm.usageLimit} onChange={(e) => setCampaignForm((c) => ({ ...c, usageLimit: e.target.value }))} placeholder="Optional" /></EField>
              <div className="space-y-2">
                <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Applies to services</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {serviceOptions.map((s) => (
                    <CheckRow
                      key={s.value}
                      label={s.label}
                      checked={campaignForm.jobTypes.includes(s.value)}
                      onChange={(checked) => setCampaignForm((c) => ({ ...c, jobTypes: checked ? [...c.jobTypes, s.value] : c.jobTypes.filter((v) => v !== s.value) }))}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
                <ESwitch checked={campaignForm.isActive} onCheckedChange={(v) => setCampaignForm((c) => ({ ...c, isActive: v }))} label="Campaign active" />
              </div>
              <div className="flex flex-wrap gap-2">
                <EButton onClick={saveCampaign} disabled={!canSaveCampaign}>{campaignSaving ? "Saving…" : editingCampaignId ? "Save changes" : "Create campaign"}</EButton>
                <EButton type="button" variant="outline" onClick={resetCampaignForm}>Reset</EButton>
              </div>
            </ECardBody>
          </ECard>

          <div className="space-y-4">
            {campaigns.length === 0 ? (
              <EEmptyState
                eyebrow="Campaigns"
                title="No campaigns yet"
                description="Create discount campaigns here and the public quote wizard can validate them by code."
                action={<EButton onClick={resetCampaignForm}><Plus className="h-4 w-4" />New campaign</EButton>}
              />
            ) : (
              campaigns.map((campaign) => (
                <ECard key={campaign.id}>
                  <ECardBody className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Tag className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
                          <p className="font-semibold text-[hsl(var(--e-foreground))]">{campaign.title}</p>
                          {!campaign.isActive ? <EBadge tone="neutral" soft>Inactive</EBadge> : null}
                        </div>
                        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                          {campaign.code} · {campaign.discountType === "PERCENT" ? `${campaign.discountValue}% off` : formatCurrency(campaign.discountValue)}
                          {campaign.minSubtotal ? ` · min ${formatCurrency(campaign.minSubtotal)}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <EButton variant="outline" size="sm" onClick={() => {
                          setEditingCampaignId(campaign.id);
                          setTab("campaigns");
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
                        }}>Edit</EButton>
                        <EButton variant="danger" size="sm" onClick={() => setConfirmState({ kind: "campaign", id: campaign.id })}>Delete</EButton>
                      </div>
                    </div>
                    <p className="text-[0.8125rem] leading-6 text-[hsl(var(--e-muted-foreground))]">{campaign.description || "No description provided."}</p>
                    <div className="flex flex-wrap gap-2">
                      {(campaign.jobTypes ?? []).length > 0
                        ? (campaign.jobTypes ?? []).map((jt) => (
                            <EBadge key={jt} tone="neutral">{serviceOptions.find((o) => o.value === jt)?.label ?? jt}</EBadge>
                          ))
                        : <EBadge tone="neutral">All services</EBadge>}
                    </div>
                  </ECardBody>
                </ECard>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <ECard>
            <ECardHeader className="pb-3"><ECardTitle className="text-[0.95rem]">{editingPlanId ? "Edit subscription plan" : "New subscription plan"}</ECardTitle></ECardHeader>
            <ECardBody className="space-y-4 pt-0">
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Slug"><EInput value={planForm.slug} onChange={(e) => setPlanForm((c) => ({ ...c, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="weekly-reset" /></EField>
                <EField label="Name"><EInput value={planForm.name} onChange={(e) => setPlanForm((c) => ({ ...c, name: e.target.value }))} /></EField>
              </div>
              <EField label="Tagline"><EInput value={planForm.tagline} onChange={(e) => setPlanForm((c) => ({ ...c, tagline: e.target.value }))} /></EField>
              <EField label="Description"><ETextarea rows={4} value={planForm.description} onChange={(e) => setPlanForm((c) => ({ ...c, description: e.target.value }))} /></EField>
              <div className="grid gap-4 sm:grid-cols-3">
                <EField label="Starting price"><EInput type="number" min={0} value={planForm.startingPrice} onChange={(e) => setPlanForm((c) => ({ ...c, startingPrice: e.target.value }))} /></EField>
                <EField label="Price label"><EInput value={planForm.priceLabel} onChange={(e) => setPlanForm((c) => ({ ...c, priceLabel: e.target.value }))} placeholder="From $170 per week" /></EField>
                <EField label="Sort order"><EInput type="number" min={0} value={planForm.sortOrder} onChange={(e) => setPlanForm((c) => ({ ...c, sortOrder: e.target.value }))} /></EField>
              </div>
              <div className="space-y-2">
                <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Service types</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {serviceOptions.map((s) => (
                    <CheckRow key={s.value} label={s.label} checked={planForm.serviceTypes.includes(s.value)} onChange={(checked) => setPlanForm((c) => ({ ...c, serviceTypes: checked ? [...c.serviceTypes, s.value] : c.serviceTypes.filter((v) => v !== s.value) }))} />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Cadence options</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {cadenceOptions.map((c) => (
                    <CheckRow key={c} label={c} checked={planForm.cadenceOptions.includes(c)} onChange={(checked) => setPlanForm((f) => ({ ...f, cadenceOptions: checked ? [...f.cadenceOptions, c] : f.cadenceOptions.filter((v) => v !== c) }))} />
                  ))}
                </div>
              </div>
              <EField label="Features (one per line)"><ETextarea rows={5} value={planForm.featuresText} onChange={(e) => setPlanForm((c) => ({ ...c, featuresText: e.target.value }))} /></EField>
              <div className="grid gap-4 sm:grid-cols-3">
                <EField label="Theme key"><EInput value={planForm.themeKey} onChange={(e) => setPlanForm((c) => ({ ...c, themeKey: e.target.value }))} placeholder="ocean" /></EField>
                <EField label="CTA label"><EInput value={planForm.ctaLabel} onChange={(e) => setPlanForm((c) => ({ ...c, ctaLabel: e.target.value }))} /></EField>
                <EField label="CTA href"><EInput value={planForm.ctaHref} onChange={(e) => setPlanForm((c) => ({ ...c, ctaHref: e.target.value }))} /></EField>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
                <ESwitch checked={planForm.isPublished} onCheckedChange={(v) => setPlanForm((c) => ({ ...c, isPublished: v }))} label="Published on the public site" />
              </div>
              <div className="flex flex-wrap gap-2">
                <EButton onClick={savePlan} disabled={planSaving}>{planSaving ? "Saving…" : editingPlanId ? "Save changes" : "Create plan"}</EButton>
                <EButton type="button" variant="outline" onClick={resetPlanForm}>Reset</EButton>
              </div>
            </ECardBody>
          </ECard>

          <div className="space-y-4">
            {plans.length === 0 ? (
              <EEmptyState
                eyebrow="Plans"
                title="No subscription plans yet"
                description="Create public-facing plan ideas here. Marketing records only in this phase, not live client subscriptions."
                action={<EButton onClick={resetPlanForm}><Plus className="h-4 w-4" />New plan</EButton>}
              />
            ) : (
              plans.map((plan) => (
                <ECard key={plan.id}>
                  <ECardBody className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Rocket className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
                          <p className="font-semibold text-[hsl(var(--e-foreground))]">{plan.name}</p>
                          {!plan.isPublished ? <EBadge tone="neutral" soft>Hidden</EBadge> : null}
                        </div>
                        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                          {plan.priceLabel || (typeof plan.startingPrice === "number" ? formatCurrency(plan.startingPrice) : "Custom pricing")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <EButton variant="outline" size="sm" onClick={() => {
                          setEditingPlanId(plan.id);
                          setTab("plans");
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
                        }}>Edit</EButton>
                        <EButton variant="danger" size="sm" onClick={() => setConfirmState({ kind: "plan", id: plan.id })}>Delete</EButton>
                      </div>
                    </div>
                    <p className="text-[0.8125rem] leading-6 text-[hsl(var(--e-muted-foreground))]">{plan.description || "No description provided."}</p>
                    <div className="flex flex-wrap gap-2">
                      {(plan.serviceTypes ?? []).map((jt) => (
                        <EBadge key={jt} tone="neutral">{serviceOptions.find((o) => o.value === jt)?.label ?? jt}</EBadge>
                      ))}
                    </div>
                    {(plan.features ?? []).length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(plan.features ?? []).map((f) => (
                          <div key={f} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{f}</div>
                        ))}
                      </div>
                    ) : null}
                  </ECardBody>
                </ECard>
              ))
            )}
          </div>
        </div>
      )}

      <EConfirmModal
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        title={confirmState?.kind === "plan" ? "Delete subscription plan" : "Delete campaign"}
        description={
          confirmState?.kind === "plan"
            ? "This will remove the plan from the public subscriptions catalogue."
            : "This will remove the campaign from the public marketing tools."
        }
        confirmLabel={confirmState?.kind === "plan" ? "Delete plan" : "Delete campaign"}
        loading={confirmLoading}
        onConfirm={runDelete}
      />
    </div>
  );
}
