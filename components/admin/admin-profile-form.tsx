"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { ProfileEditingLockedBanner } from "@/components/profile/profile-editing-locked-banner";
import type { AddressResult } from "@/lib/google-maps/types";

export interface AdminProfileFormUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  image: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
}

export function AdminProfileForm({
  user,
  editingEnabled = true,
}: {
  user: AdminProfileFormUser;
  editingEnabled?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState(user.name ?? "");
  const [phone, setPhone] = React.useState(user.phone ?? "");

  const [address, setAddress] = React.useState(user.address ?? "");
  const [suburb, setSuburb] = React.useState(user.suburb ?? "");
  const [stateVal, setStateVal] = React.useState(user.state ?? "");
  const [postcode, setPostcode] = React.useState(user.postcode ?? "");
  const [latitude, setLatitude] = React.useState<number | null>(user.latitude);
  const [longitude, setLongitude] = React.useState<number | null>(user.longitude);

  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function onAddressSelect(result: AddressResult) {
    setAddress(result.formattedAddress);
    setSuburb(result.suburb ?? "");
    setStateVal(result.state ?? "");
    setPostcode(result.postcode ?? "");
    setLatitude(result.lat);
    setLongitude(result.lng);
    patch({
      address: result.formattedAddress,
      suburb: result.suburb ?? "",
      state: result.state ?? "",
      postcode: result.postcode ?? "",
      placeId: result.placeId,
      latitude: result.lat,
      longitude: result.lng,
    });
  }

  const locked = !editingEnabled;

  return (
    <div className="space-y-6">
      {locked && <ProfileEditingLockedBanner />}
      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {saving ? "Saving…" : "Saved."}
        </p>
      )}

      <fieldset disabled={locked} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Your basic details. Auto-saves when you leave a field.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-muted text-lg font-semibold">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="Profile avatar" className="h-full w-full object-cover" />
              ) : (
                (name || user.email).slice(0, 2).toUpperCase()
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your avatar is set during onboarding and shown in dashboards & headers.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="name" label="Full name">
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== (user.name ?? "") && patch({ name })}
              />
            </FormField>
            <FormField id="email" label="Email" hint="Contact a system admin to change your email.">
              <Input id="email" value={user.email} readOnly disabled />
            </FormField>
            <FormField id="phone" label="Mobile">
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => phone !== (user.phone ?? "") && patch({ phone })}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home address</CardTitle>
          <CardDescription>Used for HR records and travel reimbursements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormField id="address" label="Address">
            <AddressAutocomplete
              id="address"
              value={address}
              onChange={setAddress}
              onSelect={onAddressSelect}
              placeholder="Start typing your address…"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="suburb" label="Suburb">
              <Input id="suburb" value={suburb} readOnly />
            </FormField>
            <FormField id="state" label="State">
              <Input id="state" value={stateVal} readOnly />
            </FormField>
            <FormField id="postcode" label="Postcode">
              <Input id="postcode" value={postcode} readOnly />
            </FormField>
          </div>
          {latitude !== null && longitude !== null && (
            <p className="text-xs text-muted-foreground">
              Geocoded {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </p>
          )}
        </CardContent>
      </Card>
      </fieldset>
    </div>
  );
}
