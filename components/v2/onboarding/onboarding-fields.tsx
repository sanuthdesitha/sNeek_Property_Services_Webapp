"use client";

/**
 * The fields of one onboarding step (board "Public and sign in", screen 3).
 * The same fields as the single-page form, grouped by step; values live in
 * the parent so moving between steps keeps what was typed.
 */
import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import type { OnboardingStepKey } from "@/lib/onboarding/steps";

export interface OnboardingForm {
  name: string;
  phone: string;
  address: string;
  businessName: string;
  abn: string;
  accountName: string;
  bankName: string;
  bsb: string;
  accountNumber: string;
}

export const EMPTY_ONBOARDING_FORM: OnboardingForm = {
  name: "",
  phone: "",
  address: "",
  businessName: "",
  abn: "",
  accountName: "",
  bankName: "",
  bsb: "",
  accountNumber: "",
};

export function OnboardingFields({
  step,
  form,
  onChange,
}: {
  step: Exclude<OnboardingStepKey, "finish">;
  form: OnboardingForm;
  onChange: (key: keyof OnboardingForm, value: string) => void;
}) {
  if (step === "details") {
    return (
      <div className="space-y-4">
        <h2 className="text-[1rem] font-[600]">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Full name *">
            <EInput value={form.name} autoComplete="name" onChange={(e) => onChange("name", e.target.value)} placeholder="Your name" />
          </EField>
          <EField label="Phone *">
            <EInput value={form.phone} type="tel" autoComplete="tel" onChange={(e) => onChange("phone", e.target.value)} placeholder="04xx xxx xxx" />
          </EField>
        </div>
        <EField label="Address">
          <EInput value={form.address} autoComplete="street-address" onChange={(e) => onChange("address", e.target.value)} placeholder="Street, suburb, state, postcode" />
        </EField>
      </div>
    );
  }
  if (step === "business") {
    return (
      <div className="space-y-4">
        <h2 className="text-[1rem] font-[600]">Your business</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Business name">
            <EInput value={form.businessName} onChange={(e) => onChange("businessName", e.target.value)} />
          </EField>
          <EField label="ABN">
            <EInput value={form.abn} inputMode="numeric" onChange={(e) => onChange("abn", e.target.value)} />
          </EField>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-[1rem] font-[600]">
          <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" aria-hidden /> Where should we pay you?
        </h2>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Used for your invoices.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Account name">
          <EInput value={form.accountName} onChange={(e) => onChange("accountName", e.target.value)} />
        </EField>
        <EField label="BSB">
          <EInput value={form.bsb} inputMode="numeric" onChange={(e) => onChange("bsb", e.target.value)} />
        </EField>
        <EField label="Account number">
          <EInput value={form.accountNumber} inputMode="numeric" onChange={(e) => onChange("accountNumber", e.target.value)} />
        </EField>
        <EField label="Bank name">
          <EInput value={form.bankName} onChange={(e) => onChange("bankName", e.target.value)} />
        </EField>
      </div>
    </div>
  );
}
