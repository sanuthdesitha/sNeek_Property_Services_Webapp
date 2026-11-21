"use client";

/**
 * ESTATE — Maintenance worker settings (native v2 port of the v1 ProfileSettings
 * mounted at app/maintenance/settings). Contact details, notification
 * preferences, appearance, password, and two-step verification for a maintenance
 * worker. Zero live (v1) UI imports — composed from the Estate v2 kit and the
 * shared EstateProfile (contact + password + 2FA).
 *
 * Endpoints (unchanged from v1):
 *   PATCH /api/me/profile                 (via EstateProfile ContactSection)
 *   POST  /api/me/preferences             (via EstateProfile PreferencesSection)
 *   POST  /api/me/password                (via EstateProfile PasswordSection)
 *   GET/POST/PUT/DELETE /api/auth/2fa/settings  (via EstateProfile TwoFactorSection)
 *   GET/PATCH /api/me/notification-switches     (shared personal switches, topics included)
 */

import { EstateProfile, type EstateProfileUser } from "@/components/v2/laundry/estate-profile";
import { EPasskeySection } from "@/components/v2/shared/passkey-section";
import { PersonalSwitchesPanel } from "@/components/v2/notifications/personal-switches-panel";

export function MaintenanceSettings({
  user,
  editingEnabled = true,
  initialDensity,
  initialTheme,
}: {
  user: EstateProfileUser;
  editingEnabled?: boolean;
  initialDensity?: "COMPACT" | "DEFAULT" | "COMFORTABLE";
  initialTheme?: "LIGHT" | "DARK" | "SYSTEM";
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Contact + preferences (density/theme) + password + two-step verification */}
      <EstateProfile
        user={user}
        editingEnabled={editingEnabled}
        initialDensity={initialDensity}
        initialTheme={initialTheme}
      />
      {/* Every notification that can reach you, per transport (the office sees the same switches). */}
      <PersonalSwitchesPanel source={{ kind: "self" }} intro="Choose which notifications reach you and how. The office sees these switches and can change them for you." />
      {/* Biometric sign-in devices (WebAuthn) — parity with v1 ProfileSettings. */}
      <EPasskeySection />
    </div>
  );
}
