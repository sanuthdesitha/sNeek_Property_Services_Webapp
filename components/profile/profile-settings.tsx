"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Moon, Sun, Palette, Fingerprint, Trash2, CheckCircle2 } from "lucide-react";
import type { PortalTheme } from "@/lib/settings";
import type { AddressResult } from "@/lib/google-maps/types";
import { requiredProfileFields, type ProfileFieldCheck } from "@/lib/profile/completeness";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";

type BiometricDevice = {
  id: string;
  deviceName: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

interface ProfilePayload {
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    role: string;
    image?: string | null;
    // Extended cleaner contractor fields (may be absent for non-extended roles).
    dateOfBirth?: string | null;
    address?: string | null;
    suburb?: string | null;
    state?: string | null;
    postcode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    placeId?: string | null;
    abn?: string | null;
    visaStatus?: string | null;
    employmentType?: string | null;
    taxFileNumberOnFile?: boolean | null;
    bankAccountName?: string | null;
    bankBsb?: string | null;
    bankAccountNumber?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
  };
  editPolicy: {
    canEditName: boolean;
    canEditPhone: boolean;
    canEditEmail: boolean;
  };
  notificationPreferences: Record<
    string,
    {
      web: boolean;
      email: boolean;
      sms: boolean;
    }
  >;
}

export function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingExtended, setSavingExtended] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [loadingPin, setLoadingPin] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [clearingPin, setClearingPin] = useState(false);
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [adminPinState, setAdminPinState] = useState<{ hasPin: boolean; updatedAt: string | null } | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
    image: "",
  });
  const [extendedForm, setExtendedForm] = useState({
    dateOfBirth: "",
    address: "",
    suburb: "",
    state: "",
    postcode: "",
    latitude: null as number | null,
    longitude: null as number | null,
    placeId: null as string | null,
    abn: "",
    visaStatus: "",
    employmentType: "",
    taxFileNumberOnFile: false,
    bankAccountName: "",
    bankBsb: "",
    bankAccountNumber: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
  });
  const [notificationPreferences, setNotificationPreferences] = useState<ProfilePayload["notificationPreferences"]>({});
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pinForm, setPinForm] = useState({
    currentPassword: "",
    pin: "",
    confirmPin: "",
  });
  const [portalTheme, setPortalTheme] = useState<PortalTheme>("light");
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricDevices, setBiometricDevices] = useState<BiometricDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [removingDeviceId, setRemovingDeviceId] = useState<string | null>(null);

  async function loadBiometricDevices() {
    setLoadingDevices(true);
    try {
      const res = await fetch("/api/auth/webauthn/credentials", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.devices)) {
        setBiometricDevices(body.devices as BiometricDevice[]);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingDevices(false);
    }
  }

  async function enrollBiometricDevice() {
    setEnrolling(true);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!optionsRes.ok) {
        const body = await optionsRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not start enrolment.");
      }
      const options = await optionsRes.json();

      let attestation;
      try {
        attestation = await startRegistration(options);
      } catch (err) {
        if (err instanceof WebAuthnError && /already registered/i.test(err.message)) {
          toast({ title: "This device is already enrolled." });
        } else {
          toast({
            title: "Enrolment cancelled",
            description: "Biometric enrolment was cancelled on this device.",
            variant: "destructive",
          });
        }
        setEnrolling(false);
        return;
      }

      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const verifyBody = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !verifyBody?.verified) {
        toast({
          title: "Enrolment failed",
          description: verifyBody?.error ?? "Could not register this device.",
          variant: "destructive",
        });
        setEnrolling(false);
        return;
      }

      toast({ title: "Device enrolled", description: "You can now sign in with biometrics on this device." });
      await loadBiometricDevices();
    } catch (err: any) {
      toast({ title: "Enrolment failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setEnrolling(false);
    }
  }

  async function removeBiometricDevice(id: string) {
    setRemovingDeviceId(id);
    try {
      const res = await fetch(`/api/auth/webauthn/credentials/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? "Could not remove device.");
      }
      setBiometricDevices((prev) => prev.filter((d) => d.id !== id));
      toast({ title: "Device removed" });
    } catch (err: any) {
      toast({ title: "Could not remove device", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setRemovingDeviceId(null);
    }
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/me/profile");
    const body = await res.json();
    if (!res.ok) {
      toast({ title: "Failed to load profile", description: body.error ?? "Try again.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setData(body);
    setProfileForm({
      name: body.user.name ?? "",
      email: body.user.email ?? "",
      phone: body.user.phone ?? "",
      image: body.user.image ?? "",
    });
    setExtendedForm({
      dateOfBirth: body.user.dateOfBirth ? String(body.user.dateOfBirth).slice(0, 10) : "",
      address: body.user.address ?? "",
      suburb: body.user.suburb ?? "",
      state: body.user.state ?? "",
      postcode: body.user.postcode ?? "",
      latitude: body.user.latitude ?? null,
      longitude: body.user.longitude ?? null,
      placeId: body.user.placeId ?? null,
      abn: body.user.abn ?? "",
      visaStatus: body.user.visaStatus ?? "",
      employmentType: body.user.employmentType ?? "",
      taxFileNumberOnFile: Boolean(body.user.taxFileNumberOnFile),
      bankAccountName: body.user.bankAccountName ?? "",
      bankBsb: body.user.bankBsb ?? "",
      bankAccountNumber: body.user.bankAccountNumber ?? "",
      emergencyContactName: body.user.emergencyContactName ?? "",
      emergencyContactPhone: body.user.emergencyContactPhone ?? "",
      emergencyContactRelation: body.user.emergencyContactRelation ?? "",
    });
    setNotificationPreferences(body.notificationPreferences ?? {});
    setLoading(false);
  }

  useEffect(() => {
    load();
    const saved = localStorage.getItem("portal-theme-override") as PortalTheme | null;
    if (saved === "dark" || saved === "light" || saved === "public") {
      setPortalTheme(saved);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function detect() {
      try {
        if (typeof window === "undefined" || !window.PublicKeyCredential || !browserSupportsWebAuthn()) {
          if (active) {
            setBiometricSupported(false);
            setLoadingDevices(false);
          }
          return;
        }
        const hasPlatform = await platformAuthenticatorIsAvailable().catch(() => false);
        if (!active) return;
        setBiometricSupported(hasPlatform);
        if (hasPlatform) {
          await loadBiometricDevices();
        } else {
          setLoadingDevices(false);
        }
      } catch {
        if (active) {
          setBiometricSupported(false);
          setLoadingDevices(false);
        }
      }
    }
    void detect();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data?.user?.role || !["ADMIN", "OPS_MANAGER"].includes(data.user.role)) return;
    setLoadingPin(true);
    fetch("/api/me/admin-pin")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body.error ?? "Could not load admin PIN state.");
        setAdminPinState(body);
      })
      .catch((err: any) => {
        toast({ title: "PIN state unavailable", description: err.message ?? "Could not load admin PIN.", variant: "destructive" });
      })
      .finally(() => setLoadingPin(false));
  }, [data?.user?.role]);

  async function saveProfile() {
    if (!data) return;
    setSavingProfile(true);
    const payload: { name?: string; email?: string; phone?: string; image?: string | null } = {
      image: profileForm.image || null,
    };
    if (data.editPolicy.canEditName) {
      payload.name = profileForm.name;
    }
    if (data.editPolicy.canEditEmail) {
      payload.email = profileForm.email;
    }
    if (data.editPolicy.canEditPhone) {
      payload.phone = profileForm.phone;
    }
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    setSavingProfile(false);
    if (!res.ok) {
      toast({ title: "Profile update failed", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Profile updated" });
    await load();
  }

  function onAddressSelect(result: AddressResult) {
    setExtendedForm((prev) => ({
      ...prev,
      address: result.formattedAddress,
      suburb: result.suburb ?? "",
      state: result.state ?? "",
      postcode: result.postcode ?? "",
      latitude: result.lat,
      longitude: result.lng,
      placeId: result.placeId ?? null,
    }));
  }

  async function saveExtended() {
    setSavingExtended(true);
    const payload = {
      dateOfBirth: extendedForm.dateOfBirth || null,
      address: extendedForm.address,
      suburb: extendedForm.suburb,
      state: extendedForm.state,
      postcode: extendedForm.postcode,
      latitude: extendedForm.latitude,
      longitude: extendedForm.longitude,
      placeId: extendedForm.placeId,
      abn: extendedForm.abn,
      visaStatus: extendedForm.visaStatus || null,
      employmentType: extendedForm.employmentType || null,
      taxFileNumberOnFile: extendedForm.taxFileNumberOnFile,
      bankAccountName: extendedForm.bankAccountName,
      bankBsb: extendedForm.bankBsb,
      bankAccountNumber: extendedForm.bankAccountNumber,
      emergencyContactName: extendedForm.emergencyContactName,
      emergencyContactPhone: extendedForm.emergencyContactPhone,
      emergencyContactRelation: extendedForm.emergencyContactRelation,
    };
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingExtended(false);
    if (!res.ok) {
      toast({ title: "Could not save details", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Details saved" });
    await load();
  }

  async function changePassword() {
    if (passwordForm.newPassword.length < 8) {
      toast({ title: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: "Password confirmation does not match.", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }),
    });
    const body = await res.json();
    setSavingPassword(false);
    if (!res.ok) {
      toast({ title: "Password update failed", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    toast({ title: "Password updated" });
  }

  async function uploadAvatar(file: File) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "profiles");
    setUploadingAvatar(true);
    const res = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    setUploadingAvatar(false);
    if (!res.ok || !body?.url) {
      toast({
        title: "Avatar upload failed",
        description: body.error ?? "Could not upload avatar.",
        variant: "destructive",
      });
      return;
    }
    setProfileForm((prev) => ({ ...prev, image: String(body.url) }));
    toast({ title: "Avatar uploaded" });
  }

  async function saveNotificationPrefs() {
    setSavingNotifications(true);
    const res = await fetch("/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notificationPreferences),
    });
    const body = await res.json().catch(() => ({}));
    setSavingNotifications(false);
    if (!res.ok) {
      toast({
        title: "Notification settings failed",
        description: body.error ?? "Could not save preferences.",
        variant: "destructive",
      });
      return;
    }
    setNotificationPreferences(body);
    toast({ title: "Notification preferences updated" });
  }

  async function saveAdminPin() {
    if (pinForm.pin.length < 4) {
      toast({ title: "PIN must be at least 4 digits.", variant: "destructive" });
      return;
    }
    if (pinForm.pin !== pinForm.confirmPin) {
      toast({ title: "PIN confirmation does not match.", variant: "destructive" });
      return;
    }
    if (!pinForm.currentPassword.trim()) {
      toast({ title: "Current password is required.", variant: "destructive" });
      return;
    }
    setSavingPin(true);
    const res = await fetch("/api/me/admin-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: pinForm.currentPassword,
        pin: pinForm.pin,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPin(false);
    if (!res.ok) {
      toast({ title: "PIN update failed", description: body.error ?? "Could not save admin PIN.", variant: "destructive" });
      return;
    }
    setPinForm({ currentPassword: "", pin: "", confirmPin: "" });
    setAdminPinState({ hasPin: true, updatedAt: new Date().toISOString() });
    toast({ title: adminPinState?.hasPin ? "Admin PIN updated" : "Admin PIN created" });
  }

  async function clearAdminPin() {
    if (!pinForm.currentPassword.trim()) {
      toast({ title: "Current password is required.", variant: "destructive" });
      return;
    }
    setClearingPin(true);
    const res = await fetch("/api/me/admin-pin", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pinForm.currentPassword }),
    });
    const body = await res.json().catch(() => ({}));
    setClearingPin(false);
    if (!res.ok) {
      toast({ title: "Could not clear admin PIN", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    setPinForm({ currentPassword: "", pin: "", confirmPin: "" });
    setAdminPinState({ hasPin: false, updatedAt: null });
    toast({ title: "Admin PIN removed" });
  }

  if (loading || !data) {
    return <div className="py-10 text-sm text-muted-foreground">Loading profile...</div>;
  }

  const policy = data.editPolicy;
  const notificationCategories = Object.entries(notificationPreferences);

  // CLEANER profile-completeness — mirrors the gate at /api/me/profile-completeness.
  // Evaluated against the persisted values on `data.user` (what the gate sees),
  // so the indicator matches the nag exactly rather than unsaved edits.
  const isCleaner = data.user.role === "CLEANER";
  const completenessFields: ProfileFieldCheck[] = isCleaner
    ? requiredProfileFields("CLEANER")
    : [];
  const isFieldBlank = (key: string) => {
    const value = (data.user as Record<string, unknown>)[key];
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  };
  const missingCompletenessFields = completenessFields.filter((field) => isFieldBlank(field.key));
  const completenessPct = completenessFields.length
    ? Math.round(((completenessFields.length - missingCompletenessFields.length) / completenessFields.length) * 100)
    : 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details and password.</p>
      </div>

      {isCleaner ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {completenessPct === 100 ? (
                  <CheckCircle2 className="size-5 text-emerald-500" />
                ) : null}
                <p className="text-sm font-medium">Profile completeness</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{completenessPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  completenessPct === 100 ? "bg-emerald-500" : "bg-primary"
                )}
                style={{ width: `${completenessPct}%` }}
              />
            </div>
            {missingCompletenessFields.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Still needed:{" "}
                <span className="font-medium text-foreground">
                  {missingCompletenessFields.map((field) => field.label).join(", ")}
                </span>
                . Fill these in below to clear the reminder.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                All required details are complete. Thank you.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-muted text-lg font-semibold">
              {profileForm.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileForm.image} alt="Profile avatar" className="h-full w-full object-cover" />
              ) : (
                (profileForm.name || data.user.email).slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="avatar-upload">Profile image</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="max-w-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void uploadAvatar(file);
                    }
                    e.currentTarget.value = "";
                  }}
                  disabled={uploadingAvatar}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setProfileForm((prev) => ({ ...prev, image: "" }))}
                  disabled={uploadingAvatar || !profileForm.image}
                >
                  Remove
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {uploadingAvatar ? "Uploading..." : "Shown in dashboards, headers, and portal surfaces."}
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={profileForm.name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!policy.canEditName}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                disabled={!policy.canEditEmail}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              type="tel"
              inputMode="tel"
              maxLength={16}
              placeholder="0451217210 or +61451217210"
              value={profileForm.phone}
              onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
              disabled={!policy.canEditPhone}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isCleaner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contractor & pay details</CardTitle>
            <p className="text-sm text-muted-foreground">
              We use these for your invoices, payments, and HR records. Completing them clears the
              &ldquo;update your missing info&rdquo; reminder.
            </p>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Identity */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Identity</h3>
              <div className="space-y-1.5">
                <Label>Date of birth</Label>
                <Input
                  type="date"
                  className="h-11 rounded-lg"
                  value={extendedForm.dateOfBirth}
                  onChange={(e) => setExtendedForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                />
              </div>
            </section>

            {/* Address */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Residential address</h3>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <AddressAutocomplete
                  value={extendedForm.address}
                  onChange={(text) => setExtendedForm((prev) => ({ ...prev, address: text }))}
                  onSelect={onAddressSelect}
                  placeholder="Start typing your address..."
                  className="h-11 rounded-lg"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Suburb</Label>
                  <Input
                    className="h-11 rounded-lg"
                    value={extendedForm.suburb}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, suburb: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input
                    className="h-11 rounded-lg"
                    value={extendedForm.state}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, state: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Postcode</Label>
                  <Input
                    className="h-11 rounded-lg"
                    inputMode="numeric"
                    maxLength={10}
                    value={extendedForm.postcode}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, postcode: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            {/* Banking / Pay */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Banking & pay</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>ABN</Label>
                  <Input
                    className="h-11 rounded-lg"
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="11 digit ABN"
                    value={extendedForm.abn}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, abn: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Bank account name</Label>
                  <Input
                    className="h-11 rounded-lg"
                    value={extendedForm.bankAccountName}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, bankAccountName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>BSB</Label>
                  <Input
                    className="h-11 rounded-lg"
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="000-000"
                    value={extendedForm.bankBsb}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, bankBsb: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Bank account number</Label>
                  <Input
                    className="h-11 rounded-lg"
                    inputMode="numeric"
                    maxLength={30}
                    value={extendedForm.bankAccountNumber}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, bankAccountNumber: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            {/* Emergency contact */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Emergency contact</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    className="h-11 rounded-lg"
                    maxLength={100}
                    value={extendedForm.emergencyContactName}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    className="h-11 rounded-lg"
                    type="tel"
                    inputMode="tel"
                    maxLength={30}
                    value={extendedForm.emergencyContactPhone}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Relationship</Label>
                  <Input
                    className="h-11 rounded-lg"
                    maxLength={50}
                    placeholder="e.g. Partner, Parent"
                    value={extendedForm.emergencyContactRelation}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, emergencyContactRelation: e.target.value }))}
                  />
                </div>
              </div>
            </section>

            {/* Compliance */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Compliance</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="visaStatus">Visa / residency status</Label>
                  <select
                    id="visaStatus"
                    className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={extendedForm.visaStatus}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, visaStatus: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    <option value="CITIZEN">Citizen</option>
                    <option value="PERMANENT_RESIDENT">Permanent resident</option>
                    <option value="WORK_VISA">Work visa</option>
                    <option value="STUDENT_VISA">Student visa</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="employmentType">Employment type</Label>
                  <select
                    id="employmentType"
                    className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={extendedForm.employmentType}
                    onChange={(e) => setExtendedForm((prev) => ({ ...prev, employmentType: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    <option value="CONTRACTOR">Contractor</option>
                    <option value="CASUAL">Casual</option>
                    <option value="PART_TIME">Part time</option>
                    <option value="FULL_TIME">Full time</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Tax File Number provided</p>
                  <p className="text-xs text-muted-foreground">
                    Tick once you&rsquo;ve supplied your TFN to the office. We don&rsquo;t store the number here.
                  </p>
                </div>
                <Switch
                  checked={extendedForm.taxFileNumberOnFile}
                  onCheckedChange={(value) =>
                    setExtendedForm((prev) => ({ ...prev, taxFileNumberOnFile: value }))
                  }
                />
              </label>
            </section>

            <div className="flex justify-end">
              <Button className="h-11 rounded-lg" onClick={saveExtended} disabled={savingExtended}>
                {savingExtended ? "Saving..." : "Save details"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notificationCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading notification categories...</p>
          ) : (
            notificationCategories.map(([category, preference]) => (
              <div key={category} className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-4">
                <div>
                  <p className="text-sm font-medium capitalize">{category}</p>
                  <p className="text-xs text-muted-foreground">
                    Choose how {category} updates should reach you.
                  </p>
                </div>
                {(["web", "email", "sms"] as const).map((channel) => (
                  <div key={`${category}-${channel}`} className="flex items-center justify-between gap-2 rounded border p-2">
                    <Label className="text-xs uppercase">{channel}</Label>
                    <Switch
                      checked={Boolean(preference?.[channel])}
                      onCheckedChange={(value) =>
                        setNotificationPreferences((prev) => ({
                          ...prev,
                          [category]: {
                            ...prev[category],
                            [channel]: value,
                          },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            ))
          )}
          <div className="flex justify-end">
            <Button onClick={saveNotificationPrefs} disabled={savingNotifications}>
              {savingNotifications ? "Saving..." : "Save notification preferences"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={changePassword} disabled={savingPassword}>
              {savingPassword ? "Updating..." : "Update password"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose your preferred portal theme. This setting is saved in your browser.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { value: "dark" as PortalTheme, label: "Dark", description: "Charcoal & teal — low-light mode", Icon: Moon },
                { value: "light" as PortalTheme, label: "Light", description: "Clean white brand colours", Icon: Sun },
                { value: "public" as PortalTheme, label: "Match Site", description: "Teal sidebar, light content", Icon: Palette },
              ] as const
            ).map(({ value, label, description, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setPortalTheme(value);
                  localStorage.setItem("portal-theme-override", value);
                  // Propagate to the live portal shell by dispatching a storage event
                  window.dispatchEvent(new StorageEvent("storage", { key: "portal-theme-override", newValue: value }));
                  toast({ title: `Theme set to ${label}` });
                }}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all",
                  portalTheme === value
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40"
                )}
              >
                <Icon className={cn("h-5 w-5", portalTheme === value ? "text-primary" : "text-muted-foreground")} />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {biometricSupported ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="h-4 w-4 text-primary" />
              Biometric sign-in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add this device to sign in with Face ID, Touch ID, fingerprint, or Windows Hello — no
              password needed. Your biometrics never leave the device.
            </p>

            <div className="space-y-2">
              {loadingDevices ? (
                <p className="text-sm text-muted-foreground">Loading enrolled devices...</p>
              ) : biometricDevices.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No devices enrolled yet.
                </p>
              ) : (
                biometricDevices.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{device.deviceName}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(device.createdAt).toLocaleDateString("en-AU")}
                        {device.lastUsedAt
                          ? ` · Last used ${new Date(device.lastUsedAt).toLocaleDateString("en-AU")}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => removeBiometricDevice(device.id)}
                      disabled={removingDeviceId === device.id}
                    >
                      <Trash2 className="h-4 w-4" />
                      {removingDeviceId === device.id ? "Removing..." : "Remove"}
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                className="h-11 gap-2 rounded-lg"
                onClick={enrollBiometricDevice}
                disabled={enrolling}
              >
                <Fingerprint className="h-4 w-4" />
                {enrolling ? "Waiting for device..." : "Add this device for biometric sign-in"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {["ADMIN", "OPS_MANAGER"].includes(data.user.role) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Admin verification PIN</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{loadingPin ? "Loading PIN status..." : adminPinState?.hasPin ? "PIN is active" : "No PIN set"}</p>
              <p className="text-xs text-muted-foreground">
                Use a PIN or your password to approve sensitive admin actions.
                {adminPinState?.updatedAt ? ` Last updated ${new Date(adminPinState.updatedAt).toLocaleString("en-AU")}.` : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input
                type="password"
                value={pinForm.currentPassword}
                onChange={(e) => setPinForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>New PIN</Label>
                <Input
                  inputMode="numeric"
                  value={pinForm.pin}
                  onChange={(e) => setPinForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, "") }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm PIN</Label>
                <Input
                  inputMode="numeric"
                  value={pinForm.confirmPin}
                  onChange={(e) => setPinForm((prev) => ({ ...prev, confirmPin: e.target.value.replace(/\D/g, "") }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={clearAdminPin} disabled={clearingPin || !adminPinState?.hasPin}>
                {clearingPin ? "Removing..." : "Remove PIN"}
              </Button>
              <Button onClick={saveAdminPin} disabled={savingPin}>
                {savingPin ? "Saving..." : adminPinState?.hasPin ? "Update PIN" : "Set PIN"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
