"use client";

/**
 * Estate profile & security kit — shared by the v2 laundry and QA profile pages
 * (both are /v2 worker portals, so this lives under a v2 subdir and is imported
 * by qa/profile too). Zero dependency on the live components/{admin,profile,
 * account,ui}/* — everything is Estate-token styled and hits the SAME endpoints
 * the v1 profile sections use:
 *   PATCH /api/me/profile      { name, phone, address, suburb, state, postcode,
 *                                bankAccountName, bankBsb, bankAccountNumber, abn }
 *   POST  /api/me/preferences  { invoicingCadence, invoiceDayOfWeek,
 *                                invoiceDayOfMonth, preferredPayoutMethod,
 *                                uiDensity, themePreference }
 *   POST  /api/me/password     { currentPassword, newPassword }
 *   GET/POST/PUT/DELETE /api/auth/2fa/settings
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bike,
  Car,
  Footprints,
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  TramFront,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

export interface EstateProfileUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  image: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  bankAccountName?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  abn?: string | null;
}

type Cadence = "ON_COMPLETION" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";
type Density = "COMPACT" | "DEFAULT" | "COMFORTABLE";
type Theme = "LIGHT" | "DARK" | "SYSTEM";
type PayoutMethod = "STRIPE_CONNECT" | "ABA_FILE" | "MANUAL_BANK_TRANSFER" | "PAYPAL";
type TransportMode = "DRIVING" | "WALKING" | "TRANSIT" | "BICYCLING";

const TRANSPORT_OPTIONS: { value: TransportMode; label: string; Icon: typeof Car }[] = [
  { value: "DRIVING", label: "Car", Icon: Car },
  { value: "WALKING", label: "Walk", Icon: Footprints },
  { value: "TRANSIT", label: "Public transport", Icon: TramFront },
  { value: "BICYCLING", label: "Bike", Icon: Bike },
];

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ── Contact & identity (PATCH /api/me/profile) ────────────────────────── */
function ContactSection({ user, locked }: { user: EstateProfileUser; locked: boolean }) {
  const router = useRouter();
  const [name, setName] = React.useState(user.name ?? "");
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [address, setAddress] = React.useState(user.address ?? "");
  const [suburb, setSuburb] = React.useState(user.suburb ?? "");
  const [stateVal, setStateVal] = React.useState(user.state ?? "");
  const [postcode, setPostcode] = React.useState(user.postcode ?? "");
  const [saving, setSaving] = React.useState(false);

  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
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
      toast({ title: "Profile saved" });
      router.refresh();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const initials = (name || user.email).slice(0, 2).toUpperCase();

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Contact details</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Auto-saves when you leave a field.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-5">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[0.9375rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-gold-ink))]">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </span>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Your avatar is set during onboarding and shown across dashboards.
          </p>
        </div>

        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Full name">
              <EInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== (user.name ?? "") && void patch({ name })}
              />
            </EField>
            <EField label="Email" hint="Contact an admin to change your email.">
              <EInput value={user.email} readOnly disabled />
            </EField>
            <EField label="Mobile">
              <EInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => phone !== (user.phone ?? "") && void patch({ phone })}
              />
            </EField>
          </div>

          <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
            <span className="e-eyebrow">HOME ADDRESS</span>
            <EField label="Address">
              <EInput
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => address !== (user.address ?? "") && void patch({ address })}
                placeholder="Street address"
              />
            </EField>
            <div className="grid gap-4 sm:grid-cols-3">
              <EField label="Suburb">
                <EInput
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                  onBlur={() => suburb !== (user.suburb ?? "") && void patch({ suburb })}
                />
              </EField>
              <EField label="State">
                <EInput
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  onBlur={() => stateVal !== (user.state ?? "") && void patch({ state: stateVal })}
                />
              </EField>
              <EField label="Postcode">
                <EInput
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  onBlur={() => postcode !== (user.postcode ?? "") && void patch({ postcode })}
                />
              </EField>
            </div>
          </div>
        </fieldset>
        {saving ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]" aria-live="polite">
            Saving…
          </p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Banking (laundry only, PATCH /api/me/profile) ─────────────────────── */
function BankingSection({ user, locked }: { user: EstateProfileUser; locked: boolean }) {
  const router = useRouter();
  const [bankAccountName, setBankAccountName] = React.useState(user.bankAccountName ?? "");
  const [bankBsb, setBankBsb] = React.useState(user.bankBsb ?? "");
  const [bankAccountNumber, setBankAccountNumber] = React.useState(user.bankAccountNumber ?? "");
  const [abn, setAbn] = React.useState(user.abn ?? "");

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not save", description: body.error, variant: "destructive" });
      return;
    }
    toast({ title: "Banking details saved" });
    router.refresh();
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Banking & invoicing</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Where remittances are paid. Auto-saves on blur.
        </p>
      </ECardHeader>
      <ECardBody>
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <EField label="Account name">
            <EInput
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              onBlur={() =>
                bankAccountName !== (user.bankAccountName ?? "") && void patch({ bankAccountName })
              }
            />
          </EField>
          <EField label="ABN">
            <EInput
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              onBlur={() => abn !== (user.abn ?? "") && void patch({ abn })}
            />
          </EField>
          <EField label="BSB">
            <EInput
              value={bankBsb}
              onChange={(e) => setBankBsb(e.target.value)}
              onBlur={() => bankBsb !== (user.bankBsb ?? "") && void patch({ bankBsb })}
            />
          </EField>
          <EField label="Account number">
            <EInput
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              onBlur={() =>
                bankAccountNumber !== (user.bankAccountNumber ?? "") &&
                void patch({ bankAccountNumber })
              }
            />
          </EField>
        </fieldset>
      </ECardBody>
    </ECard>
  );
}

/* ── Preferences (POST /api/me/preferences) ────────────────────────────── */
function PreferencesSection({
  initialCadence = "ON_COMPLETION",
  initialDayOfWeek = null,
  initialDayOfMonth = null,
  initialDensity = "DEFAULT",
  initialTheme = "SYSTEM",
  initialPayout,
  showPayout = false,
}: {
  initialCadence?: Cadence;
  initialDayOfWeek?: number | null;
  initialDayOfMonth?: number | null;
  initialDensity?: Density;
  initialTheme?: Theme;
  initialPayout?: PayoutMethod;
  showPayout?: boolean;
}) {
  const router = useRouter();
  const [cadence, setCadence] = React.useState<Cadence>(initialCadence);
  const [dayOfWeek, setDayOfWeek] = React.useState<number | null>(initialDayOfWeek);
  const [dayOfMonth, setDayOfMonth] = React.useState<number | null>(initialDayOfMonth);
  const [density, setDensity] = React.useState<Density>(initialDensity);
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [payout, setPayout] = React.useState<PayoutMethod | "">(initialPayout ?? "");
  const [saving, setSaving] = React.useState(false);

  async function save(payload: Record<string, unknown>, applyTheme?: Theme) {
    setSaving(true);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (applyTheme) {
        const resolved =
          applyTheme === "SYSTEM"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "DARK"
              : "LIGHT"
            : applyTheme;
        document.documentElement.classList.toggle("dark", resolved === "DARK");
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Preferences</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Billing cadence and how the dashboard looks for you.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Invoicing cadence">
            <ESelect
              value={cadence}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value as Cadence;
                setCadence(v);
                void save({ invoicingCadence: v });
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
                disabled={saving}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setDayOfWeek(n);
                  void save({ invoiceDayOfWeek: n });
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
                disabled={saving}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setDayOfMonth(n);
                  void save({ invoiceDayOfMonth: n });
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

          {showPayout ? (
            <EField label="Preferred payout method">
              <ESelect
                value={payout}
                disabled={saving}
                onChange={(e) => {
                  const v = e.target.value as PayoutMethod;
                  setPayout(v);
                  void save({ preferredPayoutMethod: v });
                }}
              >
                <option value="" disabled>
                  Choose…
                </option>
                <option value="MANUAL_BANK_TRANSFER">Bank transfer</option>
                <option value="ABA_FILE">ABA file</option>
                <option value="STRIPE_CONNECT">Stripe Connect</option>
                <option value="PAYPAL">PayPal</option>
              </ESelect>
            </EField>
          ) : null}
        </div>

        <div className="grid gap-4 border-t border-[hsl(var(--e-border))] pt-4 sm:grid-cols-2">
          <EField label="Theme">
            <ESelect
              value={theme}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value as Theme;
                setTheme(v);
                void save({ themePreference: v }, v);
              }}
            >
              <option value="LIGHT">Light</option>
              <option value="DARK">Dark</option>
              <option value="SYSTEM">Match system</option>
            </ESelect>
          </EField>
          <EField label="Density">
            <ESelect
              value={density}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value as Density;
                setDensity(v);
                void save({ uiDensity: v });
              }}
            >
              <option value="COMPACT">Compact</option>
              <option value="DEFAULT">Default</option>
              <option value="COMFORTABLE">Comfortable</option>
            </ESelect>
          </EField>
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ── Transport (POST /api/me/preferences) ──────────────────────────────── */
function TransportSection({ initialTransport = "DRIVING" }: { initialTransport?: TransportMode }) {
  const router = useRouter();
  const [transport, setTransport] = React.useState<TransportMode>(initialTransport);
  const [saving, setSaving] = React.useState(false);

  async function select(value: TransportMode) {
    if (value === transport) return;
    const previous = transport;
    setTransport(value);
    setSaving(true);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredTransport: value }),
      });
      if (!res.ok) {
        setTransport(previous);
        const body = await res.json().catch(() => ({}));
        toast({ title: "Could not save", description: body.error, variant: "destructive" });
        return;
      }
      router.refresh();
    } catch (e: any) {
      setTransport(previous);
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>How you get to jobs</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          We use this to estimate your travel time between jobs.
        </p>
      </ECardHeader>
      <ECardBody>
        <div
          role="radiogroup"
          aria-label="How you get to jobs"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {TRANSPORT_OPTIONS.map(({ value, label, Icon }) => {
            const active = transport === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving}
                onClick={() => void select(value)}
                className={`flex flex-col items-center justify-center gap-2 rounded-[var(--e-radius)] border px-3 py-4 text-center transition disabled:opacity-60 ${
                  active
                    ? "border-[hsl(var(--e-border-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                    : "border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:border-[hsl(var(--e-border-gold)/0.5)] hover:bg-[hsl(var(--e-muted))]"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[0.8125rem] font-[550] leading-tight">{label}</span>
              </button>
            );
          })}
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ── Password (POST /api/me/password) ──────────────────────────────────── */
function PasswordSection() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (newPassword.length < 8) {
      toast({ title: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirm) {
      toast({ title: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not change password", description: body.error, variant: "destructive" });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      toast({ title: "Password changed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Password</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Changing your password signs out remembered devices.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4">
        <EField label="Current password">
          <EInput
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </EField>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="New password" hint="At least 8 characters.">
            <EInput
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </EField>
          <EField label="Confirm new password">
            <EInput
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </EField>
        </div>
        <div className="flex justify-end">
          <EButton
            variant="gold"
            size="sm"
            onClick={() => void submit()}
            disabled={saving || !currentPassword || !newPassword}
          >
            {saving ? "Updating…" : "Change password"}
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ── Two-step verification (GET/POST/PUT/DELETE /api/auth/2fa/settings) ── */
type TfaStatus = {
  enabled: boolean;
  method: "TOTP" | "EMAIL" | null;
  backupCodesRemaining: number;
  hasPassword: boolean;
  email: string | null;
};
type SetupState = { phase: "idle" } | { phase: "totp"; qr: string; secret: string } | { phase: "email" };

function TwoFactorSection() {
  const [status, setStatus] = React.useState<TfaStatus | null>(null);
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
      <ECardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {status?.enabled ? (
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--e-success))]" />
            ) : (
              <ShieldOff className="h-5 w-5 text-[hsl(var(--e-muted-foreground))]" />
            )}
            <ECardTitle>Two-step verification</ECardTitle>
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
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Add a second step at sign-in. Trusted devices skip it for 30 days.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4">
        {loading ? (
          <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading security settings…
          </p>
        ) : (
          <>
            {error ? <EAlert tone="danger">{error}</EAlert> : null}

            {backupCodes ? (
              <EAlert tone="warning" title="Save your backup codes">
                <p className="mb-2">
                  Each works once if you lose access to your{" "}
                  {status?.method === "EMAIL" ? "email" : "authenticator"}. They won&apos;t be shown
                  again.
                </p>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[0.875rem]">
                  {backupCodes.map((c) => (
                    <span
                      key={c}
                      className="rounded-[var(--e-radius-xs)] bg-[hsl(var(--e-surface))] px-2 py-1"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </EAlert>
            ) : null}

            {status?.enabled ? (
              <div className="space-y-3">
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  {status.backupCodesRemaining} backup code
                  {status.backupCodesRemaining === 1 ? "" : "s"} remaining.
                </p>
                {showDisable ? (
                  <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <EField label="Confirm your password to turn off 2FA">
                      <EInput
                        type="password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Account password"
                      />
                    </EField>
                    <div className="flex gap-2">
                      <EButton
                        variant="danger"
                        size="sm"
                        onClick={() => void disable()}
                        disabled={busy || !disablePassword}
                      >
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
                  className="flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-left transition hover:border-[hsl(var(--e-border-gold)/0.5)] hover:bg-[hsl(var(--e-muted))] disabled:opacity-60"
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
                  className="flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-left transition hover:border-[hsl(var(--e-border-gold)/0.5)] hover:bg-[hsl(var(--e-muted))] disabled:opacity-60"
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
                    <p className="text-[0.875rem]">
                      Scan this with your authenticator app, then enter the 6-digit code it shows.
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={setup.qr}
                      alt="2FA QR code"
                      className="h-44 w-44 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white p-2"
                    />
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Can&apos;t scan? Enter this key manually:{" "}
                      <code className="font-mono">{setup.secret}</code>
                    </p>
                  </div>
                ) : (
                  <p className="text-[0.875rem]">
                    We emailed a 6-digit code to {status?.email}. Enter it below to finish.
                  </p>
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
                    Verify &amp; turn on
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

/* ── Composed profile ──────────────────────────────────────────────────── */
export function EstateProfile({
  user,
  editingEnabled = true,
  showBanking = false,
  showPayout = false,
  initialCadence,
  initialDayOfWeek,
  initialDayOfMonth,
  initialDensity,
  initialTheme,
  initialPayout,
  initialTransport,
}: {
  user: EstateProfileUser;
  editingEnabled?: boolean;
  showBanking?: boolean;
  showPayout?: boolean;
  initialCadence?: Cadence;
  initialDayOfWeek?: number | null;
  initialDayOfMonth?: number | null;
  initialDensity?: Density;
  initialTheme?: Theme;
  initialPayout?: PayoutMethod;
  initialTransport?: TransportMode;
}) {
  const locked = !editingEnabled;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {locked ? (
        <EAlert tone="info" title="Profile editing is locked">
          An administrator has disabled edits to your contact details. Security settings below are
          still available.
        </EAlert>
      ) : null}
      <ContactSection user={user} locked={locked} />
      {showBanking ? <BankingSection user={user} locked={locked} /> : null}
      <PreferencesSection
        initialCadence={initialCadence}
        initialDayOfWeek={initialDayOfWeek}
        initialDayOfMonth={initialDayOfMonth}
        initialDensity={initialDensity}
        initialTheme={initialTheme}
        initialPayout={initialPayout}
        showPayout={showPayout}
      />
      <TransportSection initialTransport={initialTransport} />
      <PasswordSection />
      <TwoFactorSection />
    </div>
  );
}
