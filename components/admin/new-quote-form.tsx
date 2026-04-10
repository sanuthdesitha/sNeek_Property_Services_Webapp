"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { JobType } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { calculateGstBreakdown, getGstDisplayLabel } from "@/lib/pricing/gst";

const SERVICE_TYPES: Array<{ value: JobType; label: string }> = [
  { value: JobType.AIRBNB_TURNOVER, label: "Airbnb Turnover" },
  { value: JobType.DEEP_CLEAN, label: "Deep Clean" },
  { value: JobType.END_OF_LEASE, label: "End of Lease" },
  { value: JobType.GENERAL_CLEAN, label: "General Clean" },
  { value: JobType.POST_CONSTRUCTION, label: "Post Construction" },
  { value: JobType.PRESSURE_WASH, label: "Pressure Wash" },
  { value: JobType.WINDOW_CLEAN, label: "Window Clean" },
  { value: JobType.LAWN_MOWING, label: "Lawn Mowing" },
  { value: JobType.SPECIAL_CLEAN, label: "Special Clean" },
  { value: JobType.COMMERCIAL_RECURRING, label: "Commercial Recurring" },
  { value: JobType.CARPET_STEAM_CLEAN, label: "Carpet Steam Clean" },
  { value: JobType.MOLD_TREATMENT, label: "Mould Treatment" },
  { value: JobType.UPHOLSTERY_CLEANING, label: "Upholstery Cleaning" },
  { value: JobType.TILE_GROUT_CLEANING, label: "Tile & Grout Cleaning" },
  { value: JobType.GUTTER_CLEANING, label: "Gutter Cleaning" },
  { value: JobType.SPRING_CLEANING, label: "Spring Cleaning" },
];

type ServiceType = JobType;

interface LeadOption {
  id: string;
  name: string;
  email: string;
  suburb: string | null;
  serviceType: ServiceType;
  bedrooms: number | null;
  bathrooms: number | null;
  estimateMin: number | null;
  estimateMax: number | null;
}

interface NewQuoteFormProps {
  leads: LeadOption[];
  gstEnabled: boolean;
}

export function NewQuoteForm({ leads, gstEnabled }: NewQuoteFormProps) {
  const router = useRouter();
  const [leadId, setLeadId] = useState<string>("none");
  const [serviceType, setServiceType] = useState<ServiceType>("AIRBNB_TURNOVER");
  const [lineItemLabel, setLineItemLabel] = useState("Cleaning service");
  const [bedrooms, setBedrooms] = useState("2");
  const [bathrooms, setBathrooms] = useState("1");
  const [floors, setFloors] = useState("1");
  const [sqm, setSqm] = useState("80");
  const [conditionScore, setConditionScore] = useState("3");
  const [steamCarpetRooms, setSteamCarpetRooms] = useState("0");
  const [windowAreaSqm, setWindowAreaSqm] = useState("0");
  const [pressureWashSqm, setPressureWashSqm] = useState("0");
  const [manualAdjustment, setManualAdjustment] = useState("0");
  const [notes, setNotes] = useState("");
  const [validUntilDate, setValidUntilDate] = useState("");
  const [saving, setSaving] = useState(false);

  const bedsN = Number(bedrooms) || 0;
  const bathsN = Number(bathrooms) || 0;
  const floorsN = Number(floors) || 0;
  const sqmN = Number(sqm) || 0;
  const conditionN = Math.max(1, Math.min(5, Number(conditionScore) || 3));
  const steamRoomsN = Number(steamCarpetRooms) || 0;
  const windowSqmN = Number(windowAreaSqm) || 0;
  const pressureSqmN = Number(pressureWashSqm) || 0;
  const adjustmentN = Number(manualAdjustment) || 0;

  const conditionMultiplier = 0.8 + conditionN * 0.1; // 1=>0.9, 3=>1.1, 5=>1.3
  const baseBySize = bedsN * 65 + bathsN * 45 + floorsN * 25 + sqmN * 0.9;
  const addOnsTotal = steamRoomsN * 65 + windowSqmN * 6 + pressureSqmN * 8;
  const { subtotal, gstAmount, totalAmount } = useMemo(
    () =>
      calculateGstBreakdown((baseBySize + addOnsTotal) * conditionMultiplier + adjustmentN, {
        gstEnabled,
      }),
    [addOnsTotal, adjustmentN, baseBySize, conditionMultiplier, gstEnabled]
  );
  const gstLabel = useMemo(() => getGstDisplayLabel({ gstEnabled }), [gstEnabled]);

  function buildPayload() {
    return {
      quoteMeta: {
        bedrooms: bedsN,
        bathrooms: bathsN,
        floors: floorsN,
        sqm: sqmN,
        conditionScore: conditionN,
        steamCarpetRooms: steamRoomsN,
        windowAreaSqm: windowSqmN,
        pressureWashSqm: pressureSqmN,
      },
      leadId: leadId === "none" ? undefined : leadId,
      serviceType,
      lineItems: [
        {
          label: `${lineItemLabel || "Cleaning service"} (${bedsN}bd/${bathsN}ba, ${floorsN} floors, ${sqmN} sqm)`,
          unitPrice: Number((baseBySize * conditionMultiplier).toFixed(2)),
          qty: 1,
          total: Number((baseBySize * conditionMultiplier).toFixed(2)),
        },
        ...(steamRoomsN > 0 ? [{ label: "Steam carpet cleaning", unitPrice: 65, qty: steamRoomsN, total: steamRoomsN * 65 }] : []),
        ...(windowSqmN > 0 ? [{ label: "Window cleaning (sqm)", unitPrice: 6, qty: windowSqmN, total: windowSqmN * 6 }] : []),
        ...(pressureSqmN > 0 ? [{ label: "Pressure wash (sqm)", unitPrice: 8, qty: pressureSqmN, total: pressureSqmN * 8 }] : []),
        ...(adjustmentN !== 0 ? [{ label: "Manual adjustment", unitPrice: adjustmentN, qty: 1, total: adjustmentN }] : []),
      ],
      subtotal,
      gstAmount,
      totalAmount,
      notes:
        [
          `Condition score: ${conditionN}/5`,
          `Floors: ${floorsN}`,
          `Total sqm: ${sqmN}`,
          notes?.trim() || "",
          `[[META:${JSON.stringify({
            bedrooms: bedsN,
            bathrooms: bathsN,
            floors: floorsN,
            sqm: sqmN,
            conditionScore: conditionN,
            steamCarpetRooms: steamRoomsN,
            windowAreaSqm: windowSqmN,
            pressureWashSqm: pressureSqmN,
          })}]]`,
        ]
          .filter(Boolean)
          .join("\n") || undefined,
      validUntil: validUntilDate ? new Date(`${validUntilDate}T23:59:59`).toISOString() : undefined,
    };
  }

  function openPreview() {
    if (subtotal <= 0) {
      toast({ title: "Invalid subtotal", description: "Subtotal must be greater than 0.", variant: "destructive" });
      return;
    }
    const payload = buildPayload();
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sneek.quoteDraft.v1", JSON.stringify(payload));
    }
    router.push("/admin/quotes/preview");
  }

  function applyLead(selectedId: string) {
    setLeadId(selectedId);
    if (selectedId === "none") return;

    const lead = leads.find((item) => item.id === selectedId);
    if (!lead) return;

    setServiceType(lead.serviceType);
    if (lead.bedrooms != null) setBedrooms(String(lead.bedrooms));
    if (lead.bathrooms != null) setBathrooms(String(lead.bathrooms));
    if (typeof lead.estimateMin === "number" && Number.isFinite(lead.estimateMin)) {
      setManualAdjustment(String(lead.estimateMin));
    } else if (typeof lead.estimateMax === "number" && Number.isFinite(lead.estimateMax)) {
      setManualAdjustment(String(Number((lead.estimateMax / 1.1).toFixed(2))));
    }
  }

  async function createQuote() {
    if (subtotal <= 0) {
      toast({ title: "Invalid subtotal", description: "Subtotal must be greater than 0.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();

      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create quote.");
      }

      toast({ title: "Quote created", description: "The quote has been saved." });
      router.push("/admin/quotes");
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Could not create quote",
        description: err.message ?? "Failed to create quote.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">New Quote</h2>
          <p className="text-sm text-muted-foreground">Create a manual quote from scratch or from an existing lead.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/quotes">Back to quotes</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quote Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="leadId">Lead (optional)</Label>
              <Select value={leadId} onValueChange={applyLead}>
                <SelectTrigger id="leadId">
                  <SelectValue placeholder="Select a lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No lead</SelectItem>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.name} - {lead.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="serviceType">Service Type</Label>
              <Select value={serviceType} onValueChange={(v: ServiceType) => setServiceType(v)}>
                <SelectTrigger id="serviceType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((service) => (
                    <SelectItem key={service.value} value={service.value}>
                      {service.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lineItemLabel">Line Item Label</Label>
              <Input
                id="lineItemLabel"
                value={lineItemLabel}
                onChange={(e) => setLineItemLabel(e.target.value)}
                placeholder="Cleaning service"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conditionScore">Condition (1-5)</Label>
              <Input
                id="conditionScore"
                type="number"
                min="1"
                max="5"
                value={conditionScore}
                onChange={(e) => setConditionScore(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Bedrooms</Label>
              <Input type="number" min="0" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Bathrooms</Label>
              <Input type="number" min="0" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Floors</Label>
              <Input type="number" min="1" value={floors} onChange={(e) => setFloors(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Total sqm</Label>
              <Input type="number" min="0" value={sqm} onChange={(e) => setSqm(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="text-sm font-medium mb-2">Additional Services</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Steam carpet cleaning (rooms)</Label>
                <Input type="number" min="0" value={steamCarpetRooms} onChange={(e) => setSteamCarpetRooms(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Window cleaning (sqm)</Label>
                <Input type="number" min="0" value={windowAreaSqm} onChange={(e) => setWindowAreaSqm(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Pressure wash (sqm)</Label>
                <Input type="number" min="0" value={pressureWashSqm} onChange={(e) => setPressureWashSqm(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Manual adjustment {gstEnabled ? "(+/- ex GST)" : "(+/- tax free)"}</Label>
            <Input type="number" step="0.01" value={manualAdjustment} onChange={(e) => setManualAdjustment(e.target.value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="text-lg font-semibold">${subtotal.toFixed(2)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{gstLabel}</p>
              <p className="text-lg font-semibold">${gstAmount.toFixed(2)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">${totalAmount.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="validUntil">Valid Until (optional)</Label>
              <Input id="validUntil" type="date" value={validUntilDate} onChange={(e) => setValidUntilDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Scope details, inclusions, exclusions..."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={openPreview} disabled={saving}>
              Preview quote
            </Button>
            <Button onClick={createQuote} disabled={saving}>
              {saving ? "Creating..." : "Create quote"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
