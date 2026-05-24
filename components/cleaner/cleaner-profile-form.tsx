"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type VisaStatus = "CITIZEN" | "PERMANENT_RESIDENT" | "WORK_VISA" | "STUDENT_VISA" | "OTHER";
type EmploymentType = "CONTRACTOR" | "CASUAL" | "PART_TIME" | "FULL_TIME";

export interface CleanerProfileFormUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  dateOfBirth: Date | string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  visaStatus: VisaStatus | null;
  taxFileNumberOnFile: boolean;
  employmentType: EmploymentType | null;
  abn: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  hireDate: Date | string | null;
  languages: string[];
  hasVehicle: boolean;
  vehicleRegoExpiry: Date | string | null;
  driverLicenseExpiry: Date | string | null;
  notes: string | null;
}

function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function CleanerProfileForm({
  user,
  editingEnabled = true,
}: {
  user: CleanerProfileFormUser;
  editingEnabled?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Local copies so we can show edits without a roundtrip until blur.
  const [name, setName] = React.useState(user.name ?? "");
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [dateOfBirth, setDateOfBirth] = React.useState(toDateInputValue(user.dateOfBirth));
  const [emergencyContactName, setEcName] = React.useState(user.emergencyContactName ?? "");
  const [emergencyContactPhone, setEcPhone] = React.useState(user.emergencyContactPhone ?? "");
  const [emergencyContactRelation, setEcRelation] = React.useState(user.emergencyContactRelation ?? "");

  const [address, setAddress] = React.useState(user.address ?? "");
  const [suburb, setSuburb] = React.useState(user.suburb ?? "");
  const [stateVal, setStateVal] = React.useState(user.state ?? "");
  const [postcode, setPostcode] = React.useState(user.postcode ?? "");
  const [placeId, setPlaceId] = React.useState(user.placeId ?? "");
  const [latitude, setLatitude] = React.useState<number | null>(user.latitude);
  const [longitude, setLongitude] = React.useState<number | null>(user.longitude);

  const [employmentType, setEmploymentType] = React.useState<EmploymentType | "">(
    user.employmentType ?? "",
  );
  const [visaStatus, setVisaStatus] = React.useState<VisaStatus | "">(user.visaStatus ?? "");
  const [abn, setAbn] = React.useState(user.abn ?? "");

  const [bankBsb, setBankBsb] = React.useState(user.bankBsb ?? "");
  const [bankAccountNumber, setBankAccountNumber] = React.useState(user.bankAccountNumber ?? "");
  const [bankAccountName, setBankAccountName] = React.useState(user.bankAccountName ?? "");

  const [languagesText, setLanguagesText] = React.useState((user.languages ?? []).join(", "));
  const [hasVehicle, setHasVehicle] = React.useState(user.hasVehicle);
  const [vehicleRegoExpiry, setVehicleRegoExpiry] = React.useState(toDateInputValue(user.vehicleRegoExpiry));
  const [driverLicenseExpiry, setDriverLicenseExpiry] = React.useState(toDateInputValue(user.driverLicenseExpiry));

  const [taxFileNumberOnFile, setTfn] = React.useState(user.taxFileNumberOnFile);
  const [notes, setNotes] = React.useState(user.notes ?? "");

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
    setPlaceId(result.placeId);
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
      {/* 1. Identity & contact */}
      <Card>
        <CardHeader>
          <CardTitle>Identity & contact</CardTitle>
          <CardDescription>Your basic details. Auto-saves when you leave a field.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="name" label="Full name">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== (user.name ?? "") && patch({ name })}
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
              onBlur={() => phone !== (user.phone ?? "") && patch({ phone })}
            />
          </FormField>
          <FormField id="dateOfBirth" label="Date of birth">
            <Input
              id="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              onBlur={() =>
                dateOfBirth !== toDateInputValue(user.dateOfBirth) &&
                patch({ dateOfBirth: dateOfBirth || null })
              }
            />
          </FormField>

          <FormField id="emergencyContactName" label="Emergency contact name">
            <Input
              id="emergencyContactName"
              value={emergencyContactName}
              onChange={(e) => setEcName(e.target.value)}
              onBlur={() =>
                emergencyContactName !== (user.emergencyContactName ?? "") &&
                patch({ emergencyContactName })
              }
            />
          </FormField>
          <FormField id="emergencyContactPhone" label="Emergency contact phone">
            <Input
              id="emergencyContactPhone"
              type="tel"
              value={emergencyContactPhone}
              onChange={(e) => setEcPhone(e.target.value)}
              onBlur={() =>
                emergencyContactPhone !== (user.emergencyContactPhone ?? "") &&
                patch({ emergencyContactPhone })
              }
            />
          </FormField>
          <FormField id="emergencyContactRelation" label="Relationship">
            <Input
              id="emergencyContactRelation"
              placeholder="e.g. Spouse, Parent"
              value={emergencyContactRelation}
              onChange={(e) => setEcRelation(e.target.value)}
              onBlur={() =>
                emergencyContactRelation !== (user.emergencyContactRelation ?? "") &&
                patch({ emergencyContactRelation })
              }
            />
          </FormField>
        </CardContent>
      </Card>

      {/* 2. Home address */}
      <Card>
        <CardHeader>
          <CardTitle>Home address</CardTitle>
          <CardDescription>Used for routing and payroll records.</CardDescription>
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

      {/* 3. Employment */}
      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
          <CardDescription>Your engagement type. Hire date is set by admin.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="employmentType" label="Employment type">
            <Select
              value={employmentType || undefined}
              onValueChange={(v) => {
                setEmploymentType(v as EmploymentType);
                patch({ employmentType: v });
              }}
            >
              <SelectTrigger id="employmentType">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                <SelectItem value="CASUAL">Casual</SelectItem>
                <SelectItem value="PART_TIME">Part-time</SelectItem>
                <SelectItem value="FULL_TIME">Full-time</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="visaStatus" label="Visa status">
            <Select
              value={visaStatus || undefined}
              onValueChange={(v) => {
                setVisaStatus(v as VisaStatus);
                patch({ visaStatus: v });
              }}
            >
              <SelectTrigger id="visaStatus">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CITIZEN">Citizen</SelectItem>
                <SelectItem value="PERMANENT_RESIDENT">Permanent resident</SelectItem>
                <SelectItem value="WORK_VISA">Work visa</SelectItem>
                <SelectItem value="STUDENT_VISA">Student visa</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="abn" label="ABN" hint="Australian Business Number (contractors).">
            <Input
              id="abn"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              onBlur={() => abn !== (user.abn ?? "") && patch({ abn })}
            />
          </FormField>

          <FormField id="hireDate" label="Hire date" hint="Set by admin.">
            <Input
              id="hireDate"
              type="date"
              value={toDateInputValue(user.hireDate)}
              readOnly
              disabled
            />
          </FormField>
        </CardContent>
      </Card>

      {/* 4. Bank */}
      <Card>
        <CardHeader>
          <CardTitle>Bank for payroll</CardTitle>
          <CardDescription>
            Your payout destination. Kept private — only admins and you can view.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="bankAccountName" label="Account name">
            <Input
              id="bankAccountName"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              onBlur={() => bankAccountName !== (user.bankAccountName ?? "") && patch({ bankAccountName })}
            />
          </FormField>
          <FormField id="bankBsb" label="BSB">
            <Input
              id="bankBsb"
              value={bankBsb}
              placeholder="e.g. 062-000"
              onChange={(e) => setBankBsb(e.target.value)}
              onBlur={() => bankBsb !== (user.bankBsb ?? "") && patch({ bankBsb })}
            />
          </FormField>
          <FormField id="bankAccountNumber" label="Account number" className="sm:col-span-2">
            <Input
              id="bankAccountNumber"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              onBlur={() =>
                bankAccountNumber !== (user.bankAccountNumber ?? "") &&
                patch({ bankAccountNumber })
              }
            />
          </FormField>
        </CardContent>
      </Card>

      {/* 5. Skills & equipment */}
      <Card>
        <CardHeader>
          <CardTitle>Skills & equipment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="languages" label="Languages spoken" hint="Comma-separated (e.g. English, Mandarin)." className="sm:col-span-2">
            <Input
              id="languages"
              value={languagesText}
              onChange={(e) => setLanguagesText(e.target.value)}
              onBlur={() => {
                const parsed = languagesText
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (JSON.stringify(parsed) !== JSON.stringify(user.languages ?? [])) {
                  patch({ languages: parsed });
                }
              }}
            />
          </FormField>

          <FormField id="hasVehicle" label="Has own vehicle" className="sm:col-span-2">
            <div className="flex items-center gap-3">
              <Switch
                id="hasVehicle"
                checked={hasVehicle}
                onCheckedChange={(v) => {
                  setHasVehicle(v);
                  patch({ hasVehicle: v });
                }}
              />
              <span className="text-sm text-muted-foreground">
                {hasVehicle ? "Yes, I drive to jobs." : "I rely on public transport."}
              </span>
            </div>
          </FormField>

          <FormField id="vehicleRegoExpiry" label="Vehicle rego expiry">
            <Input
              id="vehicleRegoExpiry"
              type="date"
              value={vehicleRegoExpiry}
              onChange={(e) => setVehicleRegoExpiry(e.target.value)}
              onBlur={() =>
                vehicleRegoExpiry !== toDateInputValue(user.vehicleRegoExpiry) &&
                patch({ vehicleRegoExpiry: vehicleRegoExpiry || null })
              }
            />
          </FormField>
          <FormField id="driverLicenseExpiry" label="Driver licence expiry">
            <Input
              id="driverLicenseExpiry"
              type="date"
              value={driverLicenseExpiry}
              onChange={(e) => setDriverLicenseExpiry(e.target.value)}
              onBlur={() =>
                driverLicenseExpiry !== toDateInputValue(user.driverLicenseExpiry) &&
                patch({ driverLicenseExpiry: driverLicenseExpiry || null })
              }
            />
          </FormField>
        </CardContent>
      </Card>

      {/* 6. Tax */}
      <Card>
        <CardHeader>
          <CardTitle>Tax</CardTitle>
          <CardDescription>
            We don't store your TFN. Tick this once you've supplied it to admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="taxFileNumberOnFile"
              checked={taxFileNumberOnFile}
              onCheckedChange={(v) => {
                setTfn(v);
                patch({ taxFileNumberOnFile: v });
              }}
            />
            <label htmlFor="taxFileNumberOnFile" className="text-sm">
              Tax File Number is on file
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
          <CardDescription>Anything you want admin to know.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (user.notes ?? "") && patch({ notes })}
            rows={4}
          />
        </CardContent>
      </Card>
      </fieldset>
    </div>
  );
}
