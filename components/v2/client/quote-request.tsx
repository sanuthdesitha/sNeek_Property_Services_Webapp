"use client";

/**
 * Estate quote request — an authenticated client asks the ops team for a formal
 * estimate. Rather than reimplement the public instant-pricing calculator, this
 * files the request through the proven client cases channel that ops already
 * monitor:
 *   POST /api/client/cases   { caseType: "OTHER", title, description }
 * The submitted request then appears under Cases and Quotes as the team prepares
 * a priced proposal (visible on /v2/client/quotes). Tokens only; no v1 imports.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, FileText, Loader2 } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import {
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EInlineNotice, ELabel } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

type PropertyOption = { id: string; name: string; suburb: string | null };

export function ClientQuoteRequest({ properties }: { properties: PropertyOption[] }) {
  const services = useMemo(() => MARKETED_SERVICES ?? [], []);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [serviceType, setServiceType] = useState(services[0]?.jobType ?? "GENERAL_CLEAN");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedProperty = properties.find((p) => p.id === propertyId) ?? null;
  const selectedService = services.find((s) => s.jobType === serviceType) ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    const propertyLine = selectedProperty
      ? `${selectedProperty.name}${selectedProperty.suburb ? `, ${selectedProperty.suburb}` : ""}`
      : "Not specified";
    const serviceLine = selectedService?.label ?? serviceType.replace(/_/g, " ");
    const description = [
      `Quote request for: ${serviceLine}`,
      `Property: ${propertyLine}`,
      details.trim() ? `\nDetails:\n${details.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const res = await fetch("/api/client/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseType: "OTHER",
          title: `Quote request — ${serviceLine}`,
          description,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not submit your quote request.");
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not submit your quote request.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ECard variant="ceremony">
        <ECardBody className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-ink))]">
            <Check className="h-5 w-5" />
          </span>
          <EEyebrow>Request received</EEyebrow>
          <p className="e-display-sm">Your quote request is with the team.</p>
          <p className="max-w-md text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            We&apos;ll prepare a priced proposal and it will appear under Quotes for you to review,
            accept, or decline.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <EButton asChild variant="gold" size="sm">
              <Link href="/v2/client/quotes">View quotes</Link>
            </EButton>
            <EButton
              variant="outline"
              size="sm"
              onClick={() => {
                setDone(false);
                setDetails("");
              }}
            >
              Request another
            </EButton>
          </div>
        </ECardBody>
      </ECard>
    );
  }

  return (
    <ECard>
      <ECardBody className="space-y-5 pt-6">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <EEyebrow>New estimate</EEyebrow>
        </div>

        {properties.length > 0 ? (
          <div className="space-y-1.5">
            <ELabel>Property</ELabel>
            <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.suburb ? ` · ${p.suburb}` : ""}
                </option>
              ))}
            </ESelect>
          </div>
        ) : (
          <EInlineNotice tone="info">
            No property is linked yet — describe the location in the details below and we&apos;ll
            follow up.
          </EInlineNotice>
        )}

        <div className="space-y-1.5">
          <ELabel>Service</ELabel>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => {
              const active = service.jobType === serviceType;
              return (
                <button
                  key={service.jobType}
                  type="button"
                  onClick={() => setServiceType(service.jobType)}
                  className={cn(
                    "rounded-[var(--e-radius)] border p-3 text-left transition-colors duration-[160ms]",
                    active
                      ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-1)]"
                      : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                  )}
                >
                  <p className="e-serif text-[0.9375rem] leading-tight">
                    {service.shortLabel ?? service.label}
                  </p>
                  {service.tagline ? (
                    <p className="mt-1 text-[0.7rem] text-[hsl(var(--e-muted-foreground))]">
                      {service.tagline}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <EThread />

        <div className="space-y-1.5">
          <ELabel htmlFor="quote-details">Anything else we should know?</ELabel>
          <ETextarea
            id="quote-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="Size, condition, frequency, access, timing, or any special requirements."
          />
        </div>

        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

        <div className="flex justify-end">
          <EButton variant="gold" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Sending…" : "Request quote"}
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}
