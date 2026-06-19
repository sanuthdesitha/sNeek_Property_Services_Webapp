import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { redirect } from "next/navigation";
import { CleanerProfileForm } from "@/components/cleaner/cleaner-profile-form";
import { DisplayPreferencesSection } from "@/components/profile/display-preferences-section";
import { BillingPreferencesSection } from "@/components/profile/billing-preferences-section";
import { TwoFactorSettings } from "@/components/account/two-factor-settings";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { UserRound } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CleanerProfilePage() {
  await requireRole([Role.CLEANER]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const user = (await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      image: true,
      uiDensity: true,
      themePreference: true,
      invoicingCadence: true,
      invoiceDayOfWeek: true,
      invoiceDayOfMonth: true,
      bankBsb: true,
      bankAccountNumber: true,
      bankAccountName: true,
      // V9 onboarding fields
      address: true,
      suburb: true,
      state: true,
      postcode: true,
      latitude: true,
      longitude: true,
      placeId: true,
      dateOfBirth: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
      visaStatus: true,
      taxFileNumberOnFile: true,
      employmentType: true,
      abn: true,
      hireDate: true,
      languages: true,
      hasVehicle: true,
      vehicleRegoExpiry: true,
      driverLicenseExpiry: true,
      notes: true,
      profileEditingEnabled: true,
    } as any,
  })) as any;

  if (!user) redirect("/login");

  const editingEnabled = user.profileEditingEnabled !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Your profile"
        description="Keep your details current so we can pay you correctly and reach you in an emergency."
        icon={<UserRound />}
      />

      <CleanerProfileForm
        editingEnabled={editingEnabled}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          dateOfBirth: user.dateOfBirth,
          emergencyContactName: user.emergencyContactName,
          emergencyContactPhone: user.emergencyContactPhone,
          emergencyContactRelation: user.emergencyContactRelation,
          address: user.address,
          suburb: user.suburb,
          state: user.state,
          postcode: user.postcode,
          latitude: user.latitude,
          longitude: user.longitude,
          placeId: user.placeId,
          visaStatus: user.visaStatus,
          taxFileNumberOnFile: !!user.taxFileNumberOnFile,
          employmentType: user.employmentType,
          abn: user.abn,
          bankBsb: user.bankBsb,
          bankAccountNumber: user.bankAccountNumber,
          bankAccountName: user.bankAccountName,
          hireDate: user.hireDate,
          languages: user.languages ?? [],
          hasVehicle: !!user.hasVehicle,
          vehicleRegoExpiry: user.vehicleRegoExpiry,
          driverLicenseExpiry: user.driverLicenseExpiry,
          notes: user.notes,
        }}
      />

      <TwoFactorSettings />

      <BillingPreferencesSection
        initialCadence={user.invoicingCadence ?? undefined}
        initialDayOfWeek={user.invoiceDayOfWeek ?? null}
        initialDayOfMonth={user.invoiceDayOfMonth ?? null}
      />

      <DisplayPreferencesSection
        initialDensity={user.uiDensity ?? undefined}
        initialTheme={user.themePreference ?? undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>Your performance</CardTitle>
          <CardDescription>See ratings, on-time stats, and recognition.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/cleaner/hub">Go to my hub</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
