"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

interface ProfilePayload {
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    role: string;
    image?: string | null;
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
    setNotificationPreferences(body.notificationPreferences ?? {});
    setLoading(false);
  }

  useEffect(() => {
    load();
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
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profileForm.name,
        email: profileForm.email,
        phone: profileForm.phone,
        image: profileForm.image || null,
      }),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details and password.</p>
      </div>

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
