"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { JobType, Role } from "@prisma/client";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { AppSettings } from "@/lib/settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TemplateEditor } from "@/components/admin/template-editor";

interface SettingsEditorProps {
  initialSettings: AppSettings;
  cleanerOptions: Array<{
    id: string;
    name: string | null;
    email: string;
  }>;
  readOnly?: boolean;
}

const SETTINGS_RESTORED_EVENT = "sneek:settings-restored";

const ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.CLIENT, Role.LAUNDRY];
const JOB_TYPES: JobType[] = [
  JobType.AIRBNB_TURNOVER,
  JobType.DEEP_CLEAN,
  JobType.END_OF_LEASE,
  JobType.GENERAL_CLEAN,
  JobType.POST_CONSTRUCTION,
  JobType.PRESSURE_WASH,
  JobType.WINDOW_CLEAN,
  JobType.LAWN_MOWING,
  JobType.SPECIAL_CLEAN,
  JobType.COMMERCIAL_RECURRING,
];

function cleanerLabel(cleaner: { id: string; name: string | null; email: string }) {
  if (cleaner.name?.trim()) return `${cleaner.name} (${cleaner.email})`;
  return cleaner.email;
}

function normalizeOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function dedupeOptionList(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = normalizeOptionLabel(rawValue);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

export function SettingsEditor({ initialSettings, cleanerOptions, readOnly = false }: SettingsEditorProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingReportLogo, setUploadingReportLogo] = useState(false);
  const [newBagLocation, setNewBagLocation] = useState("");
  const [newDropoffLocation, setNewDropoffLocation] = useState("");
  const [selectedCleanerToAdd, setSelectedCleanerToAdd] = useState("");
  const [selectedRateCleanerId, setSelectedRateCleanerId] = useState(
    cleanerOptions[0]?.id ?? ""
  );

  const cleanerById = useMemo(
    () => new Map(cleanerOptions.map((cleaner) => [cleaner.id, cleaner] as const)),
    [cleanerOptions]
  );
  const availableCleaners = useMemo(
    () =>
      cleanerOptions.filter(
        (cleaner) => !settings.selectAllAllowedCleanerIds.includes(cleaner.id)
      ),
    [cleanerOptions, settings.selectAllAllowedCleanerIds]
  );

  // Live preview of the evidence-photo timestamp (matches lib/uploads/stamp.ts).
  const evidenceStampPreview = useMemo(() => {
    const { dateFormat, timeFormat, showWeekday } = settings.evidenceStamp;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sample = new Date(2026, 5, 13, 15, 43); // Sat 13 Jun 2026, 15:43
    const dd = "13";
    const mm = "06";
    const yyyy = "2026";
    let dateStr: string;
    switch (dateFormat) {
      case "MM/DD/YYYY":
        dateStr = `${mm}/${dd}/${yyyy}`;
        break;
      case "YYYY-MM-DD":
        dateStr = `${yyyy}-${mm}-${dd}`;
        break;
      case "DD MMM YYYY":
        dateStr = `${dd} ${months[5]} ${yyyy}`;
        break;
      default:
        dateStr = `${dd}/${mm}/${yyyy}`;
    }
    const timeStr = timeFormat === "hh:mm a" ? "3:43 pm" : "15:43";
    const weekdayStr = showWeekday
      ? ` · ${sample.toLocaleDateString("en-AU", { weekday: "short" })}`
      : "";
    return `${timeStr} · ${dateStr}${weekdayStr}`;
  }, [settings.evidenceStamp]);

  function hydrateFromSnapshot(nextSettings: AppSettings) {
    setSettings(nextSettings);
  }

  useEffect(() => {
    hydrateFromSnapshot(initialSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSettings]);

  useEffect(() => {
    function handleSettingsRestored(event: Event) {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (!detail || typeof detail !== "object") return;
      hydrateFromSnapshot(detail);
    }

    window.addEventListener(SETTINGS_RESTORED_EVENT, handleSettingsRestored as EventListener);
    return () => {
      window.removeEventListener(SETTINGS_RESTORED_EVENT, handleSettingsRestored as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (readOnly) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Failed to save settings", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    setSettings(body);
    toast({ title: "Settings updated" });
  }

  async function uploadLogo(file: File) {
    if (readOnly) return;
    setUploadingLogo(true);
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "branding");
    const res = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    setUploadingLogo(false);
    if (!res.ok) {
      toast({ title: "Logo upload failed", description: body.error ?? "Could not upload logo.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({ ...prev, logoUrl: body.url ?? prev.logoUrl }));
    toast({ title: "Logo uploaded" });
  }

  async function uploadReportLogo(file: File) {
    if (readOnly) return;
    setUploadingReportLogo(true);
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "branding");
    const res = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    setUploadingReportLogo(false);
    if (!res.ok) {
      toast({ title: "Report logo upload failed", description: body.error ?? "Could not upload logo.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({ ...prev, reportLogoUrl: body.url ?? prev.reportLogoUrl }));
    toast({ title: "Report logo uploaded" });
  }

  function addBagLocationOption() {
    const value = normalizeOptionLabel(newBagLocation);
    if (!value) return;
    setSettings((prev) => ({
      ...prev,
      laundryBagLocationOptions: dedupeOptionList([...prev.laundryBagLocationOptions, value]),
    }));
    setNewBagLocation("");
  }

  function addDropoffLocationOption() {
    const value = normalizeOptionLabel(newDropoffLocation);
    if (!value) return;
    setSettings((prev) => ({
      ...prev,
      laundryDropoffLocationOptions: dedupeOptionList([...prev.laundryDropoffLocationOptions, value]),
    }));
    setNewDropoffLocation("");
  }

  function removeBagLocationOption(value: string) {
    if (settings.laundryBagLocationOptions.length <= 1) {
      toast({ title: "At least one bag location option is required.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({
      ...prev,
      laundryBagLocationOptions: prev.laundryBagLocationOptions.filter((item) => item !== value),
    }));
  }

  function removeDropoffLocationOption(value: string) {
    if (settings.laundryDropoffLocationOptions.length <= 1) {
      toast({ title: "At least one drop-off location option is required.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({
      ...prev,
      laundryDropoffLocationOptions: prev.laundryDropoffLocationOptions.filter((item) => item !== value),
    }));
  }

  function addAllowedCleaner() {
    if (!selectedCleanerToAdd) return;
    setSettings((prev) => ({
      ...prev,
      selectAllAllowedCleanerIds: Array.from(
        new Set([...prev.selectAllAllowedCleanerIds, selectedCleanerToAdd])
      ),
    }));
    setSelectedCleanerToAdd("");
  }

  function removeAllowedCleaner(cleanerId: string) {
    setSettings((prev) => ({
      ...prev,
      selectAllAllowedCleanerIds: prev.selectAllAllowedCleanerIds.filter((id) => id !== cleanerId),
    }));
  }

  function getCleanerRateValue(cleanerId: string, jobType: JobType): string {
    const value = settings.cleanerJobHourlyRates?.[cleanerId]?.[jobType];
    return value === undefined || value === null ? "" : String(value);
  }

  function setCleanerRate(cleanerId: string, jobType: JobType, rawValue: string) {
    const trimmed = rawValue.trim();
    setSettings((prev) => {
      const existing = { ...(prev.cleanerJobHourlyRates ?? {}) };
      const cleanerRates = { ...(existing[cleanerId] ?? {}) };

      if (!trimmed) {
        delete cleanerRates[jobType];
      } else {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric >= 0) {
          cleanerRates[jobType] = numeric;
        }
      }

      if (Object.keys(cleanerRates).length === 0) {
        delete existing[cleanerId];
      } else {
        existing[cleanerId] = cleanerRates;
      }

      return { ...prev, cleanerJobHourlyRates: existing };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Editable System Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Company name</Label>
            <Input
              value={settings.companyName}
              onChange={(e) => setSettings((prev) => ({ ...prev, companyName: e.target.value }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Company phone</Label>
            <Input
              type="tel"
              value={settings.companyPhone}
              onChange={(e) => setSettings((prev) => ({ ...prev, companyPhone: e.target.value }))}
              disabled={readOnly}
              placeholder="e.g. 02 1234 5678"
            />
            <p className="text-xs text-muted-foreground">Office / dispatch number shown to cleaners on their jobs.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Project name</Label>
            <Input
              value={settings.projectName}
              onChange={(e) => setSettings((prev) => ({ ...prev, projectName: e.target.value }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Input
              value={settings.timezone}
              onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label>Show client contact to cleaners</Label>
            <p className="text-xs text-muted-foreground">Cleaners see the client&apos;s name &amp; phone on their jobs.</p>
          </div>
          <Switch
            checked={settings.cleanerClientContact}
            onCheckedChange={(checked) =>
              setSettings((prev) => ({ ...prev, cleanerClientContact: checked }))
            }
            disabled={readOnly}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input
              value={settings.logoUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, logoUrl: e.target.value }))}
              disabled={readOnly}
              placeholder="https://.../logo.png"
            />
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                disabled={readOnly || uploadingLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo(file);
                  e.currentTarget.value = "";
                }}
              />
              {uploadingLogo ? <span className="text-xs text-muted-foreground">Uploading...</span> : null}
            </div>
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logoUrl} alt="Logo preview" className="h-12 w-auto rounded border bg-white p-1" />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Report / invoice logo (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Used on PDF reports and cleaner invoices. Use a light or transparent version that looks
              clean on white. Falls back to the main logo if left empty.
            </p>
            <Input
              value={settings.reportLogoUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, reportLogoUrl: e.target.value }))}
              disabled={readOnly}
              placeholder="https://.../report-logo.png"
            />
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                disabled={readOnly || uploadingReportLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadReportLogo(file);
                  e.currentTarget.value = "";
                }}
              />
              {uploadingReportLogo ? <span className="text-xs text-muted-foreground">Uploading...</span> : null}
            </div>
            {settings.reportLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.reportLogoUrl} alt="Report logo preview" className="h-12 w-auto rounded border bg-white p-1" />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Accounts email</Label>
            <Input
              value={settings.accountsEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, accountsEmail: e.target.value }))}
              disabled={readOnly}
              placeholder="accounts@sneekproservices.com.au"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>SMS provider</Label>
            <Select
              value={settings.smsProvider}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  smsProvider: value as AppSettings["smsProvider"],
                }))
              }
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select SMS provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="twilio">Twilio</SelectItem>
                <SelectItem value="cellcast">Cellcast</SelectItem>
                <SelectItem value="none">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Credentials still come from environment variables. Use `TWILIO_*` for Twilio or `CELLCAST_APPKEY`
              for Cellcast. Optional Cellcast overrides: `CELLCAST_API_URL`, `CELLCAST_FROM`. Leave
              `CELLCAST_FROM` empty unless you have a valid short sender ID approved for Cellcast.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Reminder: 24h (hours before)</Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={settings.reminder24hHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, reminder24hHours: Number(e.target.value || 24) }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reminder: 2h (hours before)</Label>
            <Input
              type="number"
              min={1}
              max={48}
              value={settings.reminder2hHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, reminder2hHours: Number(e.target.value || 2) }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Quote validity (days)</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={settings.quoteDefaultValidityDays}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, quoteDefaultValidityDays: Number(e.target.value || 14) }))
              }
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Quote email subject</Label>
            <Input
              value={settings.quoteDefaultEmailSubject}
              onChange={(e) => setSettings((prev) => ({ ...prev, quoteDefaultEmailSubject: e.target.value }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Pricing tax handling</p>
              <p className="text-xs text-muted-foreground">
                Turn GST on or off for new quotes, public instant estimates, counter offers, and newly generated client
                invoices. Existing saved records stay unchanged.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-md border px-3 py-2">
              <div className="text-right">
                <p className="text-sm font-medium">{settings.pricing.gstEnabled ? "GST enabled" : "GST disabled"}</p>
                <p className="text-xs text-muted-foreground">
                  {settings.pricing.gstEnabled ? "New pricing adds 10% GST." : "New pricing stays GST-free."}
                </p>
              </div>
              <Switch
                checked={settings.pricing.gstEnabled}
                onCheckedChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    pricing: {
                      ...prev.pricing,
                      gstEnabled: value,
                    },
                  }))
                }
                disabled={readOnly}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Invoicing &amp; Payment Details</p>
            <p className="text-xs text-muted-foreground">
              Bank and company details shown on client invoice PDFs and email attachments.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default payment terms (days)</Label>
              <Input
                type="number"
                min={0}
                max={90}
                value={settings.invoicing.defaultPaymentTermsDays}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    invoicing: { ...prev.invoicing, defaultPaymentTermsDays: Number(e.target.value || 14) },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>ABN</Label>
              <Input
                value={settings.invoicing.abn}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, invoicing: { ...prev.invoicing, abn: e.target.value } }))
                }
                disabled={readOnly}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bank name</Label>
              <Input
                value={settings.invoicing.bankName}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, invoicing: { ...prev.invoicing, bankName: e.target.value } }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>BSB</Label>
              <Input
                value={settings.invoicing.bankBsb}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, invoicing: { ...prev.invoicing, bankBsb: e.target.value } }))
                }
                disabled={readOnly}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Account number</Label>
              <Input
                value={settings.invoicing.bankAccountNumber}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    invoicing: { ...prev.invoicing, bankAccountNumber: e.target.value },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input
                value={settings.invoicing.bankAccountName}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    invoicing: { ...prev.invoicing, bankAccountName: e.target.value },
                  }))
                }
                disabled={readOnly}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Company address</Label>
            <Textarea
              rows={2}
              value={settings.invoicing.companyAddress}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  invoicing: { ...prev.invoicing, companyAddress: e.target.value },
                }))
              }
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment note</Label>
            <Textarea
              rows={2}
              value={settings.invoicing.paymentNote}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  invoicing: { ...prev.invoicing, paymentNote: e.target.value },
                }))
              }
              disabled={readOnly}
              placeholder="e.g. Please include invoice number as payment reference."
            />
          </div>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Evidence photo stamp</p>
            <p className="text-xs text-muted-foreground">
              Timestamp format burned into every job / QA / maintenance photo (Australia/Sydney).
              Preview: <span className="font-medium text-foreground">{evidenceStampPreview}</span>
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date format</Label>
              <Select
                value={settings.evidenceStamp.dateFormat}
                onValueChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    evidenceStamp: {
                      ...prev.evidenceStamp,
                      dateFormat: value as AppSettings["evidenceStamp"]["dateFormat"],
                    },
                  }))
                }
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (13/06/2026)</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (06/13/2026)</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (2026-06-13)</SelectItem>
                  <SelectItem value="DD MMM YYYY">DD MMM YYYY (13 Jun 2026)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Time format</Label>
              <Select
                value={settings.evidenceStamp.timeFormat}
                onValueChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    evidenceStamp: {
                      ...prev.evidenceStamp,
                      timeFormat: value as AppSettings["evidenceStamp"]["timeFormat"],
                    },
                  }))
                }
                disabled={readOnly}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HH:mm">24-hour (15:43)</SelectItem>
                  <SelectItem value="hh:mm a">12-hour (3:43 pm)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Show weekday</p>
              <p className="text-xs text-muted-foreground">Adds the day name (e.g. Sat) under the date.</p>
            </div>
            <Switch
              checked={settings.evidenceStamp.showWeekday}
              onCheckedChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  evidenceStamp: { ...prev.evidenceStamp, showWeekday: value },
                }))
              }
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Cleaner start date verification</p>
              <p className="text-xs text-muted-foreground">Cleaner must verify scheduled date when starting.</p>
            </div>
            <Switch
              checked={settings.cleanerStartRequireDateMatch}
              onCheckedChange={(value) => setSettings((prev) => ({ ...prev, cleanerStartRequireDateMatch: value }))}
              disabled={readOnly}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Cleaner start checklist verification</p>
              <p className="text-xs text-muted-foreground">Cleaner must confirm on-site readiness before start.</p>
            </div>
            <Switch
              checked={settings.cleanerStartRequireChecklistConfirm}
              onCheckedChange={(value) =>
                setSettings((prev) => ({ ...prev, cleanerStartRequireChecklistConfirm: value }))
              }
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Client communication requires admin initiation</p>
            <p className="text-xs text-muted-foreground">
              When enabled, automatic client messaging is blocked and only admin-initiated share actions can send.
            </p>
          </div>
          <Switch
            checked={settings.strictClientAdminOnly}
            onCheckedChange={(value) =>
              setSettings((prev) => ({ ...prev, strictClientAdminOnly: value }))
            }
            disabled={readOnly}
          />
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Laundry Location Dropdowns</p>
            <p className="text-xs text-muted-foreground">
              Manage pickup and drop-off location lists in one place. Use the sync buttons if both lists should match.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  laundryDropoffLocationOptions: dedupeOptionList(prev.laundryBagLocationOptions),
                }))
              }
              disabled={readOnly}
            >
              Copy bag options to drop-off
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  laundryBagLocationOptions: dedupeOptionList(prev.laundryDropoffLocationOptions),
                }))
              }
              disabled={readOnly}
            >
              Copy drop-off options to bag
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bag / pickup locations</Label>
              <div className="flex gap-2">
                <Input
                  value={newBagLocation}
                  onChange={(e) => setNewBagLocation(e.target.value)}
                  disabled={readOnly}
                  placeholder="Add bag location option"
                />
                <Button type="button" variant="outline" onClick={addBagLocationOption} disabled={readOnly || !newBagLocation.trim()}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
              <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-input/70 bg-card p-3">
                {settings.laundryBagLocationOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No options yet.</p>
                ) : (
                  settings.laundryBagLocationOptions.map((option) => (
                    <span
                      key={option}
                      className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-3 py-1 text-xs"
                    >
                      {option}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeBagLocationOption(option)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${option}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Drop-off locations</Label>
              <div className="flex gap-2">
                <Input
                  value={newDropoffLocation}
                  onChange={(e) => setNewDropoffLocation(e.target.value)}
                  disabled={readOnly}
                  placeholder="Add drop-off location option"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addDropoffLocationOption}
                  disabled={readOnly || !newDropoffLocation.trim()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
              <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-input/70 bg-card p-3">
                {settings.laundryDropoffLocationOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No options yet.</p>
                ) : (
                  settings.laundryDropoffLocationOptions.map((option) => (
                    <span
                      key={option}
                      className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-3 py-1 text-xs"
                    >
                      {option}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeDropoffLocationOption(option)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${option}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Select-all allowed cleaners</Label>
          <div className="flex gap-2">
            <Select value={selectedCleanerToAdd} onValueChange={setSelectedCleanerToAdd} disabled={readOnly || availableCleaners.length === 0}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={availableCleaners.length === 0 ? "No more cleaners to add" : "Select a cleaner"} />
              </SelectTrigger>
              <SelectContent>
                {availableCleaners.map((cleaner) => (
                  <SelectItem key={cleaner.id} value={cleaner.id}>
                    {cleanerLabel(cleaner)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={addAllowedCleaner} disabled={readOnly || !selectedCleanerToAdd}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
          <div className="space-y-2 rounded-xl border border-input/70 bg-card p-3">
            {settings.selectAllAllowedCleanerIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cleaners selected.</p>
            ) : (
              settings.selectAllAllowedCleanerIds.map((cleanerId) => {
                const cleaner = cleanerById.get(cleanerId);
                return (
                  <div key={cleanerId} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {cleaner ? cleaner.name ?? cleaner.email : cleanerId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cleaner ? `${cleaner.email} - ${cleanerId}` : cleanerId}
                      </p>
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAllowedCleaner(cleanerId)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Only selected cleaners can use the checklist Select All button.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Clock out without finishing the form</Label>
          <p className="text-xs text-muted-foreground">
            Selected cleaners can clock out before completing the form and finish it later. The job is parked as
            “form pending” and is <strong>not counted as completed</strong> until the form is submitted.
          </p>
          <div className="space-y-2 rounded-xl border border-input/70 bg-card p-3">
            {cleanerOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cleaners available.</p>
            ) : (
              cleanerOptions.map((cleaner) => {
                const checked = settings.clockOutWithoutFormAllowedCleanerIds.includes(cleaner.id);
                return (
                  <div key={cleaner.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{cleaner.name ?? cleaner.email}</p>
                      <p className="text-xs text-muted-foreground">{cleaner.email}</p>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={readOnly}
                      onCheckedChange={(v) =>
                        setSettings((prev) => ({
                          ...prev,
                          clockOutWithoutFormAllowedCleanerIds: v === true
                            ? Array.from(new Set([...prev.clockOutWithoutFormAllowedCleanerIds, cleaner.id]))
                            : prev.clockOutWithoutFormAllowedCleanerIds.filter((id) => id !== cleaner.id),
                        }))
                      }
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-input/70 bg-card p-3">
          <div className="pr-3">
            <Label>Recent-text suggestions</Label>
            <p className="text-xs text-muted-foreground">
              The “recently typed” dropdown on text fields (same-session history). Always off on login/sign-up pages.
            </p>
          </div>
          <Switch
            checked={settings.inputHistorySuggestionsEnabled}
            disabled={readOnly}
            onCheckedChange={(v) => setSettings((prev) => ({ ...prev, inputHistorySuggestionsEnabled: v === true }))}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Cleaner hourly rates by job category</p>
          {cleanerOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active cleaners found.</p>
          ) : (
            <>
              <div className="max-w-md">
                <Label>Select cleaner</Label>
                <Select
                  value={selectedRateCleanerId}
                  onValueChange={setSelectedRateCleanerId}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cleaner" />
                  </SelectTrigger>
                  <SelectContent>
                    {cleanerOptions.map((cleaner) => (
                      <SelectItem key={cleaner.id} value={cleaner.id}>
                        {cleanerLabel(cleaner)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRateCleanerId ? (
                <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                  {JOB_TYPES.map((jobType) => (
                    <div key={jobType} className="space-y-1">
                      <Label className="text-xs">{jobType.replace(/_/g, " ")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={getCleanerRateValue(selectedRateCleanerId, jobType)}
                        onChange={(e) => setCleanerRate(selectedRateCleanerId, jobType, e.target.value)}
                        disabled={readOnly}
                        placeholder="e.g. 30"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            These rates are applied automatically to assignment pay rates (`JobAssignment.payRate`) per job type.
          </p>
        </div>

        <TemplateEditor settings={settings} onSettingsChange={setSettings} readOnly={readOnly} />

        <div className="space-y-2">
          <p className="text-sm font-medium">Profile edit permissions by role</p>
          <div className="space-y-2">
            {ROLES.map((role) => {
              const policy = settings.profileEditPolicy[role];
              return (
                <div key={role} className="grid items-center gap-2 rounded-md border p-3 md:grid-cols-4">
                  <p className="text-sm font-medium">{role}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Name</Label>
                    <Switch
                      checked={policy.canEditName}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditName: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Phone</Label>
                    <Switch
                      checked={policy.canEditPhone}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditPhone: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Email</Label>
                    <Switch
                      checked={policy.canEditEmail}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditEmail: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Client Portal Visibility (Admin-controlled)</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              {[
                ["showProperties", "Show properties"],
                ["showJobs", "Show jobs"],
                ["showCalendar", "Show calendar"],
                ["showReports", "Show reports"],
                ["showReportDownloads", "Allow report PDF downloads"],
                ["showChecklistPreview", "Show checklist preview"],
                ["showInventory", "Show inventory"],
                ["showShopping", "Show shopping"],
                ["showStockRuns", "Show stock count runs"],
                ["showFinanceDetails", "Show finance details"],
                ["showOngoingJobs", "Show ongoing jobs"],
                ["showLaundryUpdates", "Show laundry updates"],
                ["showLaundryImages", "Show laundry images"],
                ["showLaundryCosts", "Show laundry costs"],
                ["showClientTaskRequests", "Allow client task requests"],
                ["showCases", "Show cases/issues"],
                ["showExtraPayRequests", "Show extra pay requests"],
                ["showQuoteRequests", "Show quote requests"],
                ["showApprovals", "Show approval requests"],
                ["showCleanerNames", "Show cleaner names to client"],
              ["allowInventoryThresholdEdits", "Allow client inventory threshold edits"],
              ["allowStockRuns", "Allow client stock count runs"],
              ["allowCaseReplies", "Allow client case replies"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.clientPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      clientPortalVisibility: {
                        ...prev.clientPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Controls what clients can view in the Client Portal. Hidden sections are removed from navigation.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Cleaner Portal Visibility</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {[
              ["showJobs", "Show jobs"],
              ["showCalendar", "Show calendar"],
              ["showShopping", "Show shopping"],
              ["showStockRuns", "Show stock count runs"],
              ["showInvoices", "Show invoices"],
              ["showPayRequests", "Show pay requests"],
              ["showLostFound", "Show lost and found"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.cleanerPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      cleanerPortalVisibility: {
                        ...prev.cleanerPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Public Site Widgets</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {[
              ["instantQuoteEstimator", "Instant price estimator (home page)"],
              ["availabilityChecker", "Suburb availability checker"],
              ["liveChat", "Live chat / WhatsApp button"],
              ["newsletterSignup", "Newsletter signup form"],
              ["testimonialCarousel", "Testimonial carousel"],
              ["serviceCalculator", "Service calculator widgets"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.publicWidgets as any)?.[key] ?? true}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      publicWidgets: {
                        ...(prev.publicWidgets ?? {}),
                        [key]: value,
                      } as any,
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Controls which optional widgets render on the public marketing site. Disabled widgets are removed from the home page.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Laundry Portal Controls</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {[
              ["showCalendar", "Show calendar"],
              ["showInvoices", "Show invoices"],
              ["showHistoryTab", "Show history tab"],
              ["showCostTracking", "Show laundry cost tracking"],
              ["showPickupPhoto", "Allow pickup photo"],
              ["showSkipReasons", "Show skip reasons and cleaner notes"],
              ["requireDropoffPhoto", "Require drop-off photo"],
              ["requireEarlyDropoffReason", "Require reason for early drop-off"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.laundryPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryPortalVisibility: {
                        ...prev.laundryPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pickup cutoff time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.pickupCutoffTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, pickupCutoffTime: e.target.value || "10:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default pickup time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.defaultPickupTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, defaultPickupTime: e.target.value || "09:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default drop-off time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.defaultDropoffTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, defaultDropoffTime: e.target.value || "16:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fallback outdoor days (manual jobs only)</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={settings.laundryOperations.maxOutdoorDays}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: {
                      ...prev.laundryOperations,
                      maxOutdoorDays: Number(e.target.value || prev.laundryOperations.maxOutdoorDays),
                    },
                  }))
                }
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                Used when fast-return is disabled and there is no next known clean date.
              </p>
            </div>
            <div className="space-y-2 rounded border p-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-xs">Fast return when no next clean is known</Label>
                  <p className="text-xs text-muted-foreground">
                    If enabled, planner returns linen quickly so you can handle last-minute bookings.
                  </p>
                </div>
                <Switch
                  checked={settings.laundryOperations.fastReturnWhenNoNextClean}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryOperations: { ...prev.laundryOperations, fastReturnWhenNoNextClean: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fast-return days after pickup</Label>
                <Input
                  type="number"
                  min={1}
                  max={7}
                  value={settings.laundryOperations.fastReturnDaysWhenNoNextClean}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryOperations: {
                        ...prev.laundryOperations,
                        fastReturnDaysWhenNoNextClean: Number(
                          e.target.value || prev.laundryOperations.fastReturnDaysWhenNoNextClean
                        ),
                      },
                    }))
                  }
                  disabled={readOnly || !settings.laundryOperations.fastReturnWhenNoNextClean}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These settings control the laundry portal menus and operational defaults shown to the laundry team.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Notification Defaults</p>
          <div className="grid gap-3 rounded-md border p-3">
            {Object.entries(settings.notificationDefaults.categories).map(([category, channels]) => (
              <div key={category} className="grid items-center gap-3 rounded border p-3 md:grid-cols-4">
                <div>
                  <p className="text-sm font-medium capitalize">{category}</p>
                  <p className="text-xs text-muted-foreground">Default delivery channels for new users and untouched preferences.</p>
                </div>
                {(["web", "email", "sms"] as const).map((channel) => (
                  <div key={`${category}-${channel}`} className="flex items-center justify-between gap-2 rounded border p-2">
                    <Label className="text-xs uppercase">{channel}</Label>
                    <Switch
                      checked={Boolean((channels as any)?.[channel])}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          notificationDefaults: {
                            ...prev.notificationDefaults,
                            categories: {
                              ...prev.notificationDefaults.categories,
                              [category]: {
                                ...prev.notificationDefaults.categories[category as keyof typeof prev.notificationDefaults.categories],
                                [channel]: value,
                              },
                            },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Scheduled Notification Automation</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">24-hour reminder emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends the scheduled email reminder flow based on the reminder hours above.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.reminder24hEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        reminder24hEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">2-hour reminder SMS</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends the scheduled SMS reminder flow based on the reminder hours above.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.reminder2hEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        reminder2hEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Tomorrow prep summaries</Label>
                  <p className="text-xs text-muted-foreground">
                    Cleaner, laundry, and admin tomorrow-prep notifications with critical stock alerts.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.tomorrowPrepEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        tomorrowPrepEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tomorrow prep send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.tomorrowPrepTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        tomorrowPrepTime: e.target.value || "17:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Critical stock alert emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Daily admin low-stock alert using the inventory reorder thresholds.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.stockAlertsEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        stockAlertsEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Stock alert send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.stockAlertsTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        stockAlertsTime: e.target.value || "07:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Daily admin attention summary</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends admins a daily email and SMS summary of approvals, unassigned jobs, cases, and flagged work.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.adminAttentionSummaryEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        adminAttentionSummaryEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Admin summary send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.adminAttentionSummaryTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        adminAttentionSummaryTime: e.target.value || "08:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Auto-approve sync laundry drafts</Label>
                  <p className="text-xs text-muted-foreground">
                    When iCal sync changes future laundry schedules, approve and publish the draft automatically.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.autoApproveLaundrySyncDrafts}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        autoApproveLaundrySyncDrafts: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div>
                <Label className="text-xs">Laundry future notification horizon</Label>
                <p className="text-xs text-muted-foreground">
                  Limit sync-driven laundry update emails/SMS to bookings happening within the next set number of days.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Days ahead</Label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={settings.scheduledNotifications.laundrySyncNotificationHorizonDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        laundrySyncNotificationHorizonDays: Number(
                          e.target.value || prev.scheduledNotifications.laundrySyncNotificationHorizonDays
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These controls affect the worker-driven timed notification jobs. Manual dispatch remains available in the Notifications tab.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Operational Safeguards</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Auto clock-out enabled</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically stop running time logs after the configured grace period.
                  </p>
                </div>
                <Switch
                  checked={settings.autoClockOut.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: { ...prev.autoClockOut, enabled: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="flex items-center justify-between rounded border p-2">
                <div>
                  <Label className="text-xs">Stop timer at the job&apos;s estimated duration</Label>
                  <p className="text-xs text-muted-foreground">
                    Off by default — the timer keeps running past the estimate. Turn on to auto
                    clock-out when the estimated hours are used up.
                  </p>
                </div>
                <Switch
                  checked={settings.autoClockOut.stopAtEstimatedDuration}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: { ...prev.autoClockOut, stopAtEstimatedDuration: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Grace minutes after due time</Label>
                <p className="text-xs text-muted-foreground">
                  Timers auto-stop this many minutes after the job&apos;s due/end time.
                </p>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={settings.autoClockOut.graceMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: {
                        ...prev.autoClockOut,
                        graceMinutes: Number(e.target.value || prev.autoClockOut.graceMinutes),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Maximum job length (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.autoClockOut.maxJobLengthHours}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: {
                        ...prev.autoClockOut,
                        maxJobLengthHours: Number(
                          e.target.value || prev.autoClockOut.maxJobLengthHours
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
                <p className="text-xs text-muted-foreground">
                  Used when a job does not have fixed / allocated pay hours set.
                </p>
              </div>
              <div className="flex items-center justify-between rounded border p-2">
                <div>
                  <Label className="text-xs">Fallback auto clock-out at midnight</Label>
                  <p className="text-xs text-muted-foreground">
                    Safety net when a job has no due or end time.
                  </p>
                </div>
                <Switch
                  checked={settings.autoClockOut.fallbackAtMidnight}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: { ...prev.autoClockOut, fallbackAtMidnight: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Operations</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">SLA monitoring enabled</Label>
                <Switch
                  checked={settings.sla.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({ ...prev, sla: { ...prev.sla, enabled: value } }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Warn before due (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={72}
                  value={settings.sla.warnHoursBeforeDue}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      sla: { ...prev.sla, warnHoursBeforeDue: Number(e.target.value || prev.sla.warnHoursBeforeDue) },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Escalate overdue after (mins)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.sla.overdueEscalationMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      sla: {
                        ...prev.sla,
                        overdueEscalationMinutes: Number(
                          e.target.value || prev.sla.overdueEscalationMinutes
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <p className="text-xs font-medium">Auto-case creation</p>
              <p className="text-[11px] text-muted-foreground">
                Limit formal cases for minor breaches. Smaller breaches stay as soft attention items.
              </p>
              <div className="space-y-1.5">
                <Label>Only auto-open at severity</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={settings.caseAutomation.autoOpenMinSeverity}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      caseAutomation: {
                        ...prev.caseAutomation,
                        autoOpenMinSeverity: e.target.value as typeof prev.caseAutomation.autoOpenMinSeverity,
                      },
                    }))
                  }
                  disabled={readOnly}
                >
                  <option value="LOW">Low and above</option>
                  <option value="MEDIUM">Medium and above</option>
                  <option value="HIGH">High and above</option>
                  <option value="CRITICAL">Critical only</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Overdue grace before case (mins)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={settings.caseAutomation.overdueGraceMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      caseAutomation: {
                        ...prev.caseAutomation,
                        overdueGraceMinutes: Number(
                          e.target.value || prev.caseAutomation.overdueGraceMinutes
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Dedupe by job + type</Label>
                <Switch
                  checked={settings.caseAutomation.dedupeByJobAndType}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      caseAutomation: { ...prev.caseAutomation, dedupeByJobAndType: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Auto-resolve when condition clears</Label>
                <Switch
                  checked={settings.caseAutomation.autoResolveOnClear}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      caseAutomation: { ...prev.caseAutomation, autoResolveOnClear: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Recurring generation enabled</Label>
                <Switch
                  checked={settings.recurringJobs.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      recurringJobs: { ...prev.recurringJobs, enabled: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lookahead days</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.recurringJobs.lookaheadDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      recurringJobs: {
                        ...prev.recurringJobs,
                        lookaheadDays: Number(e.target.value || prev.recurringJobs.lookaheadDays),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Smart auto-assign enabled</Label>
                <Switch
                  checked={settings.autoAssign.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({ ...prev, autoAssign: { ...prev.autoAssign, enabled: value } }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max daily jobs per cleaner</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.autoAssign.maxDailyJobsPerCleaner}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoAssign: {
                        ...prev.autoAssign,
                        maxDailyJobsPerCleaner: Number(
                          e.target.value || prev.autoAssign.maxDailyJobsPerCleaner
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Offer a rework job on a QA fail</Label>
                <Switch
                  checked={settings.qaAutomation.autoCreateReworkJob}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: { ...prev.qaAutomation, autoCreateReworkJob: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>QA fail threshold</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.qaAutomation.failureThreshold}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: {
                        ...prev.qaAutomation,
                        failureThreshold: Number(e.target.value || prev.qaAutomation.failureThreshold),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rework delay (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.qaAutomation.reworkDelayHours}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: {
                        ...prev.qaAutomation,
                        reworkDelayHours: Number(e.target.value || prev.qaAutomation.reworkDelayHours),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These controls power SLA escalation, recurring generation, smart assignment scoring, route optimization, and QA rework automation.
          </p>
        </div>

      </CardContent>
      {!readOnly && (
        <div className="sticky bottom-4 z-20 flex justify-end px-6 pb-6">
          <div className="flex items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="text-xs text-muted-foreground">Changes apply across all portals and automation rules.</p>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
