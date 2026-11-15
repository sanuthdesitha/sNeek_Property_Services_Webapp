"use client";

/**
 * Start onboarding: nothing is created on opening. The draft is created on
 * the first save (the first autosave after a name or address is entered),
 * with one Idempotency-Key for every retry from this page, then the address
 * bar moves to the onboarding's own URL. A failed first save keeps what was
 * typed and offers Retry.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EField } from "@/components/v2/admin/estate-kit";
import { EToneNotice, ETonePill } from "@/components/v2/ui/tone-band";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { ONBOARDING_DRAFT_KEY_HEADER, ONBOARDING_FIRST_SAVE_DELAY_MS, describeOnboardingSaveError, hasOnboardingDraftContent, newOnboardingDraftKey } from "@/lib/onboarding/wizard-draft";
import type { AddressResult } from "@/lib/google-maps/types";
import { ONB_INPUT_CLASS, ONB_MUTED } from "./onboarding-kit";

type StartForm = {
  propertyName: string;
  propertyAddress: string;
  propertySuburb: string;
  propertyState: string;
  propertyPostcode: string;
  propertyLatitude: number | null;
  propertyLongitude: number | null;
  propertyPlaceId: string | null;
};

const EMPTY: StartForm = { propertyName: "", propertyAddress: "", propertySuburb: "", propertyState: "NSW", propertyPostcode: "", propertyLatitude: null, propertyLongitude: null, propertyPlaceId: null };

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string } | { kind: "created"; surveyNumber: string };

export function OnboardingStart() {
  const router = useRouter();
  const [form, setForm] = React.useState<StartForm>(EMPTY);
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const keyRef = React.useRef<string>(newOnboardingDraftKey());
  const formRef = React.useRef(form);
  formRef.current = form;
  const savingRef = React.useRef(false);

  const content = hasOnboardingDraftContent({ propertyName: form.propertyName, propertyAddress: form.propertyAddress });

  const create = React.useCallback(async () => {
    if (savingRef.current) return;
    const current = formRef.current;
    if (!hasOnboardingDraftContent({ propertyName: current.propertyName, propertyAddress: current.propertyAddress })) return;
    savingRef.current = true;
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/admin/onboarding/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ONBOARDING_DRAFT_KEY_HEADER]: keyRef.current },
        body: JSON.stringify({
          propertyName: current.propertyName.trim() || null,
          propertyAddress: current.propertyAddress.trim() || null,
          propertySuburb: current.propertySuburb.trim() || null,
          propertyState: current.propertyState || "NSW",
          propertyPostcode: current.propertyPostcode.trim() || null,
          propertyLatitude: current.propertyLatitude,
          propertyLongitude: current.propertyLongitude,
          propertyPlaceId: current.propertyPlaceId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.surveyNumber) {
        setStatus({ kind: "failed", message: describeOnboardingSaveError(body?.error, "The server refused it.") });
        return;
      }
      setStatus({ kind: "created", surveyNumber: body.surveyNumber });
      router.replace(`/v2/admin/onboarding/${encodeURIComponent(body.surveyNumber)}#basics`);
    } catch {
      setStatus({ kind: "failed", message: "No connection. What you typed is kept." });
    } finally {
      savingRef.current = false;
    }
  }, [router]);

  // The first autosave: shortly after the last edit, once something is entered.
  React.useEffect(() => {
    if (!content || status.kind === "created" || status.kind === "failed") return;
    const timer = window.setTimeout(() => void create(), ONBOARDING_FIRST_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [form, content, status.kind, create]);

  React.useEffect(() => {
    if (!content || status.kind === "created") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [content, status.kind]);

  const pickAddress = (result: AddressResult) => {
    const street = [result.unit ? `${result.unit}/` : "", result.streetNumber ?? "", result.route ? ` ${result.route}` : ""].join("").trim() || result.formattedAddress;
    setForm((current) => ({ ...current, propertyAddress: street, propertySuburb: result.suburb ?? current.propertySuburb, propertyState: result.state ?? current.propertyState, propertyPostcode: result.postcode ?? current.propertyPostcode, propertyLatitude: result.lat, propertyLongitude: result.lng, propertyPlaceId: result.placeId }));
  };

  return (
    <div className="max-w-2xl space-y-5">
      <EPageHeader eyebrow={<Link href="/v2/admin/onboarding" className="inline-flex items-center gap-1 normal-case"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Property onboarding</Link>} title="Start onboarding" description="Nothing is created until you enter a name or an address. Leaving before that asks nothing and leaves nothing behind." />
      <section aria-labelledby="new-property" className="space-y-4 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="new-property" className="font-[600]">New property</h2>
          <ETonePill tone={status.kind === "failed" ? "problem" : status.kind === "created" ? "good" : "info"}>
            {status.kind === "saving" ? "Saving…" : status.kind === "created" ? `Draft ${status.surveyNumber} created` : status.kind === "failed" ? "Draft not saved yet" : "Not saved yet"}
          </ETonePill>
        </div>
        <fieldset disabled={status.kind === "created"} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EField label="Property name">
            <input className={ONB_INPUT_CLASS} value={form.propertyName} onChange={(event) => setForm((current) => ({ ...current, propertyName: event.target.value }))} />
          </EField>
          <EField label="Address">
            <EAddressInput value={form.propertyAddress} placeholder="Start typing an address" onChange={(text) => setForm((current) => ({ ...current, propertyAddress: text }))} onSelect={pickAddress} />
          </EField>
        </fieldset>
        {status.kind === "failed" ? (
          <EToneNotice tone="problem" role="alert" title={`Draft not saved yet: ${status.message}`}>
            Everything you typed is still here. <EButton variant="outline" size="sm" onClick={() => void create()}>Retry</EButton>
          </EToneNotice>
        ) : (
          <p className={ONB_MUTED} role="status">{status.kind === "created" ? "Opening the onboarding…" : content ? "The draft is created as soon as you stop typing." : "Nothing is saved until you enter something."}</p>
        )}
      </section>
    </div>
  );
}
