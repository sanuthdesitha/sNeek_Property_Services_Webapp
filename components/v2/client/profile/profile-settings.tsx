"use client";

/**
 * Estate profile & security (client) — same endpoints as the legacy
 * ClientProfileForm / ProfileSettings / TwoFactorSettings:
 *   PATCH /api/me/profile                              { name|phone|address|suburb|state|postcode }
 *   PATCH /api/me/client-notification-preferences      { ...comms }
 *   POST  /api/me/password                             { currentPassword, newPassword }
 *   POST  /api/me/preferences                          { themePreference | invoicingCadence | invoiceDayOf* }
 *   GET/POST/PUT/DELETE /api/auth/2fa/settings         (two-step verification)
 * Theme is applied live via the shared ThemeProvider hook (@/lib/theme/context).
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ShieldCheck, ShieldOff, Smartphone, Mail, Loader2 } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, EField, ESwitch } from "@/components/v2/admin/estate-kit";
import { EInlineNotice } from "@/components/v2/client/fields";
import { EAddressInput } from "@/components/v2/client/address-input";
import { useTheme, type ThemePreference } from "@/lib/theme/context";

/* ── Types ─────────────────────────────────────────────────────────────── */
export interface ProfileUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}
export interface CommsPref {
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
type Cadence = "ON_COMPLETION" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ── Card scaffold ─────────────────────────────────────────────────────── */
function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <ECard>
      <ECardBody className="space-y-4 p-6">
        <div>
          <EEyebrow>{eyebrow}</EEyebrow>
          <h2 className="e-display-sm mt-1">{title}</h2>
          {description ? (
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
          ) : null}
        </div>
        {children}
      </ECardBody>
    </ECard>
  );
}

/* ── Toggle row ────────────────────────────────────────────────────────── */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <span className="text-[0.875rem]">{label}</span>
      <ESwitch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ── Contact + comms + billing form ────────────────────────────────────── */
function ContactForm({
  user,
  comms,
  properties,
  billing,
  editingEnabled,
}: {
  user: ProfileUser;
  comms: CommsPref;
  properties: PropertySummary[];
  billing: { cadence: Cadence; dayOfWeek: number | null; dayOfMonth: number | null };
  editingEnabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [name, setName] = React.useState(user.name ?? "");
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [address, setAddress] = React.useState(user.address ?? "");
  const [suburb, setSuburb] = React.useState(user.suburb ?? "");
  const [stateVal, setStateVal] = React.useState(user.state ?? "");
  const [postcode, setPostcode] = React.useState(user.postcode ?? "");
  const [pref, setPref] = React.useState<CommsPref>(comms);

  const [cadence, setCadence] = React.useState<Cadence>(billing.cadence);
  const [dayOfWeek, setDayOfWeek] = React.useState<number | null>(billing.dayOfWeek);
  const [dayOfMonth, setDayOfMonth] = React.useState<number | null>(billing.dayOfMonth);

  const locked = !editingEnabled;

  function flashSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

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
    flashSaved();
    router.refresh();
  }

  async function patchComms(updates: Partial<CommsPref>) {
    setError(null);
    setPref((prev) => ({ ...prev, ...updates }));
    const res = await fetch("/api/me/client-notification-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || `Save failed (${res.status})`);
    } else {
      flashSaved();
    }
  }

  async function saveBilling(payload: {
    invoicingCadence?: Cadence;
    invoiceDayOfWeek?: number | null;
    invoiceDayOfMonth?: number | null;
  }) {
    await fetch("/api/me/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    flashSaved();
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {locked ? (
        <EInlineNotice tone="info">
          Profile editing is currently locked for your account. Contact your account manager to make changes.
        </EInlineNotice>
      ) : null}
      {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
      {saved && !error ? <EInlineNotice tone="success">Saved.</EInlineNotice> : null}

      <fieldset disabled={locked} className="space-y-6">
        <SectionCard eyebrow="Account" title="Your details" description="Auto-saves when you leave a field.">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name">
              <EInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== (user.name ?? "") && patchProfile({ name })}
              />
            </EField>
            <EField label="Email" hint="Contact admin to change your email.">
              <EInput value={user.email} readOnly disabled />
            </EField>
            <EField label="Mobile">
              <EInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => phone !== (user.phone ?? "") && patchProfile({ phone })}
              />
            </EField>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Billing" title="Billing address" description="Used on your invoices.">
          <div className="space-y-4">
            <EField label="Address" hint="Search to autocomplete — suburb, state, and postcode fill in automatically.">
              <EAddressInput
                id="billing-address"
                value={address}
                onChange={setAddress}
                onResolved={(parts) => {
                  const nextAddress = parts.formattedAddress || parts.address || address;
                  setAddress(nextAddress);
                  setSuburb(parts.suburb ?? "");
                  setStateVal(parts.state ?? "");
                  setPostcode(parts.postcode ?? "");
                  patchProfile({
                    address: nextAddress,
                    suburb: parts.suburb ?? "",
                    state: parts.state ?? "",
                    postcode: parts.postcode ?? "",
                    placeId: parts.placeId,
                    latitude: parts.lat,
                    longitude: parts.lng,
                  });
                }}
                placeholder="Start typing your address…"
                disabled={locked}
              />
            </EField>
            <div className="grid gap-4 sm:grid-cols-3">
              <EField label="Suburb">
                <EInput
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                  onBlur={() => suburb !== (user.suburb ?? "") && patchProfile({ suburb })}
                />
              </EField>
              <EField label="State">
                <EInput
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  onBlur={() => stateVal !== (user.state ?? "") && patchProfile({ state: stateVal })}
                />
              </EField>
              <EField label="Postcode">
                <EInput
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  onBlur={() => postcode !== (user.postcode ?? "") && patchProfile({ postcode })}
                />
              </EField>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Homes" title="Your properties" description={`${properties.length} on file.`}>
          {properties.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No properties yet.</p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {properties.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[0.875rem] font-[550]">{p.name}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {p.address}, {p.suburb}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/v2/client/properties/${p.id}`}
                    className="text-[0.8125rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard eyebrow="Communication" title="Notification preferences" description="How and when we contact you about jobs.">
          <div className="space-y-4">
            <EField label="Preferred channel">
              <ESelect
                value={pref.preferredChannel}
                onChange={(e) => patchComms({ preferredChannel: e.target.value as CommsPref["preferredChannel"] })}
              >
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="BOTH">Both</option>
              </ESelect>
            </EField>
            <div className="space-y-3">
              <ToggleRow label="Notifications overall" checked={pref.notificationsEnabled} onChange={(v) => patchComms({ notificationsEnabled: v })} />
              <ToggleRow label="When the cleaner is en route" checked={pref.notifyOnEnRoute} onChange={(v) => patchComms({ notifyOnEnRoute: v })} />
              <ToggleRow label="When a job starts" checked={pref.notifyOnJobStart} onChange={(v) => patchComms({ notifyOnJobStart: v })} />
              <ToggleRow label="When a job completes" checked={pref.notifyOnJobComplete} onChange={(v) => patchComms({ notifyOnJobComplete: v })} />
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Billing" title="Invoice preferences" description="How and when you want invoices issued.">
          <div className="space-y-4">
            <EField label="Cadence">
              <ESelect
                value={cadence}
                onChange={(e) => {
                  const v = e.target.value as Cadence;
                  setCadence(v);
                  void saveBilling({ invoicingCadence: v });
                }}
              >
                <option value="ON_COMPLETION">On job completion (default)</option>
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
              </ESelect>
            </EField>
            {cadence === "WEEKLY" || cadence === "FORTNIGHTLY" ? (
              <EField label="Day of week">
                <ESelect
                  value={(dayOfWeek ?? 1).toString()}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setDayOfWeek(n);
                    void saveBilling({ invoiceDayOfWeek: n });
                  }}
                >
                  {DAYS_OF_WEEK.map((d, i) => (
                    <option key={d} value={i.toString()}>
                      {d}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
            {cadence === "MONTHLY" ? (
              <EField label="Day of month">
                <ESelect
                  value={(dayOfMonth ?? 1).toString()}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setDayOfMonth(n);
                    void saveBilling({ invoiceDayOfMonth: n });
                  }}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n.toString()}>
                      {n}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
          </div>
        </SectionCard>
      </fieldset>
    </div>
  );
}

/* ── Appearance (theme) ────────────────────────────────────────────────── */
function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  const [saving, setSaving] = React.useState(false);

  async function choose(next: ThemePreference) {
    setPreference(next); // live apply via ThemeProvider
    setSaving(true);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themePreference: next.toUpperCase() }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard eyebrow="Appearance" title="Theme" description="Choose how your dashboard looks.">
      <EField label="Theme">
        <ESelect value={preference} onChange={(e) => void choose(e.target.value as ThemePreference)} disabled={saving}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">Match system</option>
        </ESelect>
      </EField>
    </SectionCard>
  );
}

/* ── Password change ───────────────────────────────────────────────────── */
function PasswordCard() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function submit() {
    setError(null);
    setDone(false);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not change password.");
        return;
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard eyebrow="Security" title="Change password" description="Trusted devices are signed out when your password changes.">
      <div className="grid gap-3 sm:max-w-md">
        <EField label="Current password">
          <EInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </EField>
        <EField label="New password" hint="At least 8 characters.">
          <EInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </EField>
        <EField label="Confirm new password">
          <EInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </EField>
        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
        {done ? <EInlineNotice tone="success">Password updated.</EInlineNotice> : null}
        <div>
          <EButton size="sm" onClick={() => void submit()} disabled={busy || !current || !next || !confirm}>
            {busy ? "Updating…" : "Update password"}
          </EButton>
        </div>
      </div>
    </SectionCard>
  );
}

/* ── Two-factor ────────────────────────────────────────────────────────── */
type TwoFAStatus = {
  enabled: boolean;
  method: "TOTP" | "EMAIL" | null;
  backupCodesRemaining: number;
  hasPassword: boolean;
  email: string | null;
};
type SetupState = { phase: "idle" } | { phase: "totp"; qr: string; secret: string } | { phase: "email" };

function TwoFactorCard() {
  const [status, setStatus] = React.useState<TwoFAStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [setup, setSetup] = React.useState<SetupState>({ phase: "idle" });
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = React.useState("");
  const [showDisable, setShowDisable] = React.useState(false);

  React.useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/settings");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function startSetup(method: "TOTP" | "EMAIL") {
    setBusy(true);
    setError(null);
    setBackupCodes(null);
    setCode("");
    try {
      const res = await fetch("/api/auth/2fa/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not start setup.");
        return;
      }
      if (method === "TOTP") setSetup({ phase: "totp", qr: body.qr, secret: body.secret });
      else setSetup({ phase: "email" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    if (setup.phase === "idle") return;
    setBusy(true);
    setError(null);
    try {
      const method = setup.phase === "totp" ? "TOTP" : "EMAIL";
      const res = await fetch("/api/auth/2fa/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "That code didn't work.");
        return;
      }
      setBackupCodes(body.backupCodes || []);
      setSetup({ phase: "idle" });
      setCode("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/2fa/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not disable.");
        return;
      }
      setShowDisable(false);
      setDisablePassword("");
      setBackupCodes(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {status?.enabled ? (
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--e-success))]" />
            ) : (
              <ShieldOff className="h-5 w-5 text-[hsl(var(--e-muted-foreground))]" />
            )}
            <div>
              <EEyebrow>Security</EEyebrow>
              <h2 className="e-display-sm">Two-step verification</h2>
            </div>
          </div>
          {status?.enabled ? (
            <EBadge tone="success" soft>
              On · {status.method === "TOTP" ? "Authenticator" : "Email"}
            </EBadge>
          ) : (
            <EBadge tone="neutral" soft>
              Off
            </EBadge>
          )}
        </div>
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Add a second step at sign-in. You won&apos;t be asked on devices you trust for 30 days.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading security settings…
          </div>
        ) : (
          <>
            {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

            {backupCodes ? (
              <div
                className="rounded-[var(--e-radius-lg)] border-l-[3px] p-3"
                style={{ backgroundColor: "hsl(var(--e-warning-soft))", borderColor: "hsl(var(--e-warning))" }}
              >
                <p className="text-[0.875rem] font-[550]">Save your backup codes</p>
                <p className="mb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Each works once if you lose access to your {status?.method === "EMAIL" ? "email" : "authenticator"}. They
                  won&apos;t be shown again.
                </p>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[0.875rem]">
                  {backupCodes.map((c) => (
                    <span key={c} className="rounded bg-[hsl(var(--e-surface))] px-2 py-1">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {status?.enabled ? (
              <div className="space-y-3">
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? "" : "s"} remaining.
                </p>
                {showDisable ? (
                  <div className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
                    <EField label="Confirm your password to turn off 2FA">
                      <EInput
                        type="password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Account password"
                      />
                    </EField>
                    <div className="flex gap-2">
                      <EButton variant="danger" size="sm" onClick={() => void disable()} disabled={busy || !disablePassword}>
                        Turn off 2FA
                      </EButton>
                      <EButton
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowDisable(false);
                          setDisablePassword("");
                        }}
                      >
                        Cancel
                      </EButton>
                    </div>
                  </div>
                ) : (
                  <EButton variant="outline" size="sm" onClick={() => setShowDisable(true)}>
                    Turn off two-step verification
                  </EButton>
                )}
              </div>
            ) : setup.phase === "idle" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => void startSetup("TOTP")}
                  disabled={busy}
                  className="flex items-start gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 text-left transition-colors hover:border-[hsl(var(--e-border-gold)/0.5)] hover:bg-[hsl(var(--e-muted))] disabled:opacity-60"
                >
                  <Smartphone className="mt-0.5 h-5 w-5 text-[hsl(var(--e-accent-portal))]" />
                  <div>
                    <p className="text-[0.875rem] font-[550]">Authenticator app</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Google Authenticator, Authy, 1Password. No SMS needed.
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => void startSetup("EMAIL")}
                  disabled={busy}
                  className="flex items-start gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3 text-left transition-colors hover:border-[hsl(var(--e-border-gold)/0.5)] hover:bg-[hsl(var(--e-muted))] disabled:opacity-60"
                >
                  <Mail className="mt-0.5 h-5 w-5 text-[hsl(var(--e-accent-portal))]" />
                  <div>
                    <p className="text-[0.875rem] font-[550]">Email code</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      We email a 6-digit code at sign-in to {status?.email || "your address"}.
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {setup.phase === "totp" ? (
                  <div className="space-y-2">
                    <p className="text-[0.875rem]">Scan this with your authenticator app, then enter the 6-digit code.</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={setup.qr} alt="2FA QR code" className="h-44 w-44 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-white p-2" />
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Can&apos;t scan? Enter this key manually: <code className="font-mono">{setup.secret}</code>
                    </p>
                  </div>
                ) : (
                  <p className="text-[0.875rem]">We emailed a 6-digit code to {status?.email}. Enter it below to finish.</p>
                )}
                <EField label="Verification code">
                  <EInput
                    inputMode="numeric"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="max-w-[200px]"
                  />
                </EField>
                <div className="flex gap-2">
                  <EButton size="sm" onClick={() => void confirmSetup()} disabled={busy || !code}>
                    Verify & turn on
                  </EButton>
                  <EButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSetup({ phase: "idle" });
                      setCode("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </EButton>
                </div>
              </div>
            )}
          </>
        )}
      </ECardBody>
    </ECard>
  );
}

/* ── Root ──────────────────────────────────────────────────────────────── */
export function ProfileSettings({
  user,
  comms,
  properties,
  billing,
  editingEnabled,
}: {
  user: ProfileUser;
  comms: CommsPref;
  properties: PropertySummary[];
  billing: { cadence: Cadence; dayOfWeek: number | null; dayOfMonth: number | null };
  editingEnabled: boolean;
}) {
  return (
    <div className="space-y-6">
      <ContactForm user={user} comms={comms} properties={properties} billing={billing} editingEnabled={editingEnabled} />
      <TwoFactorCard />
      <PasswordCard />
      <AppearanceCard />
    </div>
  );
}
