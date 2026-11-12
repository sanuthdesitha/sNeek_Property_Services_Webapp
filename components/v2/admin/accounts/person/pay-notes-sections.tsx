"use client";

/**
 * Office notes and payroll & identity, each edited in place.
 *  Office notes     → PUT   /api/admin/users/[id]/notes { notes }     (ADMIN, OPS_MANAGER)
 *  Payroll/identity → PATCH /api/admin/users/[id] extended fields     (ADMIN only)
 * The pay rate editor (with "Applies from" and history) is ./pay-section.
 */
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { BankFields, EMPTY_BANK, type BankDraft } from "./bank-fields";
import { EditableSection, FactList, ensureOk } from "./editable-section";

export { PaySection } from "./pay-section";

type SectionProps = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };

export function NotesSection({ profile, caps, onChanged }: SectionProps) {
  return (
    <EditableSection<{ notes: string }>
      title="Office notes, private"
      personId={profile.id}
      canEdit={caps.canWriteNotes}
      view={
        <div className="space-y-2 text-[0.8125rem]">
          {profile.adminNotes?.trim() ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{profile.adminNotes}</p> : <p className="text-[hsl(var(--e-muted-foreground))]">No office notes.</p>}
          {profile.ownNotes?.trim() ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">Written by the account holder</p>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{profile.ownNotes}</p>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">From their own profile. They can see and change this text.</p>
            </div>
          ) : null}
        </div>
      }
      makeDraft={() => ({ notes: profile.adminNotes ?? "" })}
      renderEdit={(draft, setDraft) => (
        <>
          <ETextarea aria-label="Office notes" value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} className="min-h-[6rem]" maxLength={8000} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only the office can see this. It is never shown to the account holder.</p>
        </>
      )}
      save={async (draft) => {
        const res = await fetch(`/api/admin/users/${profile.id}/notes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: draft.notes }),
        });
        await ensureOk(res, "Could not save notes.");
      }}
      onSaved={onChanged}
    />
  );
}

type IdentityDraft = {
  businessName: string;
  abn: string;
  address: string;
  contactNumber: string;
  jobTitle: string;
  department: string;
  baseLocation: string;
  bank: BankDraft;
};

const TEXT_FIELDS: Array<[Exclude<keyof IdentityDraft, "bank">, string]> = [
  ["businessName", "Business name"],
  ["abn", "ABN"],
  ["address", "Address"],
  ["contactNumber", "Contact number"],
  ["jobTitle", "Job title"],
  ["department", "Department"],
  ["baseLocation", "Base location"],
];

export function PayrollIdentitySection({ profile, caps, onChanged }: SectionProps) {
  const showBank = profile.role === "CLEANER" || profile.role === "LAUNDRY";
  const d = profile.payroll.display;
  const rows = [
    { label: "Business", value: d.businessName },
    { label: "ABN", value: d.abn },
    { label: "Address", value: d.fullAddress ?? profile.payroll.editable.address },
    { label: "Payroll bank", value: d.bankLine },
    { label: "Profile bank", value: d.profileBankLine },
    { label: "Payout", value: d.payoutMethod },
    { label: "Job title", value: d.jobTitle },
    { label: "Department", value: d.department },
    { label: "Base", value: d.baseLocation },
    { label: "Emergency", value: d.emergencyContact },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
  return (
    <EditableSection<IdentityDraft>
      title="Payroll & identity"
      personId={profile.id}
      canEdit={caps.isAdmin}
      view={rows.length ? <FactList labelWidth={96} rows={rows} /> : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No payroll or identity details on file.</p>}
      makeDraft={() => {
        const e = profile.payroll.editable;
        return {
          businessName: e.businessName ?? "",
          abn: e.abn ?? "",
          address: e.address ?? "",
          contactNumber: e.contactNumber ?? "",
          jobTitle: e.jobTitle ?? "",
          department: e.department ?? "",
          baseLocation: e.baseLocation ?? "",
          bank: e.bankDetails ? { ...e.bankDetails } : { ...EMPTY_BANK },
        };
      }}
      renderEdit={(draft, setDraft) => (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {TEXT_FIELDS.map(([key, label]) => (
              <EField key={key} label={label} className={key === "address" ? "sm:col-span-2" : undefined}>
                <EInput value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
              </EField>
            ))}
          </div>
          {showBank ? <BankFields title="Bank details (payouts)" value={draft.bank} onChange={(bank) => setDraft({ ...draft, bank })} /> : null}
        </>
      )}
      save={async (draft) => {
        const trimmed = (value: string) => value.trim() || null;
        const res = await fetch(`/api/admin/users/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessName: trimmed(draft.businessName),
            abn: trimmed(draft.abn),
            address: trimmed(draft.address),
            contactNumber: trimmed(draft.contactNumber),
            jobTitle: trimmed(draft.jobTitle),
            department: trimmed(draft.department),
            baseLocation: trimmed(draft.baseLocation),
            bankDetails: showBank
              ? { accountName: draft.bank.accountName.trim(), bankName: draft.bank.bankName.trim(), bsb: draft.bank.bsb.trim(), accountNumber: draft.bank.accountNumber.trim() }
              : null,
          }),
        });
        await ensureOk(res, "Could not update payroll and identity.");
      }}
      onSaved={onChanged}
    />
  );
}
