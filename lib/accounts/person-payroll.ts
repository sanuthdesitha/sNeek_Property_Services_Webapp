/**
 * Payroll & identity: the same fields and the same fallbacks the account page
 * used before the redesign (extended profile first, then the User row). Pure.
 */
import type { UserExtendedProfile } from "@/lib/accounts/user-details";
import type { PayrollIdentity } from "./person-types";

type PayrollUser = {
  phone: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  abn: string | null;
  bankAccountName: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  preferredPayoutMethod: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
};

function prettify(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/_/g, " ").trim();
  return text ? text.charAt(0) + text.slice(1).toLowerCase() : null;
}

export function buildPayrollIdentity(user: PayrollUser, extended: UserExtendedProfile | null): PayrollIdentity {
  const fullAddress = [user.address, user.suburb, user.state, user.postcode]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(", ");
  const bankLine = [
    user.bankAccountName,
    user.bankBsb ? `BSB ${user.bankBsb}` : null,
    user.bankAccountNumber ? `Acc ${user.bankAccountNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const emergency = [
    user.emergencyContactName,
    user.emergencyContactRelation ? `(${user.emergencyContactRelation})` : null,
    user.emergencyContactPhone,
  ]
    .filter(Boolean)
    .join(" · ");
  const bankFallback =
    user.bankAccountName || user.bankBsb || user.bankAccountNumber
      ? { accountName: user.bankAccountName ?? "", bankName: "", bsb: user.bankBsb ?? "", accountNumber: user.bankAccountNumber ?? "" }
      : null;
  const extendedBank = extended?.bankDetails
    ? {
        accountName: extended.bankDetails.accountName ?? "",
        bankName: extended.bankDetails.bankName ?? "",
        bsb: extended.bankDetails.bsb ?? "",
        accountNumber: extended.bankDetails.accountNumber ?? "",
      }
    : null;

  return {
    editable: {
      businessName: extended?.businessName ?? null,
      abn: extended?.abn ?? user.abn ?? null,
      address: extended?.address ?? (fullAddress || null),
      contactNumber: extended?.contactNumber ?? user.phone ?? null,
      jobTitle: extended?.jobTitle ?? null,
      department: extended?.department ?? null,
      baseLocation: extended?.baseLocation ?? null,
      bankDetails: extendedBank ?? bankFallback,
    },
    display: {
      businessName: extended?.businessName ?? null,
      // What the editor saves is shown, falling back to the User row.
      abn: extended?.abn ?? user.abn ?? null,
      fullAddress: fullAddress || null,
      bankLine: bankLine || null,
      profileBankLine: extendedBank
        ? [extendedBank.accountName, extendedBank.bankName, extendedBank.bsb ? `BSB ${extendedBank.bsb}` : null, extendedBank.accountNumber ? `Acc ${extendedBank.accountNumber}` : null]
            .filter(Boolean)
            .join(" · ") || null
        : null,
      payoutMethod: prettify(user.preferredPayoutMethod),
      department: extended?.department ?? null,
      baseLocation: extended?.baseLocation ?? null,
      jobTitle: extended?.jobTitle ?? null,
      emergencyContact: emergency || null,
    },
  };
}
