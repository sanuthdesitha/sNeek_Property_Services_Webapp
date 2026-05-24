"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { ProfileEditingLockedBanner } from "@/components/profile/profile-editing-locked-banner";
import type { AddressResult } from "@/lib/google-maps/types";
import { Building2 } from "lucide-react";

export interface ClientProfileFormUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
}

export interface ClientCommsPref {
  notificationsEnabled: boolean;
  notifyOnEnRoute: boolean;
  notifyOnJobStart: boolean;
  notifyOnJobComplete: boolean;
  preferredChannel: "EMAIL" | "SMS" | "BOTH";
}

export interface PropertySummary {
  id: string;
  name: string;
  address: string;
  suburb: string;
}

export function ClientProfileForm({
  user,
  comms,
  properties,
  editingEnabled = true,
}: {
  user: ClientProfileFormUser;
  comms: ClientCommsPref;
  properties: PropertySummary[];
  editingEnabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const [name, setName] = React.useState(user.name ?? "");
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [address, setAddress] = React.useState(user.address ?? "");
  const [suburb, setSuburb] = React.useState(user.suburb ?? "");
  const [stateVal, setStateVal] = React.useState(user.state ?? "");
  const [postcode, setPostcode] = React.useState(user.postcode ?? "");

  const [pref, setPref] = React.useState<ClientCommsPref>(comms);

  async function patchProfile(payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || `Save failed (${res.status})`);
      return;
    }
    setSavedAt(Date.now());
    router.refresh();
  }

  async function patchComms(updates: Partial<ClientCommsPref>) {
    setError(null);
    const next = { ...pref, ...updates };
    setPref(next);
    const res = await fetch("/api/me/client-notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || `Save failed (${res.status})`);
    } else {
      setSavedAt(Date.now());
    }
  }

  function onAddressSelect(result: AddressResult) {
    setAddress(result.formattedAddress);
    setSuburb(result.suburb ?? "");
    setStateVal(result.state ?? "");
    setPostcode(result.postcode ?? "");
    patchProfile({
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
        <p className="text-xs text-muted-foreground" aria-live="polite">Saved.</p>
      )}

      <fieldset disabled={locked} className="space-y-6">
      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Auto-saves when you leave a field.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="name" label="Name">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== (user.name ?? "") && patchProfile({ name })}
            />
          </FormField>
          <FormField id="email" label="Email" hint="Contact admin to change your email.">
            <Input id="email" value={user.email} readOnly disabled />
          </FormField>
          <FormField id="phone" label="Mobile">
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => phone !== (user.phone ?? "") && patchProfile({ phone })}
            />
          </FormField>
        </CardContent>
      </Card>

      {/* Billing address */}
      <Card>
        <CardHeader>
          <CardTitle>Billing address</CardTitle>
          <CardDescription>Used on your invoices.</CardDescription>
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
        </CardContent>
      </Card>

      {/* Properties summary */}
      <Card>
        <CardHeader>
          <CardTitle>Your properties</CardTitle>
          <CardDescription>{properties.length} on file.</CardDescription>
        </CardHeader>
        <CardContent>
          {properties.length === 0 ? (
            <p className="text-sm text-muted-foreground">No properties yet.</p>
          ) : (
            <ul className="divide-y">
              {properties.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.address}, {p.suburb}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/client/properties/${p.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Communication preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Communication preferences</CardTitle>
          <CardDescription>How and when we contact you about jobs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField id="preferredChannel" label="Preferred channel">
            <Select
              value={pref.preferredChannel}
              onValueChange={(v) => patchComms({ preferredChannel: v as ClientCommsPref["preferredChannel"] })}
            >
              <SelectTrigger id="preferredChannel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="SMS">SMS</SelectItem>
                <SelectItem value="BOTH">Both</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <div className="space-y-3">
            <ToggleRow
              id="notificationsEnabled"
              label="Notifications overall"
              checked={pref.notificationsEnabled}
              onChange={(v) => patchComms({ notificationsEnabled: v })}
            />
            <ToggleRow
              id="notifyOnEnRoute"
              label="When the cleaner is en route"
              checked={pref.notifyOnEnRoute}
              onChange={(v) => patchComms({ notifyOnEnRoute: v })}
            />
            <ToggleRow
              id="notifyOnJobStart"
              label="When a job starts"
              checked={pref.notifyOnJobStart}
              onChange={(v) => patchComms({ notifyOnJobStart: v })}
            />
            <ToggleRow
              id="notifyOnJobComplete"
              label="When a job completes"
              checked={pref.notifyOnJobComplete}
              onChange={(v) => patchComms({ notifyOnJobComplete: v })}
            />
          </div>
        </CardContent>
      </Card>
      </fieldset>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
