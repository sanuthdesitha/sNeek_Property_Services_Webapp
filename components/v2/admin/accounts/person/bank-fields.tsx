"use client";

/** Bank payout fields, shared by Invite person and Payroll & identity. */
import { EField, EInput } from "@/components/v2/admin/estate-kit";

export type BankDraft = { accountName: string; bankName: string; bsb: string; accountNumber: string };
export const EMPTY_BANK: BankDraft = { accountName: "", bankName: "", bsb: "", accountNumber: "" };

export function BankFields({ title, value, onChange }: { title: string; value: BankDraft; onChange: (next: BankDraft) => void }) {
  const set = (key: keyof BankDraft, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <p className="text-[0.8125rem] font-[550]">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Account name"><EInput value={value.accountName} onChange={(e) => set("accountName", e.target.value)} /></EField>
        <EField label="Bank name"><EInput value={value.bankName} onChange={(e) => set("bankName", e.target.value)} /></EField>
        <EField label="BSB"><EInput inputMode="numeric" maxLength={7} placeholder="123456" value={value.bsb} onChange={(e) => set("bsb", e.target.value)} /></EField>
        <EField label="Account number"><EInput inputMode="numeric" maxLength={10} placeholder="6 to 10 digits" value={value.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} /></EField>
      </div>
    </div>
  );
}
