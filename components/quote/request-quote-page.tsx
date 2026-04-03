"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ImagePlus, Quote, Sparkles, TicketPercent, X } from "lucide-react";
import { MARKETED_SERVICES, SERVICE_FAMILY_META, getMarketedService, getServicesByFamily, type ServiceFamily } from "@/lib/marketing/catalog";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";

type Mode = "public" | "client";

type QuoteResult = {
  total?: number;
  gst?: number;
  subtotal?: number;
  discountTotal?: number;
  appliedCampaign?: { code: string; title: string; discountType: string; discountValue: number } | null;
  lineItems?: { label: string; total: number; qty: number; unitPrice: number }[];
  pricingMode?: "exact" | "fallback";
  requiresAdminApproval?: boolean;
};

const wizardSteps = [
  "Service family",
  "Service",
  "Property photos",
  "Property profile",
  "Site conditions",
  "Timing & promo",
  "Estimate",
  "Your details",
] as const;

const roomBasedServices = new Set<MarketedJobTypeValue>([
  "AIRBNB_TURNOVER",
  "GENERAL_CLEAN",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "SPRING_CLEANING",
]);
const areaBasedServices = new Set<MarketedJobTypeValue>([
  "PRESSURE_WASH",
  "TILE_GROUT_CLEANING",
  "LAWN_MOWING",
  "COMMERCIAL_RECURRING",
  "POST_CONSTRUCTION",
  "MOLD_TREATMENT",
  "GUTTER_CLEANING",
]);
const unitBasedServices = new Set<MarketedJobTypeValue>([
  "CARPET_STEAM_CLEAN",
  "UPHOLSTERY_CLEANING",
  "WINDOW_CLEAN",
]);

const AREA_BANDS = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
  { value: "extra_large", label: "Extra large" },
] as const;

const WINDOW_ACCESS = [
  { value: "minimal", label: "Minimal access complexity" },
  { value: "standard", label: "Standard access" },
  { value: "extensive", label: "Complex / extensive access" },
] as const;

const PARKING_ACCESS = [
  { value: "easy", label: "Easy parking / access" },
  { value: "street", label: "Street parking" },
  { value: "limited", label: "Limited parking / hard access" },
] as const;

const FREQUENCIES = [
  { value: "one_off", label: "One-off" },
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
] as const;

const serviceLabelByType = new Map<MarketedJobTypeValue, string>(MARKETED_SERVICES.map((service) => [service.jobType, service.label]));

function defaultServiceForFamily(family: ServiceFamily) {
  return getServicesByFamily(family)[0]?.jobType ?? "AIRBNB_TURNOVER";
}

function unitPromptForService(serviceType: MarketedJobTypeValue) {
  if (serviceType === "WINDOW_CLEAN") return { label: "Approximate window count", placeholder: "20" };
  if (serviceType === "CARPET_STEAM_CLEAN") return { label: "Rooms to treat", placeholder: "3" };
  if (serviceType === "UPHOLSTERY_CLEANING") return { label: "Pieces to treat", placeholder: "2" };
  return { label: "Service units", placeholder: "1" };
}

export function RequestQuotePage({ mode }: { mode: Mode }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedFamily, setSelectedFamily] = useState<ServiceFamily>("short_stay");
  const [serviceType, setServiceType] = useState<MarketedJobTypeValue>(defaultServiceForFamily("short_stay"));
  const [form, setForm] = useState({
    bedrooms: "2",
    bathrooms: "1",
    floors: "1",
    areaBand: "standard",
    areaSqm: "",
    serviceUnits: "",
    windowCount: "",
    windowAccess: "standard",
    parkingAccess: "easy",
    frequency: "one_off",
    hasBalcony: false,
    exteriorAccess: false,
    oven: false,
    fridge: false,
    heavyMess: false,
    sameDay: false,
    furnished: false,
    pets: false,
    outdoorArea: false,
    conditionLevel: "standard",
    promoCode: "",
    scopeNotes: "",
  });
  const [lead, setLead] = useState({ name: "", email: "", phone: "", address: "", suburb: "" });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState<Set<string>>(new Set());
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [manualQuoteRequired, setManualQuoteRequired] = useState(false);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState<string | null>(null);

  const currentService = useMemo(() => getMarketedService(serviceType), [serviceType]);
  const familyServices = useMemo(() => getServicesByFamily(selectedFamily), [selectedFamily]);
  const progress = ((stepIndex + 1) / wizardSteps.length) * 100;

  useEffect(() => {
    if (mode !== "public") return;
    const params = new URLSearchParams(window.location.search);
    const rawServiceType = params.get("serviceType");
    const matched = rawServiceType ? MARKETED_SERVICES.find((service) => service.jobType === rawServiceType) : null;
    if (matched) {
      setSelectedFamily(matched.family);
      setServiceType(matched.jobType);
    }
  }, [mode]);

  async function uploadPhoto(file: File) {
    const tempId = `${file.name}-${Date.now()}`;
    setUploadingPhotos((prev) => new Set(prev).add(tempId));
    try {
      const params = new URLSearchParams({ filename: file.name, contentType: file.type });
      const presignRes = await fetch(`/api/uploads/presign?${params.toString()}`);
      if (!presignRes.ok) throw new Error("Could not get upload URL.");
      const { url, publicUrl } = (await presignRes.json()) as { url: string; publicUrl: string };
      const uploadRes = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadRes.ok) throw new Error("Upload failed.");
      setPhotoUrls((prev) => [...prev, publicUrl]);
    } catch (error: any) {
      toast({ title: "Photo upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploadingPhotos((prev) => { const next = new Set(prev); next.delete(tempId); return next; });
    }
  }

  async function handlePhotoFiles(files: FileList | null) {
    if (!files) return;
    const remaining = 5 - photoUrls.length;
    const toUpload = Array.from(files).slice(0, remaining);
    await Promise.all(toUpload.map(uploadPhoto));
  }

  async function validateCampaign() {
    if (!form.promoCode.trim()) {
      setCampaignMessage(null);
      return;
    }
    const response = await fetch(`/api/public/campaign?code=${encodeURIComponent(form.promoCode)}&serviceType=${serviceType}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setCampaignMessage(body.reason ?? body.error ?? "Promo code is not valid for this request.");
      return;
    }
    setCampaignMessage(`${body.campaign.code} is valid and will be applied if the estimate qualifies.`);
  }

  async function buildEstimate() {
    if (!currentService) return;
    if (currentService.autoPricingMode === "manual") {
      setResult(null);
      setManualQuoteRequired(true);
      return;
    }

    setLoadingEstimate(true);
    try {
      const response = await fetch("/api/public/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          bedrooms: Number(form.bedrooms || 0),
          bathrooms: Number(form.bathrooms || 0),
          floors: Number(form.floors || 1),
          areaBand: form.areaBand,
          areaSqm: form.areaSqm ? Number(form.areaSqm) : undefined,
          serviceUnits: form.serviceUnits ? Number(form.serviceUnits) : undefined,
          windowCount: form.windowCount ? Number(form.windowCount) : undefined,
          windowAccess: form.windowAccess,
          parkingAccess: form.parkingAccess,
          frequency: form.frequency,
          hasBalcony: form.hasBalcony,
          exteriorAccess: form.exteriorAccess,
          addOns: {
            oven: form.oven,
            fridge: form.fridge,
            heavyMess: form.heavyMess,
            sameDay: form.sameDay,
            furnished: form.furnished,
            pets: form.pets,
            outdoorArea: form.outdoorArea,
          },
          conditionLevel: form.conditionLevel,
          promoCode: form.promoCode || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body?.requiresManualQuote) {
          setResult(null);
          setManualQuoteRequired(true);
          setCampaignMessage(body.error ?? null);
          return;
        }
        throw new Error(body.error ?? "Could not calculate quote.");
      }
      setResult(body as QuoteResult);
      setManualQuoteRequired(false);
      setCampaignMessage(body.appliedCampaign ? `Campaign ${body.appliedCampaign.code} applied to the estimate.` : campaignMessage);
    } catch (error: any) {
      toast({ title: "Estimate failed", description: error.message, variant: "destructive" });
    } finally {
      setLoadingEstimate(false);
    }
  }

  async function submitLead() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          suburb: lead.suburb,
          bedrooms: roomBasedServices.has(serviceType) ? Number(form.bedrooms || 0) : undefined,
          bathrooms: roomBasedServices.has(serviceType) ? Number(form.bathrooms || 0) : undefined,
          hasBalcony: form.hasBalcony,
          estimateMin: result?.subtotal,
          estimateMax: result?.total,
          requestedServiceLabel: serviceLabelByType.get(serviceType),
          promoCode: form.promoCode || undefined,
          structuredContext: {
            serviceFamily: selectedFamily,
            serviceType,
            serviceLabel: serviceLabelByType.get(serviceType),
            floors: Number(form.floors || 1),
            areaBand: form.areaBand,
            areaSqm: form.areaSqm ? Number(form.areaSqm) : undefined,
            serviceUnits: form.serviceUnits ? Number(form.serviceUnits) : undefined,
            windowCount: form.windowCount ? Number(form.windowCount) : undefined,
            windowAccess: form.windowAccess,
            parkingAccess: form.parkingAccess,
            frequency: form.frequency,
            conditionLevel: form.conditionLevel,
            addOns: {
              balcony: form.hasBalcony,
              exteriorAccess: form.exteriorAccess,
              oven: form.oven,
              fridge: form.fridge,
              heavyMess: form.heavyMess,
              sameDay: form.sameDay,
              furnished: form.furnished,
              pets: form.pets,
              outdoorArea: form.outdoorArea,
            },
            estimate: result,
            manualQuoteRequired,
            submittedFrom: mode,
            photoUrls,
          },
          notes: [
            manualQuoteRequired ? "Manual review required before final pricing." : "Instant estimate generated.",
            form.scopeNotes ? `Scope notes: ${form.scopeNotes}` : "",
            mode === "client" ? "Submitted from client portal." : "Submitted from public website.",
          ].filter(Boolean).join("\n"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send quote request.");
      setSubmitted(true);
    } catch (error: any) {
      toast({ title: "Submission failed", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (stepIndex === 6) {
      buildEstimate().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function nextStep() {
    setStepIndex((current) => Math.min(current + 1, wizardSteps.length - 1));
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  if (submitted) {
    return (
      <div className={mode === "public" ? `${PUBLIC_PAGE_CONTAINER} py-8 lg:py-10` : "space-y-6"}>
        <Card className="rounded-[2rem] border-primary/10 bg-white/85 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
          <CardContent className="space-y-4 py-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-semibold">Request received.</h2>
            <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground">
              {manualQuoteRequired ? "The request has been routed for manual review so the team can confirm the right scope and price." : "Your estimate and scope details have been saved with the request so the team can confirm the next step quickly."}
            </p>
            <p className="text-3xl font-semibold text-primary">
              {manualQuoteRequired ? "Manual Review" : formatCurrency(result?.total ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={mode === "public" ? `${PUBLIC_PAGE_CONTAINER} py-8 lg:py-10` : "space-y-6"}>
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)] xl:gap-8 2xl:gap-10">
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Quote className="h-3.5 w-3.5" />
              {mode === "client" ? "Quote request" : "Instant quote"}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Quote the service properly before you send the request.</h1>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
              Start with the service family, then refine the details so the estimate reflects the actual property, access, and condition instead of forcing you into a vague flat rate.
            </p>
          </div>

          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)] xl:sticky xl:top-24">
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span>Step {stepIndex + 1} of {wizardSteps.length}</span>
                <span>{wizardSteps[stepIndex]}</span>
              </div>
              <Progress value={progress} />
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-2 xl:grid-cols-4">
                {wizardSteps.map((label, index) => (
                  <div key={label} className={`min-w-[132px] rounded-2xl border px-3 py-3 text-xs sm:min-w-0 ${index === stepIndex ? "border-primary/40 bg-primary/5 text-primary" : "border-border/70 text-muted-foreground"}`}>
                    <p className="font-semibold">{index + 1}</p>
                    <p className="mt-1 leading-5">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
            <CardContent className="space-y-3 p-6">
              <div className={`inline-flex rounded-2xl bg-gradient-to-br ${currentService?.cardColor ?? "from-primary/90 to-primary/70"} p-3 text-white shadow-sm`}>
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Current service</p>
                <h2 className="mt-1 text-2xl font-semibold">{currentService?.label}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentService?.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {(currentService?.highlights ?? []).map((item) => (
                  <span key={item} className="rounded-full border border-border/70 px-3 py-1">{item}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[2rem] border-white/70 bg-white/85 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
          <CardHeader>
            <CardTitle>{wizardSteps[stepIndex]}</CardTitle>
            <CardDescription>
              {stepIndex < 5 ? "Move step by step so the estimate reflects the actual scope. If the work should be reviewed properly first, the request will switch to a tailored quote path." : "Review the estimate and send the request with the full scope context attached."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {stepIndex === 0 ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(Object.keys(SERVICE_FAMILY_META) as ServiceFamily[]).map((family) => (
                    <button
                      type="button"
                      key={family}
                      onClick={() => {
                        setSelectedFamily(family);
                        setServiceType(defaultServiceForFamily(family));
                      }}
                      className={`rounded-[1.5rem] border p-5 text-left transition-colors ${selectedFamily === family ? "border-primary/40 bg-primary/5" : "border-border/70 bg-white"}`}
                    >
                      <p className="font-semibold">{SERVICE_FAMILY_META[family].label}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{SERVICE_FAMILY_META[family].description}</p>
                    </button>
                  ))}
                </div>

                <div className="rounded-[1.5rem] border border-border/70 bg-muted/20 p-4 sm:p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Services in this category</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {familyServices.map((service) => (
                      <div key={service.jobType} className="rounded-2xl border border-border/70 bg-white px-4 py-3">
                        <p className="font-medium">{service.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{service.tagline}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Next, choose the exact service you want quoted from this category.
                  </p>
                </div>
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {familyServices.map((service) => (
                  <button
                    type="button"
                    key={service.jobType}
                    onClick={() => setServiceType(service.jobType)}
                    className={`rounded-[1.5rem] border p-5 text-left transition-colors ${serviceType === service.jobType ? "border-primary/40 bg-primary/5" : "border-border/70 bg-white"}`}
                  >
                    <p className="font-semibold">{service.label}</p>
                    <p className="mt-1 text-sm font-medium text-primary">{service.tagline}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{service.summary}</p>
                    <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{service.autoPricingMode === "estimate" ? "Instant estimate path" : "Manual review path"}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div className="space-y-5">
                <p className="text-sm leading-6 text-muted-foreground">
                  Upload photos of the property to help us quote accurately. Kitchen, bathrooms, and problem areas are most useful.
                  <span className="ml-1 font-medium text-foreground">This step is optional — skip if not ready.</span>
                </p>

                {/* Upload button */}
                <div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { void handlePhotoFiles(e.target.files); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    disabled={photoUrls.length >= 5 || uploadingPhotos.size > 0}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-2 h-4 w-4" />
                    {photoUrls.length >= 5 ? "Maximum 5 photos" : "Upload photos"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">{photoUrls.length}/5 photos uploaded</p>
                </div>

                {/* Uploading indicator */}
                {uploadingPhotos.size > 0 && (
                  <p className="text-sm text-primary animate-pulse">Uploading {uploadingPhotos.size} photo{uploadingPhotos.size > 1 ? "s" : ""}…</p>
                )}

                {/* Photo thumbnails */}
                {photoUrls.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {photoUrls.map((url) => (
                      <div key={url} className="group relative h-24 w-24 overflow-hidden rounded-2xl border border-border/70 bg-muted shadow-sm">
                        <img src={url} alt="Uploaded property photo" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setPhotoUrls((prev) => prev.filter((u) => u !== url))}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                          aria-label="Remove photo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {stepIndex === 3 ? (
              <div className="space-y-4">
                {roomBasedServices.has(serviceType) ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2"><Label>Bedrooms</Label><Input value={form.bedrooms} onChange={(event) => setForm((current) => ({ ...current, bedrooms: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>Bathrooms</Label><Input value={form.bathrooms} onChange={(event) => setForm((current) => ({ ...current, bathrooms: event.target.value }))} /></div>
                    <div className="space-y-2"><Label>Floors</Label><Input value={form.floors} onChange={(event) => setForm((current) => ({ ...current, floors: event.target.value }))} /></div>
                  </div>
                ) : null}

                {areaBasedServices.has(serviceType) ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label>Estimated service area (sqm)</Label><Input value={form.areaSqm} onChange={(event) => setForm((current) => ({ ...current, areaSqm: event.target.value }))} placeholder="Optional if unknown" /></div>
                    <div className="space-y-2">
                      <Label>Area band</Label>
                      <Select value={form.areaBand} onValueChange={(value) => setForm((current) => ({ ...current, areaBand: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{AREA_BANDS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {unitBasedServices.has(serviceType) ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label>{unitPromptForService(serviceType).label}</Label><Input value={serviceType === "WINDOW_CLEAN" ? form.windowCount : form.serviceUnits} onChange={(event) => setForm((current) => serviceType === "WINDOW_CLEAN" ? { ...current, windowCount: event.target.value } : { ...current, serviceUnits: event.target.value })} placeholder={unitPromptForService(serviceType).placeholder} /></div>
                    <div className="space-y-2"><Label>Floors / storeys</Label><Input value={form.floors} onChange={(event) => setForm((current) => ({ ...current, floors: event.target.value }))} /></div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>Anything the estimator should know?</Label>
                  <Textarea rows={4} value={form.scopeNotes} onChange={(event) => setForm((current) => ({ ...current, scopeNotes: event.target.value }))} placeholder="For example: neglected condition, limited access, staged clean, inspection pressure, furnished site, pets, or unusual exterior access." />
                </div>
              </div>
            ) : null}

            {stepIndex === 4 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Condition level</Label>
                    <Select value={form.conditionLevel} onValueChange={(value) => setForm((current) => ({ ...current, conditionLevel: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="heavy">Heavy</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Parking / access</Label>
                    <Select value={form.parkingAccess} onValueChange={(value) => setForm((current) => ({ ...current, parkingAccess: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PARKING_ACCESS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Window / access complexity</Label>
                  <Select value={form.windowAccess} onValueChange={(value) => setForm((current) => ({ ...current, windowAccess: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{WINDOW_ACCESS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { key: "hasBalcony", label: "Balcony or extra outdoor access" },
                    { key: "exteriorAccess", label: "Exterior / ladder-style access" },
                    { key: "oven", label: "Oven clean" },
                    { key: "fridge", label: "Fridge clean" },
                    { key: "heavyMess", label: "Heavy mess / recovery work" },
                    { key: "furnished", label: "Furnished property" },
                    { key: "pets", label: "Pets / pet hair" },
                    { key: "outdoorArea", label: "Outdoor entry / patio area" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 rounded-2xl border border-border/70 px-4 py-3 text-sm">
                      <Checkbox checked={(form as Record<string, boolean | string>)[key] === true} onCheckedChange={(checked) => setForm((current) => ({ ...current, [key]: checked === true }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {stepIndex === 5 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Service cadence</Label>
                    <Select value={form.frequency} onValueChange={(value) => setForm((current) => ({ ...current, frequency: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FREQUENCIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-3 rounded-2xl border border-border/70 px-4 py-3 text-sm">
                    <Checkbox checked={form.sameDay} onCheckedChange={(checked) => setForm((current) => ({ ...current, sameDay: checked === true }))} />
                    <span>Priority or same-day turnaround</span>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label>Promo code</Label>
                    <Input value={form.promoCode} onChange={(event) => setForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))} placeholder="Optional" />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" onClick={validateCampaign} className="w-full sm:w-auto">
                      <TicketPercent className="mr-2 h-4 w-4" />
                      Check code
                    </Button>
                  </div>
                </div>
                {campaignMessage ? <p className="text-sm text-muted-foreground">{campaignMessage}</p> : null}
              </div>
            ) : null}

            {stepIndex === 6 ? (
              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-border/70 bg-white px-4 py-4">
                  {loadingEstimate ? (
                    <p className="text-sm text-muted-foreground">Building estimate...</p>
                  ) : manualQuoteRequired ? (
                    <div className="space-y-2">
                      <p className="text-lg font-semibold">Manual review required</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        This service or scope should not be guessed automatically. The request will still carry the full structured context into the admin review flow.
                      </p>
                    </div>
                  ) : result ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Estimated total</p>
                        <p className="text-4xl font-semibold text-primary">{formatCurrency(result.total ?? 0)}</p>
                        <p className="text-xs text-muted-foreground">Includes GST of {formatCurrency(result.gst ?? 0)}</p>
                      </div>
                      <div className="space-y-2 text-sm">
                        {(result.lineItems ?? []).map((item) => (
                          <div key={`${item.label}-${item.total}`} className="flex items-center justify-between gap-4">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-medium">{item.total < 0 ? `-${formatCurrency(Math.abs(item.total))}` : formatCurrency(item.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No estimate has been generated yet.</p>
                  )}
                </div>
                <Button type="button" variant="outline" onClick={buildEstimate} disabled={loadingEstimate}>Refresh estimate</Button>
              </div>
            ) : null}

            {stepIndex === 7 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Full name</Label><Input value={lead.name} onChange={(event) => setLead((current) => ({ ...current, name: event.target.value }))} /></div>
                  <div className="space-y-2"><Label>Email</Label><Input type="email" value={lead.email} onChange={(event) => setLead((current) => ({ ...current, email: event.target.value }))} /></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Phone</Label><Input value={lead.phone} onChange={(event) => setLead((current) => ({ ...current, phone: event.target.value }))} placeholder="0451217210 or +61451217210" /></div>
                  <div className="space-y-2"><Label>Suburb</Label><Input value={lead.suburb} onChange={(event) => setLead((current) => ({ ...current, suburb: event.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label>Address</Label><Input value={lead.address} onChange={(event) => setLead((current) => ({ ...current, address: event.target.value }))} placeholder="Optional but useful for accurate review" /></div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:justify-between">
              <Button type="button" variant="outline" onClick={previousStep} disabled={stepIndex === 0} className="w-full sm:w-auto">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                {stepIndex === 2 && (
                  <Button type="button" variant="ghost" onClick={nextStep} className="w-full sm:w-auto text-muted-foreground">
                    Skip this step →
                  </Button>
                )}
                {stepIndex < wizardSteps.length - 1 ? (
                  <Button type="button" onClick={nextStep} disabled={stepIndex === 2 && uploadingPhotos.size > 0} className="w-full sm:w-auto">
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" onClick={submitLead} disabled={submitting || !lead.name || !lead.email} className="w-full sm:w-auto">
                    {submitting ? "Submitting..." : manualQuoteRequired ? "Request manual quote" : "Send quote request"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
