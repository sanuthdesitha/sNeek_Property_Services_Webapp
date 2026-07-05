import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Profile · Estate cleaner" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <p className="min-w-0 truncate text-right text-[0.875rem] font-medium">
        {value != null && value !== "" ? value : <span className="text-[hsl(var(--e-text-faint))]">Not set</span>}
      </p>
    </div>
  );
}

export default async function CleanerProfilePage() {
  const session = await requireRole([Role.CLEANER]);

  // Same read model + session scoping as the live cleaner profile route. The
  // edit forms (details, banking, 2FA, invoicing/display prefs) are complex and
  // own their own mutations, so editing links to the live surface; this page
  // renders a live read-only Estate summary.
  const user = (await db.user
    .findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        abn: true,
        employmentType: true,
        bankBsb: true,
        bankAccountNumber: true,
        bankAccountName: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactRelation: true,
        taxFileNumberOnFile: true,
        profileEditingEnabled: true,
      } as any,
    })
    .catch(() => null)) as any;

  const editAction = (
    <EButton asChild variant="gold" size="sm"><Link href="/cleaner/profile">Edit profile</Link></EButton>
  );

  if (!user) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Account" title="Profile" actions={editAction} />
        <EEmptyState
          eyebrow="Unavailable"
          title="Profile not available"
          description="We couldn't load your profile right now. Open the full profile page to try again."
        />
      </div>
    );
  }

  const location = [user.suburb, user.state, user.postcode].filter(Boolean).join(" ");
  const editingEnabled = user.profileEditingEnabled !== false;
  const bankMasked = user.bankAccountNumber
    ? `•••• ${String(user.bankAccountNumber).slice(-4)}`
    : "";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Profile"
        description="Your details, banking and emergency contact."
        actions={editAction}
      />

      {!editingEnabled ? (
        <ECard>
          <ECardBody className="pt-6">
            <div className="flex items-center gap-2">
              <EBadge tone="warning" soft>Editing locked</EBadge>
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                Contact your manager to update locked details.
              </p>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      <ECard>
        <ECardHeader>
          <ECardTitle>Contact</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            <Row label="Name" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Phone" value={user.phone} />
            <Row label="Address" value={user.address} />
            <Row label="Location" value={location} />
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader>
          <ECardTitle>Payment &amp; tax</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            <Row label="Employment type" value={user.employmentType} />
            <Row label="ABN" value={user.abn} />
            <Row label="TFN on file" value={user.taxFileNumberOnFile ? "Yes" : "No"} />
            <Row label="Bank account name" value={user.bankAccountName} />
            <Row label="BSB" value={user.bankBsb} />
            <Row label="Account number" value={bankMasked} />
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader>
          <ECardTitle>Emergency contact</ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            <Row label="Name" value={user.emergencyContactName} />
            <Row label="Phone" value={user.emergencyContactPhone} />
            <Row label="Relationship" value={user.emergencyContactRelation} />
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="min-w-0">
            <p className="text-[0.875rem] font-medium">Update details, banking, 2FA or invoicing preferences</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              The full profile page has the complete edit forms.
            </p>
          </div>
          <EButton asChild variant="outline" size="sm"><Link href="/cleaner/profile">Open full profile</Link></EButton>
        </ECardBody>
      </ECard>
    </div>
  );
}
