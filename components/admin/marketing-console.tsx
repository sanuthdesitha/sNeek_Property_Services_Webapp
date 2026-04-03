"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Rocket, Tag } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { AdminPageShell } from "@/components/admin/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";

const serviceOptions = MARKETED_SERVICES.map((service) => ({ value: service.jobType, label: service.shortLabel }));
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

function toDateTimeInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function MarketingConsole({ initialCampaigns, initialPlans }: { initialCampaigns: CampaignRow[]; initialPlans: PlanRow[] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [plans, setPlans] = useState(initialPlans);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
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

  const activeCampaignCount = useMemo(() => campaigns.filter((campaign) => campaign.isActive).length, [campaigns]);
  const publishedPlanCount = useMemo(() => plans.filter((plan) => plan.isPublished).length, [plans]);

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
    setCampaignSaving(true);
    const payload = {
      code: campaignForm.code,
      title: campaignForm.title,
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
      toast({ title: "Campaign save failed", description: body.error ?? "Could not save campaign.", variant: "destructive" });
      return;
    }

    if (editingCampaignId) {
      setCampaigns((current) => current.map((row) => (row.id === body.id ? body : row)));
    } else {
      setCampaigns((current) => [body, ...current]);
    }
    toast({ title: editingCampaignId ? "Campaign updated" : "Campaign created" });
    resetCampaignForm();
  }

  async function removeCampaign(id: string) {
    const res = await fetch(`/api/admin/campaigns/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete campaign.", variant: "destructive" });
      return;
    }
    setCampaigns((current) => current.filter((row) => row.id !== id));
    toast({ title: "Campaign removed" });
    if (editingCampaignId === id) resetCampaignForm();
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
      features: planForm.featuresText.split(/\r?\n/).map((row) => row.trim()).filter(Boolean),
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
      toast({ title: "Plan save failed", description: body.error ?? "Could not save subscription plan.", variant: "destructive" });
      return;
    }

    if (editingPlanId) {
      setPlans((current) => current.map((row) => (row.id === body.id ? body : row)));
    } else {
      setPlans((current) => [...current, body].sort((a, b) => a.sortOrder - b.sortOrder));
    }
    toast({ title: editingPlanId ? "Plan updated" : "Plan created" });
    resetPlanForm();
  }

  async function removePlan(id: string) {
    const res = await fetch(`/api/admin/subscriptions/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete plan.", variant: "destructive" });
      return;
    }
    setPlans((current) => current.filter((row) => row.id !== id));
    toast({ title: "Plan removed" });
    if (editingPlanId === id) resetPlanForm();
  }

  return (
    <AdminPageShell
      eyebrow="Marketing"
      title="Campaigns, public plans, and quote conversion tools"
      description="Manage public discount campaigns and subscription-style marketing plans without changing the live client billing model. The public site and quote wizard consume these records directly."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild className="rounded-full">
            <a href="/quote" target="_blank" rel="noreferrer">Open quote page</a>
          </Button>
          <Button variant="outline" asChild className="rounded-full">
            <a href="/subscriptions" target="_blank" rel="noreferrer">Open subscriptions page</a>
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-[1.7rem] border-white/70 bg-white/80">
          <CardContent className="space-y-1 p-5">
            <p className="text-sm text-muted-foreground">Active campaigns</p>
            <p className="text-3xl font-semibold">{activeCampaignCount}</p>
          </CardContent>
        </Card>
        <Card className="rounded-[1.7rem] border-white/70 bg-white/80">
          <CardContent className="space-y-1 p-5">
            <p className="text-sm text-muted-foreground">Published plans</p>
            <p className="text-3xl font-semibold">{publishedPlanCount}</p>
          </CardContent>
        </Card>
        <Card className="rounded-[1.7rem] border-white/70 bg-white/80">
          <CardContent className="space-y-1 p-5">
            <p className="text-sm text-muted-foreground">Quote-ready service catalogue</p>
            <p className="text-3xl font-semibold">{serviceOptions.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="plans">Subscription Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="rounded-[1.8rem] border-white/70 bg-white/80">
            <CardHeader>
              <CardTitle>{editingCampaignId ? "Edit campaign" : "New campaign"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Code</Label><Input value={campaignForm.code} onChange={(event) => setCampaignForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="WELCOME10" /></div>
                <div className="space-y-2"><Label>Title</Label><Input value={campaignForm.title} onChange={(event) => setCampaignForm((current) => ({ ...current, title: event.target.value }))} placeholder="Welcome offer" /></div>
              </div>
              <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={campaignForm.description} onChange={(event) => setCampaignForm((current) => ({ ...current, description: event.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label>Type</Label><Input value={campaignForm.discountType} onChange={(event) => setCampaignForm((current) => ({ ...current, discountType: event.target.value.toUpperCase() }))} placeholder="PERCENT or FIXED" /></div>
                <div className="space-y-2"><Label>Value</Label><Input type="number" min={0} value={campaignForm.discountValue} onChange={(event) => setCampaignForm((current) => ({ ...current, discountValue: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Min subtotal</Label><Input type="number" min={0} value={campaignForm.minSubtotal} onChange={(event) => setCampaignForm((current) => ({ ...current, minSubtotal: event.target.value }))} placeholder="Optional" /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Starts at</Label><Input type="datetime-local" value={campaignForm.startsAt} onChange={(event) => setCampaignForm((current) => ({ ...current, startsAt: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Ends at</Label><Input type="datetime-local" value={campaignForm.endsAt} onChange={(event) => setCampaignForm((current) => ({ ...current, endsAt: event.target.value }))} /></div>
              </div>
              <div className="space-y-2"><Label>Usage limit</Label><Input type="number" min={1} value={campaignForm.usageLimit} onChange={(event) => setCampaignForm((current) => ({ ...current, usageLimit: event.target.value }))} placeholder="Optional" /></div>
              <div className="space-y-3">
                <Label>Applies to services</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {serviceOptions.map((service) => (
                    <label key={service.value} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 text-sm">
                      <Checkbox checked={campaignForm.jobTypes.includes(service.value)} onCheckedChange={(checked) => setCampaignForm((current) => ({ ...current, jobTypes: checked === true ? [...current.jobTypes, service.value] : current.jobTypes.filter((value) => value !== service.value) }))} />
                      <span>{service.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 text-sm">
                <Switch checked={campaignForm.isActive} onCheckedChange={(value) => setCampaignForm((current) => ({ ...current, isActive: value }))} />
                <span>Campaign active</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveCampaign} disabled={campaignSaving}>{campaignSaving ? "Saving..." : editingCampaignId ? "Save changes" : "Create campaign"}</Button>
                <Button type="button" variant="outline" onClick={resetCampaignForm}>Reset</Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {campaigns.length === 0 ? (
              <EmptyState title="No campaigns yet" description="Create discount campaigns here and the public quote wizard can validate them by code." action={<Button onClick={resetCampaignForm}><Plus className="mr-2 h-4 w-4" />New campaign</Button>} />
            ) : (
              campaigns.map((campaign) => (
                <Card key={campaign.id} className="rounded-[1.7rem] border-white/70 bg-white/80">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Tag className="h-4 w-4 text-primary" />
                          <p className="font-semibold">{campaign.title}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{campaign.code} • {campaign.discountType === "PERCENT" ? `${campaign.discountValue}% off` : formatCurrency(campaign.discountValue)} {campaign.minSubtotal ? `• min ${formatCurrency(campaign.minSubtotal)}` : ""}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
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
                        }}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => removeCampaign(campaign.id)}>Delete</Button>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{campaign.description || "No description provided."}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(campaign.jobTypes ?? []).length > 0 ? (campaign.jobTypes ?? []).map((jobType) => (
                        <span key={jobType} className="rounded-full border border-border/70 px-3 py-1">{serviceOptions.find((option) => option.value === jobType)?.label ?? jobType}</span>
                      )) : <span className="rounded-full border border-border/70 px-3 py-1">All services</span>}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="plans" className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="rounded-[1.8rem] border-white/70 bg-white/80">
            <CardHeader>
              <CardTitle>{editingPlanId ? "Edit subscription plan" : "New subscription plan"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Slug</Label><Input value={planForm.slug} onChange={(event) => setPlanForm((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="weekly-reset" /></div>
                <div className="space-y-2"><Label>Name</Label><Input value={planForm.name} onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))} /></div>
              </div>
              <div className="space-y-2"><Label>Tagline</Label><Input value={planForm.tagline} onChange={(event) => setPlanForm((current) => ({ ...current, tagline: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea rows={4} value={planForm.description} onChange={(event) => setPlanForm((current) => ({ ...current, description: event.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label>Starting price</Label><Input type="number" min={0} value={planForm.startingPrice} onChange={(event) => setPlanForm((current) => ({ ...current, startingPrice: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Price label</Label><Input value={planForm.priceLabel} onChange={(event) => setPlanForm((current) => ({ ...current, priceLabel: event.target.value }))} placeholder="From $170 per week" /></div>
                <div className="space-y-2"><Label>Sort order</Label><Input type="number" min={0} value={planForm.sortOrder} onChange={(event) => setPlanForm((current) => ({ ...current, sortOrder: event.target.value }))} /></div>
              </div>
              <div className="space-y-3">
                <Label>Service types</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {serviceOptions.map((service) => (
                    <label key={service.value} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 text-sm">
                      <Checkbox checked={planForm.serviceTypes.includes(service.value)} onCheckedChange={(checked) => setPlanForm((current) => ({ ...current, serviceTypes: checked === true ? [...current.serviceTypes, service.value] : current.serviceTypes.filter((value) => value !== service.value) }))} />
                      <span>{service.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Label>Cadence options</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {cadenceOptions.map((cadence) => (
                    <label key={cadence} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 text-sm">
                      <Checkbox checked={planForm.cadenceOptions.includes(cadence)} onCheckedChange={(checked) => setPlanForm((current) => ({ ...current, cadenceOptions: checked === true ? [...current.cadenceOptions, cadence] : current.cadenceOptions.filter((value) => value !== cadence) }))} />
                      <span>{cadence}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2"><Label>Features (one per line)</Label><Textarea rows={5} value={planForm.featuresText} onChange={(event) => setPlanForm((current) => ({ ...current, featuresText: event.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label>Theme key</Label><Input value={planForm.themeKey} onChange={(event) => setPlanForm((current) => ({ ...current, themeKey: event.target.value }))} placeholder="ocean" /></div>
                <div className="space-y-2"><Label>CTA label</Label><Input value={planForm.ctaLabel} onChange={(event) => setPlanForm((current) => ({ ...current, ctaLabel: event.target.value }))} /></div>
                <div className="space-y-2"><Label>CTA href</Label><Input value={planForm.ctaHref} onChange={(event) => setPlanForm((current) => ({ ...current, ctaHref: event.target.value }))} /></div>
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-3 text-sm">
                <Switch checked={planForm.isPublished} onCheckedChange={(value) => setPlanForm((current) => ({ ...current, isPublished: value }))} />
                <span>Published on the public site</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={savePlan} disabled={planSaving}>{planSaving ? "Saving..." : editingPlanId ? "Save changes" : "Create plan"}</Button>
                <Button type="button" variant="outline" onClick={resetPlanForm}>Reset</Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {plans.length === 0 ? (
              <EmptyState title="No subscription plans yet" description="Create public-facing plan ideas here. These are marketing records only in this phase, not live client subscriptions." action={<Button onClick={resetPlanForm}><Plus className="mr-2 h-4 w-4" />New plan</Button>} />
            ) : (
              plans.map((plan) => (
                <Card key={plan.id} className="rounded-[1.7rem] border-white/70 bg-white/80">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Rocket className="h-4 w-4 text-primary" />
                          <p className="font-semibold">{plan.name}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{plan.priceLabel || (typeof plan.startingPrice === "number" ? formatCurrency(plan.startingPrice) : "Custom pricing")}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
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
                        }}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => removePlan(plan.id)}>Delete</Button>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{plan.description || "No description provided."}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(plan.serviceTypes ?? []).map((jobType) => (
                        <span key={jobType} className="rounded-full border border-border/70 px-3 py-1">{serviceOptions.find((option) => option.value === jobType)?.label ?? jobType}</span>
                      ))}
                    </div>
                    {(plan.features ?? []).length > 0 ? (
                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        {(plan.features ?? []).map((feature) => (
                          <div key={feature} className="rounded-2xl border border-border/70 px-3 py-2">{feature}</div>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </AdminPageShell>
  );
}
