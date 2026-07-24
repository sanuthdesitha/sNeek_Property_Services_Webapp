"use client";

/**
 * Estate quote wizard (client portal) — native v2 port of the legacy
 * RequestQuotePage (mode="client"). Same 8-step flow and the SAME endpoints:
 *   POST /api/uploads/direct (FormData file+folder)   → { key, url } (photo uploads)
 *   GET  /api/public/campaign?code&serviceType        (promo validation)
 *   POST /api/public/quote                            (instant estimate)
 *   POST /api/public/lead                             (submit request w/ structuredContext)
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ImagePlus,
  Sparkles,
  TicketPercent,
  X,
} from "lucide-react";
import {
  MARKETED_SERVICES,
  SERVICE_FAMILY_META,
  getMarketedService,
  getServicesByFamily,
  type ServiceFamily,
} from "@/lib/marketing/catalog";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { cn, formatCurrency } from "@/lib/utils";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { ECheckTile, EInlineNotice, EInput, ELabel, ESelect, ETextarea } from "@/components/v2/client/fields";
import { EAddressInput } from "@/components/v2/client/address-input";

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
  "SPECIAL_CLEAN",
  "MOVE_IN_CLEAN",
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

const EXTRA_GROUPS = [
  {
    title: "Kitchen & Appliances",
    items: [
      ["largeKitchen", "Large kitchen"],
      ["oven", "Inside oven, trays and racks"],
      ["grill", "Grill / cooktop detail"],
      ["rangehood", "Rangehood and filters"],
      ["fridge", "Inside fridge"],
      ["fridgeFull", "Full fridge clean"],
      ["freezer", "Freezer clean"],
      ["dishwasher", "Dishwasher inside and out"],
      ["insideCupboards", "Inside cupboards and drawers"],
      ["pantry", "Pantry shelves and doors"],
      ["washDishes", "Wash dishes"],
    ],
  },
  {
    title: "Windows, Walls & Fixtures",
    items: [
      ["interiorWindows", "Interior windows and tracks"],
      ["exteriorWindows", "Exterior windows"],
      ["slidingGlassDoor", "Sliding glass door and tracks"],
      ["blindsShutters", "Blinds / shutters wet wipe"],
      ["wallSpotClean", "Spot clean walls"],
      ["wallWashing", "Full wall washing"],
      ["ceilingFans", "Ceiling fans"],
      ["airConditionerVents", "A/C vents"],
    ],
  },
  {
    title: "Outdoor, Laundry & Rooms",
    items: [
      ["smallBalcony", "Small balcony"],
      ["largeBalcony", "Large balcony"],
      ["deckPatio", "Deck / patio"],
      ["alfresco", "Alfresco area / BBQ exterior"],
      ["pergola", "Pergola"],
      ["garage", "Garage sweep and tidy"],
      ["wardrobe", "Wardrobe tracks, mirrors and internals"],
      ["rumpusRoom", "Rumpus room"],
      ["laundryLoad", "Laundry load / hang out"],
      ["laundryFold", "Fold laundry"],
      ["laundryCloset", "Laundry closet"],
      ["changeBedsheets", "Change bedsheets"],
    ],
  },
  {
    title: "Condition & Specialty",
    items: [
      ["heavyMess", "Heavy duty / extra attention"],
      ["furnished", "Furnished property"],
      ["pets", "Pets / pet hair"],
      ["outdoorArea", "Outdoor entry area"],
      ["carpetSteam", "Carpet steam clean allowance"],
    ],
  },
] as const;

const serviceLabelByType = new Map<MarketedJobTypeValue, string>(
  MARKETED_SERVICES.map((service) => [service.jobType, service.label])
);

function defaultServiceForFamily(family: ServiceFamily) {
  return getServicesByFamily(family)[0]?.jobType ?? "AIRBNB_TURNOVER";
}

function unitPromptForService(serviceType: MarketedJobTypeValue) {
  if (serviceType === "WINDOW_CLEAN") return { label: "Approximate window count", placeholder: "20" };
  if (serviceType === "CARPET_STEAM_CLEAN") return { label: "Rooms to treat", placeholder: "3" };
  if (serviceType === "UPHOLSTERY_CLEANING") return { label: "Pieces to treat", placeholder: "2" };
  return { label: "Service units", placeholder: "1" };
}

export function EstateQuoteWizard({
  defaultName,
  defaultEmail,
  defaultPhone,
}: {
  defaultName?: string | null;
  defaultEmail?: string | null;
  defaultPhone?: string | null;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedFamily, setSelectedFamily] = useState<ServiceFamily>("short_stay");
  const [serviceType, setServiceType] = useState<MarketedJobTypeValue>(
    defaultServiceForFamily("short_stay")
  );
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
    fridgeFull: false,
    freezer: false,
    heavyMess: false,
    sameDay: false,
    furnished: false,
    pets: false,
    outdoorArea: false,
    largeKitchen: false,
    smallBalcony: false,
    largeBalcony: false,
    grill: false,
    rangehood: false,
    dishwasher: false,
    insideCupboards: false,
    pantry: false,
    interiorWindows: false,
    exteriorWindows: false,
    slidingGlassDoor: false,
    blindsShutters: false,
    wallSpotClean: false,
    wallWashing: false,
    ceilingFans: false,
    airConditionerVents: false,
    wardrobe: false,
    garage: false,
    deckPatio: false,
    alfresco: false,
    pergola: false,
    carpetSteam: false,
    changeBedsheets: false,
    washDishes: false,
    laundryLoad: false,
    laundryFold: false,
    laundryCloset: false,
    rumpusRoom: false,
    conditionLevel: "standard",
    promoCode: "",
    preferredDate: "",
    preferredTime: "any",
    scopeNotes: "",
  });
  const [lead, setLead] = useState<{
    name: string;
    email: string;
    phone: string;
    address: string;
    suburb: string;
    state: string;
    postcode: string;
    latitude: number | null;
    longitude: number | null;
    placeId: string | null;
  }>({
    name: defaultName ?? "",
    email: defaultEmail ?? "",
    phone: defaultPhone ?? "",
    address: "",
    suburb: "",
    state: "",
    postcode: "",
    latitude: null,
    longitude: null,
    placeId: null,
  });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState<Set<string>>(new Set());
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [manualQuoteRequired, setManualQuoteRequired] = useState(false);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentService = useMemo(() => getMarketedService(serviceType), [serviceType]);
  const familyServices = useMemo(() => getServicesByFamily(selectedFamily), [selectedFamily]);

  async function uploadPhoto(file: File) {
    const tempId = `${file.name}-${Date.now()}`;
    setUploadingPhotos((prev) => new Set(prev).add(tempId));
    try {
      // Upload THROUGH the server (/api/uploads/direct) — the old presigned
      // browser PUT silently failed in production (no bucket CORS for the
      // site origin), so URLs were saved for objects that never uploaded.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "uploads");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.key || !body.url) {
        throw new Error(body.error ?? `Photo upload failed (${res.status}).`);
      }
      setPhotoUrls((prev) => [...prev, body.url as string]);
    } catch (err: any) {
      setError(err?.message ?? "Photo upload failed.");
    } finally {
      setUploadingPhotos((prev) => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
    }
  }

  async function handlePhotoFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    const remaining = 5 - photoUrls.length;
    const toUpload = Array.from(files).slice(0, remaining);
    await Promise.all(toUpload.map(uploadPhoto));
  }

  async function validateCampaign() {
    if (!form.promoCode.trim()) {
      setCampaignMessage(null);
      return;
    }
    const response = await fetch(
      `/api/public/campaign?code=${encodeURIComponent(form.promoCode)}&serviceType=${serviceType}`
    );
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
    setError(null);
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
            fridgeFull: form.fridgeFull,
            freezer: form.freezer,
            heavyMess: form.heavyMess,
            sameDay: form.sameDay,
            furnished: form.furnished,
            pets: form.pets,
            outdoorArea: form.outdoorArea,
            largeKitchen: form.largeKitchen,
            smallBalcony: form.smallBalcony,
            largeBalcony: form.largeBalcony,
            grill: form.grill,
            rangehood: form.rangehood,
            dishwasher: form.dishwasher,
            insideCupboards: form.insideCupboards,
            pantry: form.pantry,
            interiorWindows: form.interiorWindows,
            exteriorWindows: form.exteriorWindows,
            slidingGlassDoor: form.slidingGlassDoor,
            blindsShutters: form.blindsShutters,
            wallSpotClean: form.wallSpotClean,
            wallWashing: form.wallWashing,
            ceilingFans: form.ceilingFans,
            airConditionerVents: form.airConditionerVents,
            wardrobe: form.wardrobe,
            garage: form.garage,
            deckPatio: form.deckPatio,
            alfresco: form.alfresco,
            pergola: form.pergola,
            carpetSteam: form.carpetSteam,
            changeBedsheets: form.changeBedsheets,
            washDishes: form.washDishes,
            laundryLoad: form.laundryLoad,
            laundryFold: form.laundryFold,
            laundryCloset: form.laundryCloset,
            rumpusRoom: form.rumpusRoom,
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
      setCampaignMessage(
        body.appliedCampaign
          ? `Campaign ${body.appliedCampaign.code} applied to the estimate.`
          : campaignMessage
      );
    } catch (err: any) {
      setError(err?.message ?? "Estimate failed.");
    } finally {
      setLoadingEstimate(false);
    }
  }

  async function submitLead() {
    setSubmitting(true);
    setError(null);
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
          state: lead.state || undefined,
          postcode: lead.postcode || undefined,
          latitude: lead.latitude ?? undefined,
          longitude: lead.longitude ?? undefined,
          placeId: lead.placeId ?? undefined,
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
            preferredDate: form.preferredDate,
            preferredTime: form.preferredTime,
            addOns: {
              balcony: form.hasBalcony,
              exteriorAccess: form.exteriorAccess,
              oven: form.oven,
              fridge: form.fridge,
              fridgeFull: form.fridgeFull,
              freezer: form.freezer,
              heavyMess: form.heavyMess,
              sameDay: form.sameDay,
              furnished: form.furnished,
              pets: form.pets,
              outdoorArea: form.outdoorArea,
              largeKitchen: form.largeKitchen,
              smallBalcony: form.smallBalcony,
              largeBalcony: form.largeBalcony,
              grill: form.grill,
              rangehood: form.rangehood,
              dishwasher: form.dishwasher,
              insideCupboards: form.insideCupboards,
              pantry: form.pantry,
              interiorWindows: form.interiorWindows,
              exteriorWindows: form.exteriorWindows,
              slidingGlassDoor: form.slidingGlassDoor,
              blindsShutters: form.blindsShutters,
              wallSpotClean: form.wallSpotClean,
              wallWashing: form.wallWashing,
              ceilingFans: form.ceilingFans,
              airConditionerVents: form.airConditionerVents,
              wardrobe: form.wardrobe,
              garage: form.garage,
              deckPatio: form.deckPatio,
              alfresco: form.alfresco,
              pergola: form.pergola,
              carpetSteam: form.carpetSteam,
              changeBedsheets: form.changeBedsheets,
              washDishes: form.washDishes,
              laundryLoad: form.laundryLoad,
              laundryFold: form.laundryFold,
              laundryCloset: form.laundryCloset,
              rumpusRoom: form.rumpusRoom,
            },
            estimate: result,
            manualQuoteRequired,
            submittedFrom: "client",
            photoUrls,
          },
          notes: [
            manualQuoteRequired
              ? "Manual review required before final pricing."
              : "Instant estimate generated.",
            form.scopeNotes ? `Scope notes: ${form.scopeNotes}` : "",
            "Submitted from client portal.",
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not send quote request.");
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message ?? "Submission failed.");
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

  function setFormField(key: string, value: boolean | string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  if (submitted) {
    return (
      <ECard variant="ceremony">
        <ECardBody className="space-y-4 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="e-display-md">Request received.</h2>
          <p className="mx-auto max-w-2xl text-[0.875rem] leading-7 text-[hsl(var(--e-muted-foreground))]">
            {manualQuoteRequired
              ? "The request has been routed for manual review so the team can confirm the right scope and price."
              : "Your estimate and scope details have been saved with the request so the team can confirm the next step quickly."}
          </p>
          <p className="e-numeral text-[2rem] text-[hsl(var(--e-gold-ink))]">
            {manualQuoteRequired ? "Manual Review" : formatCurrency(result?.total ?? 0)}
          </p>
        </ECardBody>
      </ECard>
    );
  }

  const tileClass = (active: boolean) =>
    cn(
      "min-h-[76px] min-w-0 rounded-[var(--e-radius-lg)] border px-5 py-4 text-left transition-colors duration-[160ms]",
      active
        ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
        : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
    );

  return (
    <div className="mx-auto max-w-[680px] space-y-5">
      {/* Current service summary */}
      <ECard>
        <ECardBody className="space-y-2 pt-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
            <EEyebrow>Current service</EEyebrow>
          </div>
          <p className="e-display-sm">{currentService?.label}</p>
          <p className="text-[0.875rem] leading-6 text-[hsl(var(--e-muted-foreground))]">
            {currentService?.summary}
          </p>
        </ECardBody>
      </ECard>

      <ECard>
        {/* Stepper */}
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-5 py-4 sm:px-6">
          <div className="-mx-1 min-w-0 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max items-center gap-2 sm:gap-3">
              {wizardSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-2 sm:gap-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border text-[0.8125rem] font-semibold transition-colors",
                      index < stepIndex
                        ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                        : index === stepIndex
                          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-primary))]"
                          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))]"
                    )}
                    title={step}
                    aria-label={`Step ${index + 1}: ${step}`}
                  >
                    {index < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </div>
                  {index < wizardSteps.length - 1 ? (
                    <div
                      className={cn(
                        "h-px w-6",
                        index < stepIndex ? "bg-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-border))]"
                      )}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <p className="shrink-0 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Step {stepIndex + 1} of {wizardSteps.length}
          </p>
        </div>

        <ECardBody className="space-y-5 pt-6">
          <div>
            <h2 className="e-display-sm">{wizardSteps[stepIndex]}</h2>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {stepIndex < 6
                ? "Answer each section so the estimate reflects the actual property, access, and condition."
                : "Review the estimate and send the request with the full scope context attached."}
            </p>
          </div>

          {/* Step 0 — Service family */}
          {stepIndex === 0 ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(SERVICE_FAMILY_META) as ServiceFamily[]).map((family) => (
                  <button
                    type="button"
                    key={family}
                    onClick={() => {
                      setSelectedFamily(family);
                      setServiceType(defaultServiceForFamily(family));
                    }}
                    className={tileClass(selectedFamily === family)}
                  >
                    <p className="font-semibold">{SERVICE_FAMILY_META[family].label}</p>
                    <p className="mt-1 text-[0.8125rem] leading-5 text-[hsl(var(--e-muted-foreground))]">
                      {SERVICE_FAMILY_META[family].description}
                    </p>
                  </button>
                ))}
              </div>
              <div className="rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface-raised))] p-4">
                <EEyebrow>Services in this category</EEyebrow>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {familyServices.map((service) => (
                    <div
                      key={service.jobType}
                      className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3"
                    >
                      <p className="text-[0.875rem] font-medium">{service.label}</p>
                      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        {service.tagline}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Step 1 — Service */}
          {stepIndex === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {familyServices.map((service) => (
                <button
                  type="button"
                  key={service.jobType}
                  onClick={() => setServiceType(service.jobType)}
                  className={tileClass(serviceType === service.jobType)}
                >
                  <p className="font-semibold">{service.label}</p>
                  <p className="mt-1 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">
                    {service.tagline}
                  </p>
                  <p className="mt-2 text-[0.8125rem] leading-5 text-[hsl(var(--e-muted-foreground))]">
                    {service.summary}
                  </p>
                  <p className="mt-3 text-[0.625rem] uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]">
                    {service.autoPricingMode === "estimate" ? "Instant estimate path" : "Manual review path"}
                  </p>
                </button>
              ))}
            </div>
          ) : null}

          {/* Step 2 — Photos */}
          {stepIndex === 2 ? (
            <div className="space-y-5">
              <p className="text-[0.875rem] leading-6 text-[hsl(var(--e-muted-foreground))]">
                Upload photos of the property to help us quote accurately. Kitchen, bathrooms, and
                problem areas are most useful.{" "}
                <span className="font-medium text-[hsl(var(--e-foreground))]">
                  This step is optional — skip if not ready.
                </span>
              </p>
              <div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handlePhotoFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <EButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={photoUrls.length >= 5 || uploadingPhotos.size > 0}
                  onClick={() => photoInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {photoUrls.length >= 5 ? "Maximum 5 photos" : "Upload photos"}
                </EButton>
                <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {photoUrls.length}/5 photos uploaded
                </p>
              </div>
              {uploadingPhotos.size > 0 ? (
                <p className="animate-pulse text-[0.875rem] text-[hsl(var(--e-gold-ink))]">
                  Uploading {uploadingPhotos.size} photo{uploadingPhotos.size > 1 ? "s" : ""}…
                </p>
              ) : null}
              {photoUrls.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {photoUrls.map((url) => (
                    <div
                      key={url}
                      className="group relative h-24 w-24 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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
              ) : null}
            </div>
          ) : null}

          {/* Step 3 — Property profile */}
          {stepIndex === 3 ? (
            <div className="space-y-4">
              {roomBasedServices.has(serviceType) ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <ELabel>Bedrooms</ELabel>
                    <EInput value={form.bedrooms} onChange={(e) => setFormField("bedrooms", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <ELabel>Bathrooms</ELabel>
                    <EInput value={form.bathrooms} onChange={(e) => setFormField("bathrooms", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <ELabel>Floors</ELabel>
                    <EInput value={form.floors} onChange={(e) => setFormField("floors", e.target.value)} />
                  </div>
                </div>
              ) : null}

              {areaBasedServices.has(serviceType) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <ELabel>Estimated service area (sqm)</ELabel>
                    <EInput
                      value={form.areaSqm}
                      onChange={(e) => setFormField("areaSqm", e.target.value)}
                      placeholder="Optional if unknown"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <ELabel>Area band</ELabel>
                    <ESelect value={form.areaBand} onChange={(e) => setFormField("areaBand", e.target.value)}>
                      {AREA_BANDS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </ESelect>
                  </div>
                </div>
              ) : null}

              {unitBasedServices.has(serviceType) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <ELabel>{unitPromptForService(serviceType).label}</ELabel>
                    <EInput
                      value={serviceType === "WINDOW_CLEAN" ? form.windowCount : form.serviceUnits}
                      onChange={(e) =>
                        serviceType === "WINDOW_CLEAN"
                          ? setFormField("windowCount", e.target.value)
                          : setFormField("serviceUnits", e.target.value)
                      }
                      placeholder={unitPromptForService(serviceType).placeholder}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <ELabel>Floors / storeys</ELabel>
                    <EInput value={form.floors} onChange={(e) => setFormField("floors", e.target.value)} />
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <ELabel>Anything the estimator should know?</ELabel>
                <ETextarea
                  rows={4}
                  value={form.scopeNotes}
                  onChange={(e) => setFormField("scopeNotes", e.target.value)}
                  placeholder="For example: neglected condition, limited access, staged clean, inspection pressure, furnished site, pets, or unusual exterior access."
                />
              </div>
            </div>
          ) : null}

          {/* Step 4 — Site conditions */}
          {stepIndex === 4 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <ELabel>Condition level</ELabel>
                  <ESelect
                    value={form.conditionLevel}
                    onChange={(e) => setFormField("conditionLevel", e.target.value)}
                  >
                    <option value="light">Light</option>
                    <option value="standard">Standard</option>
                    <option value="heavy">Heavy</option>
                  </ESelect>
                </div>
                <div className="space-y-1.5">
                  <ELabel>Parking / access</ELabel>
                  <ESelect
                    value={form.parkingAccess}
                    onChange={(e) => setFormField("parkingAccess", e.target.value)}
                  >
                    {PARKING_ACCESS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </ESelect>
                </div>
              </div>
              <div className="space-y-1.5">
                <ELabel>Window / access complexity</ELabel>
                <ESelect
                  value={form.windowAccess}
                  onChange={(e) => setFormField("windowAccess", e.target.value)}
                >
                  {WINDOW_ACCESS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </ESelect>
              </div>
              <ECheckTile
                checked={form.exteriorAccess}
                onChange={(next) => setFormField("exteriorAccess", next)}
              >
                Exterior / ladder-style access required
              </ECheckTile>
              <div className="space-y-4">
                {EXTRA_GROUPS.map((group) => (
                  <div
                    key={group.title}
                    className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4"
                  >
                    <p className="text-[0.875rem] font-semibold">{group.title}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {group.items.map(([key, label]) => (
                        <ECheckTile
                          key={key}
                          checked={(form as Record<string, boolean | string>)[key] === true}
                          onChange={(next) => setFormField(key, next)}
                        >
                          {label}
                        </ECheckTile>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Step 5 — Timing & promo */}
          {stepIndex === 5 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <ELabel>Service cadence</ELabel>
                  <ESelect value={form.frequency} onChange={(e) => setFormField("frequency", e.target.value)}>
                    {FREQUENCIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </ESelect>
                </div>
                <div className="flex items-end">
                  <ECheckTile checked={form.sameDay} onChange={(next) => setFormField("sameDay", next)}>
                    Priority or same-day turnaround
                  </ECheckTile>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <ELabel>Preferred date</ELabel>
                  <EInput
                    type="date"
                    value={form.preferredDate}
                    onChange={(e) => setFormField("preferredDate", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <ELabel>Preferred time</ELabel>
                  <ESelect
                    value={form.preferredTime}
                    onChange={(e) => setFormField("preferredTime", e.target.value)}
                  >
                    <option value="any">Any time</option>
                    <option value="morning">Morning</option>
                    <option value="midday">Midday</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </ESelect>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <ELabel>Promo code</ELabel>
                  <EInput
                    value={form.promoCode}
                    onChange={(e) => setFormField("promoCode", e.target.value.toUpperCase())}
                    placeholder="Optional"
                  />
                </div>
                <div className="flex items-end">
                  <EButton type="button" variant="outline" onClick={validateCampaign} className="w-full sm:w-auto">
                    <TicketPercent className="h-4 w-4" />
                    Check code
                  </EButton>
                </div>
              </div>
              {campaignMessage ? (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{campaignMessage}</p>
              ) : null}
            </div>
          ) : null}

          {/* Step 6 — Estimate */}
          {stepIndex === 6 ? (
            <div className="space-y-4">
              <div className="rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface-raised))] px-5 py-5">
                {loadingEstimate ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Building estimate…</p>
                ) : manualQuoteRequired ? (
                  <div className="space-y-2">
                    <p className="text-[1.0625rem] font-semibold">Manual review required</p>
                    <p className="text-[0.875rem] leading-6 text-[hsl(var(--e-muted-foreground))]">
                      This service or scope should not be guessed automatically. The request will still
                      carry the full structured context into the admin review flow.
                    </p>
                  </div>
                ) : result ? (
                  <div className="space-y-4">
                    <div>
                      <EEyebrow>Estimated total</EEyebrow>
                      <p className="e-numeral mt-1 text-[2.25rem] leading-none text-[hsl(var(--e-gold-ink))]">
                        {formatCurrency(result.total ?? 0)}
                      </p>
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {Number(result.gst ?? 0) > 0
                          ? `Includes GST of ${formatCurrency(result.gst ?? 0)}`
                          : "GST is not applied to this estimate."}
                      </p>
                    </div>
                    <div className="space-y-2 text-[0.875rem]">
                      {(result.lineItems ?? []).map((item) => (
                        <div
                          key={`${item.label}-${item.total}`}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="min-w-0 text-[hsl(var(--e-muted-foreground))]">{item.label}</span>
                          <span className="shrink-0 font-medium tabular-nums">
                            {item.total < 0
                              ? `-${formatCurrency(Math.abs(item.total))}`
                              : formatCurrency(item.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {result.appliedCampaign ? (
                      <EBadge tone="gold" soft>
                        {result.appliedCampaign.code} applied
                      </EBadge>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                    No estimate has been generated yet.
                  </p>
                )}
              </div>
              <EButton type="button" variant="outline" size="sm" onClick={buildEstimate} disabled={loadingEstimate}>
                Refresh estimate
              </EButton>
            </div>
          ) : null}

          {/* Step 7 — Your details */}
          {stepIndex === 7 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <ELabel>Full name</ELabel>
                  <EInput
                    value={lead.name}
                    onChange={(e) => setLead((current) => ({ ...current, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <ELabel>Email</ELabel>
                  <EInput
                    type="email"
                    value={lead.email}
                    onChange={(e) => setLead((current) => ({ ...current, email: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <ELabel>Phone</ELabel>
                  <EInput
                    value={lead.phone}
                    onChange={(e) => setLead((current) => ({ ...current, phone: e.target.value }))}
                    placeholder="0451217210 or +61451217210"
                  />
                </div>
                <div className="space-y-1.5">
                  <ELabel>Suburb</ELabel>
                  <EInput
                    value={lead.suburb}
                    onChange={(e) => setLead((current) => ({ ...current, suburb: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <ELabel>Address</ELabel>
                <EAddressInput
                  value={lead.address}
                  placeholder="Start typing your address…"
                  onChange={(value) => setLead((current) => ({ ...current, address: value }))}
                  onResolved={(parts) =>
                    setLead((current) => ({
                      ...current,
                      address: parts.address || current.address,
                      suburb: parts.suburb || current.suburb,
                      state: parts.state || current.state,
                      postcode: parts.postcode || current.postcode,
                      latitude: typeof parts.lat === "number" ? parts.lat : current.latitude,
                      longitude: typeof parts.lng === "number" ? parts.lng : current.longitude,
                      placeId: parts.placeId || current.placeId,
                    }))
                  }
                />
              </div>
            </div>
          ) : null}

          {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

          {/* Nav */}
          <div className="flex flex-col gap-3 border-t border-[hsl(var(--e-border))] pt-5 sm:flex-row sm:justify-between">
            <EButton
              type="button"
              variant="outline"
              onClick={previousStep}
              disabled={stepIndex === 0}
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </EButton>
            <div className="flex flex-col gap-2 sm:flex-row">
              {stepIndex === 2 ? (
                <EButton type="button" variant="ghost" onClick={nextStep} className="w-full sm:w-auto">
                  Skip this step
                  <ArrowRight className="h-4 w-4" />
                </EButton>
              ) : null}
              {stepIndex < wizardSteps.length - 1 ? (
                <EButton
                  type="button"
                  variant="primary"
                  onClick={nextStep}
                  disabled={stepIndex === 2 && uploadingPhotos.size > 0}
                  className="w-full sm:w-auto"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </EButton>
              ) : (
                <EButton
                  type="button"
                  variant="gold"
                  onClick={submitLead}
                  disabled={submitting || !lead.name || !lead.email}
                  className="w-full sm:w-auto"
                >
                  {submitting
                    ? "Submitting…"
                    : manualQuoteRequired
                      ? "Request manual quote"
                      : "Send quote request"}
                </EButton>
              )}
            </div>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
