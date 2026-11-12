/**
 * The person profile shape, shared by the server loader and the client
 * sections. Type-only imports, so client components can use it.
 */
import type { Role } from "@prisma/client";
import type { UserSummary } from "@/lib/accounts/user-summary";
import type { CredentialStatus } from "@/lib/workforce/credential-expiry";
import type { AccountStatus } from "@/lib/accounts/list/attention";
import type { PayRateHistory } from "@/lib/accounts/pay-rate-history";
import type { PersonLeaveEntry } from "@/lib/accounts/leave";
import type { RequiredDocumentStatus } from "@/lib/accounts/required-documents";

/** Dates become ISO strings when the profile crosses to the browser. */
export type Jsonify<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type ProfileEditPolicy = { canEditName: boolean; canEditPhone: boolean; canEditEmail: boolean };

export type BankDetails = { accountName: string; bankName: string; bsb: string; accountNumber: string };

/** The extended-profile editor's fields (lib/accounts/user-details), plus the User-row fallbacks it showed. */
export type ExtendedProfileFields = {
  businessName: string | null;
  abn: string | null;
  address: string | null;
  contactNumber: string | null;
  jobTitle: string | null;
  department: string | null;
  baseLocation: string | null;
  bankDetails: BankDetails | null;
};

export type PayrollIdentity = {
  editable: ExtendedProfileFields;
  display: {
    businessName: string | null;
    abn: string | null;
    fullAddress: string | null;
    /** User-row bank fields: what payroll runs and ABA files read. */
    bankLine: string | null;
    /** Bank details saved through the extended profile editor. */
    profileBankLine: string | null;
    payoutMethod: string | null;
    department: string | null;
    baseLocation: string | null;
    jobTitle: string | null;
    emergencyContact: string | null;
  };
};

export type RawPersonProfile = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: Date | null;
  phone: string | null;
  image: string | null;
  role: Role;
  roleLabel: string;
  isActive: boolean;
  status: AccountStatus;
  inviteAgeDays: number | null;
  invitationExpiresAt: Date | null;
  twoFactorEnabled: boolean;
  profileEditingEnabled: boolean;
  profileEditOverride: ProfileEditPolicy | null;
  roleEditDefault: ProfileEditPolicy | null;
  createdAt: Date;
  hireDate: Date | null;
  employmentType: string | null;
  birthday: { date: string; age: number | null } | null;
  lastSeenAt: Date | null;
  /** Cleaner roster summary, or null when none is saved. */
  availability: string | null;
  location: { suburb: string | null; state: string | null; postcode: string | null; address: string | null };
  client: { id: string; name: string } | null;
  /** The default rate in force today (effective-dated history, else the stored rate). */
  hourlyRate: number | null;
  /** Rate history for the Pay section; null for client-side accounts. */
  payRateHistory: PayRateHistory | null;
  /** Recent and upcoming leave and days off; null for client-side accounts. */
  leave: PersonLeaveEntry[] | null;
  /** Each required document type (Settings → Required documents) and its state. Empty = none required. */
  requiredDocuments: RequiredDocumentStatus[];
  /** False when the stored requirement list could not be read. */
  requiredDocumentsReadable: boolean;
  extraRoles: Array<{ role: Role; label: string; grantedAt: Date; grantedBy: { id: string; name: string | null; email: string | null } | null }>;
  ownNotes: string | null;
  adminNotes: string | null;
  payroll: PayrollIdentity;
  credentials: CredentialStatus[];
  documents: Array<{ id: string; title: string; category: string; status: string; fileName: string; url: string; expiresAt: Date | null; createdAt: Date }>;
  missingDocuments: Array<{ id: string; title: string; category: string; dueAt: Date | null; createdAt: Date }>;
  summary: UserSummary;
  figures: { jobs30: number; reviewed30: number; qa30: number | null } | null;
  performance: {
    onTimePercent: number | null;
    attendancePercent: number | null;
    avgRating: number | null;
    reworkPercent: number | null;
    documentCompliancePercent: number | null;
  } | null;
  isFieldRole: boolean;
  vaAccess: {
    team: { id: string; name: string; isActive: boolean; clientName: string | null; permissions: Record<string, boolean> } | null;
    scopeProperties: string[];
  } | null;
  testable: boolean;
};

export type PersonProfile = Jsonify<RawPersonProfile>;

/** What the viewer may do on the panel; computed on the server (lib/accounts/viewer). */
export type PersonCapabilities = {
  isAdmin: boolean;
  canWriteNotes: boolean;
  canUploadDocuments: boolean;
  /** Resend invite: ADMIN and OPS_MANAGER (with accounts write), as before. */
  canResendInvite: boolean;
  /** Record or remove leave: ADMIN, and OPS_MANAGER with accounts write (as office notes). */
  canManageLeave?: boolean;
  /** Message this person through the staff message route (ADMIN, OPS_MANAGER with communications). */
  canMessageStaff?: boolean;
};

export function toPersonProfile(raw: RawPersonProfile): PersonProfile {
  return JSON.parse(JSON.stringify(raw)) as PersonProfile;
}
