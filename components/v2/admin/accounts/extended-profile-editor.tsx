"use client";

/**
 * ESTATE extended-profile editor — native v2 replacement for the extended
 * fields of the v1 accounts "Manage" dialog (components/admin/users-manager).
 * Edits ONLY the extended-profile slice (business name, ABN, address, contact,
 * job title, department, base location, bank details) via the SAME endpoint and
 * payload shape v1 sends:
 *
 *   PATCH /api/admin/users/[id]
 *   { businessName|abn|address|contactNumber|jobTitle|department|baseLocation:
 *       trimmed string or null,
 *     bankDetails: CLEANER/LAUNDRY → { accountName, bankName, bsb,
 *       accountNumber } (trimmed) ; other roles → null }
 *
 * Account-level fields (name/email/role/isActive/…) are intentionally NOT sent
 * so they stay untouched (the API treats missing keys as "no change").
 * Built on v2 primitives + estate-kit only.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal } from "@/components/v2/admin/estate-kit";

export interface ExtendedProfileInitial {
  businessName?: string | null;
  abn?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  baseLocation?: string | null;
  bankDetails?: {
    accountName?: string | null;
    bankName?: string | null;
    bsb?: string | null;
    accountNumber?: string | null;
  } | null;
}

type FormState = {
  businessName: string;
  abn: string;
  address: string;
  contactNumber: string;
  jobTitle: string;
  department: string;
  baseLocation: string;
  accountName: string;
  bankName: string;
  bsb: string;
  accountNumber: string;
};

function toForm(initial: ExtendedProfileInitial | null | undefined): FormState {
  return {
    businessName: initial?.businessName ?? "",
    abn: initial?.abn ?? "",
    address: initial?.address ?? "",
    contactNumber: initial?.contactNumber ?? "",
    jobTitle: initial?.jobTitle ?? "",
    department: initial?.department ?? "",
    baseLocation: initial?.baseLocation ?? "",
    accountName: initial?.bankDetails?.accountName ?? "",
    bankName: initial?.bankDetails?.bankName ?? "",
    bsb: initial?.bankDetails?.bsb ?? "",
    accountNumber: initial?.bankDetails?.accountNumber ?? "",
  };
}

export function ExtendedProfileEditor({
  userId,
  role,
  initial,
}: {
  userId: string;
  role: string;
  initial?: ExtendedProfileInitial | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(() => toForm(initial));

  const showBank = role === "CLEANER" || role === "LAUNDRY";

  function openEditor() {
    setForm(toForm(initial));
    setOpen(true);
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName.trim() || null,
          abn: form.abn.trim() || null,
          address: form.address.trim() || null,
          contactNumber: form.contactNumber.trim() || null,
          jobTitle: form.jobTitle.trim() || null,
          department: form.department.trim() || null,
          baseLocation: form.baseLocation.trim() || null,
          bankDetails: showBank
            ? {
                accountName: form.accountName.trim(),
                bankName: form.bankName.trim(),
                bsb: form.bsb.trim(),
                accountNumber: form.accountNumber.trim(),
              }
            : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update profile.");
      toast({ title: "Profile updated" });
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.message ?? "Could not update profile.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EButton variant="ghost" size="sm" onClick={openEditor} aria-label="Edit payroll & identity">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </EButton>

      <EModal open={open} onClose={() => setOpen(false)} eyebrow="Account" title="Payroll & identity" size="wide">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Business name">
              <EInput value={form.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Trading name" />
            </EField>
            <EField label="ABN">
              <EInput value={form.abn} onChange={(e) => set("abn", e.target.value)} placeholder="11 digits" inputMode="numeric" />
            </EField>
          </div>
          <EField label="Address">
            <EInput value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, suburb, state, postcode" />
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Contact number">
              <EInput value={form.contactNumber} onChange={(e) => set("contactNumber", e.target.value)} inputMode="tel" />
            </EField>
            <EField label="Job title">
              <EInput value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
            </EField>
            <EField label="Department">
              <EInput value={form.department} onChange={(e) => set("department", e.target.value)} />
            </EField>
            <EField label="Base location">
              <EInput value={form.baseLocation} onChange={(e) => set("baseLocation", e.target.value)} />
            </EField>
          </div>

          {showBank ? (
            <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3">
              <p className="text-[0.75rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                Bank details (payouts)
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Account name">
                  <EInput value={form.accountName} onChange={(e) => set("accountName", e.target.value)} />
                </EField>
                <EField label="Bank name">
                  <EInput value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
                </EField>
                <EField label="BSB">
                  <EInput value={form.bsb} onChange={(e) => set("bsb", e.target.value)} placeholder="000-000" inputMode="numeric" />
                </EField>
                <EField label="Account number">
                  <EInput value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} inputMode="numeric" />
                </EField>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </EButton>
            <EButton variant="primary" size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}
