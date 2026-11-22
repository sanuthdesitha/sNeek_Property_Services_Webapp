"use client";

/**
 * Your profile cards that edit plain account settings: details, look and feel,
 * password, notifications to you and your sending choices. Each card saves on
 * its own through the existing self-service endpoints (/api/me/*), only for the
 * signed-in person; fields freeze while saving and a failed save keeps what was
 * typed (except passwords after a refusal).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { PROFILE_HINT, PROFILE_INPUT, PROFILE_LABEL, ProfileCard, ProfileMessage, type CardState } from "./profile-card";
import { PERSONAL_SWITCHES_CHANGED_EVENT, PersonalSwitchesPanel } from "@/components/v2/notifications/personal-switches-panel";

type Message = { tone: "ok" | "error"; text: string } | null;

export type ProfileDetails = {
  name: string;
  email: string;
  phone: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
};

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

/* ── Details ─────────────────────────────────────────────────────────────── */

export function DetailsCard({ initial, readOnlyReason }: { initial: ProfileDetails; readOnlyReason: string | null }) {
  const router = useRouter();
  const id = React.useId();
  const [form, setForm] = React.useState<ProfileDetails>(initial);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);
  const dirty = (Object.keys(form) as Array<keyof ProfileDetails>).some((key) => form[key] !== initial[key]);

  function field(key: keyof ProfileDetails) {
    return {
      id: `${id}-${key}`,
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value })),
      className: PROFILE_INPUT,
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setMessage({ tone: "error", text: "Your name and email are needed." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          suburb: form.suburb.trim(),
          state: form.state.trim(),
          postcode: form.postcode.trim(),
        }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: `Your details were not saved: ${await readError(res, "try again.")}` });
        return;
      }
      setMessage({ tone: "ok", text: "Details saved." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Your details were not saved: the connection failed. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileCard id="details" title="Details">
      <form onSubmit={save}>
        <fieldset disabled={saving || Boolean(readOnlyReason)} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${id}-name`} className={PROFILE_LABEL}>Full name</label>
              <input {...field("name")} autoComplete="name" />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-phone`} className={PROFILE_LABEL}>Mobile</label>
              <input {...field("phone")} type="tel" autoComplete="tel" />
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-email`} className={PROFILE_LABEL}>Email</label>
            <input {...field("email")} type="email" autoComplete="email" aria-describedby={`${id}-email-hint`} />
            <p id={`${id}-email-hint`} className={PROFILE_HINT}>Also the address you sign in with and where your email notices go.</p>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${id}-address`} className={PROFILE_LABEL}>Address</label>
            <input {...field("address")} autoComplete="street-address" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_7rem]">
            <div className="min-w-0">
              <label htmlFor={`${id}-suburb`} className={PROFILE_LABEL}>Suburb</label>
              <input {...field("suburb")} autoComplete="address-level2" />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-state`} className={PROFILE_LABEL}>State</label>
              <input {...field("state")} autoComplete="address-level1" />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-postcode`} className={PROFILE_LABEL}>Postcode</label>
              <input {...field("postcode")} inputMode="numeric" autoComplete="postal-code" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <EButton type="submit" size="sm" disabled={!dirty}>{saving ? "Saving…" : "Save details"}</EButton>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No banking here: office accounts are not paid through the app.</span>
          </div>
          <ProfileMessage message={message} />
        </fieldset>
      </form>
    </ProfileCard>
  );
}

/* ── Look and feel ───────────────────────────────────────────────────────── */

export type ThemeChoice = "LIGHT" | "DARK" | "SYSTEM";
export type DensityChoice = "COMFORTABLE" | "DEFAULT" | "COMPACT";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: "LIGHT", label: "Light" },
  { value: "DARK", label: "Dark" },
  { value: "SYSTEM", label: "Match system" },
];
const DENSITY_OPTIONS: Array<{ value: DensityChoice; label: string }> = [
  { value: "COMFORTABLE", label: "Comfortable" },
  { value: "DEFAULT", label: "Default" },
  { value: "COMPACT", label: "Compact" },
];

function applyTheme(theme: ThemeChoice) {
  const dark = theme === "DARK" || (theme === "SYSTEM" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function Segmented<T extends string>({ label, value, options, disabled, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-9 rounded-[calc(var(--e-radius)-2px)] px-3 text-[0.8125rem] max-sm:min-h-11",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-60",
              checked ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function LookAndFeelCard({ initialTheme, initialDensity, readOnlyReason }: { initialTheme: ThemeChoice; initialDensity: DensityChoice; readOnlyReason: string | null }) {
  const router = useRouter();
  const [theme, setTheme] = React.useState<ThemeChoice>(initialTheme);
  const [density, setDensity] = React.useState<DensityChoice>(initialDensity);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);

  async function save(next: { themePreference?: ThemeChoice; uiDensity?: DensityChoice }, undo: () => void) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) {
        undo();
        setMessage({ tone: "error", text: `Not saved: ${await readError(res, "try again.")}` });
        return;
      }
      setMessage({ tone: "ok", text: "Saved." });
      router.refresh();
    } catch {
      undo();
      setMessage({ tone: "error", text: "Not saved: the connection failed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileCard id="look" title="Look and feel" state={{ text: "this account, every device", shape: "none" }}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[0.8125rem] font-[550]">Theme</span>
          <Segmented
            label="Theme"
            value={theme}
            options={THEME_OPTIONS}
            disabled={saving || Boolean(readOnlyReason)}
            onChange={(value) => {
              const previous = theme;
              setTheme(value);
              applyTheme(value);
              void save({ themePreference: value }, () => { setTheme(previous); applyTheme(previous); });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[0.8125rem] font-[550]">Density</span>
          <Segmented
            label="Density"
            value={density}
            options={DENSITY_OPTIONS}
            disabled={saving || Boolean(readOnlyReason)}
            onChange={(value) => {
              const previous = density;
              setDensity(value);
              void save({ uiDensity: value }, () => setDensity(previous));
            }}
          />
        </div>
        <p className={PROFILE_HINT}>Applies straight away; saved when you pick.</p>
        <ProfileMessage message={message} />
      </div>
    </ProfileCard>
  );
}

/* ── Password ────────────────────────────────────────────────────────────── */

export function PasswordCard({ changedLabel, readOnlyReason }: { changedLabel: string | null; readOnlyReason: string | null }) {
  const id = React.useId();
  const [form, setForm] = React.useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<Message>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.next.length < 8) return setMessage({ tone: "error", text: "Use at least 8 characters." });
    if (form.next !== form.confirm) return setMessage({ tone: "error", text: "The new passwords do not match." });
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      if (!res.ok) {
        setForm((current) => ({ ...current, current: "" }));
        setMessage({ tone: "error", text: `Your password was not changed: ${await readError(res, "try again.")}` });
        return;
      }
      setForm({ current: "", next: "", confirm: "" });
      setMessage({ tone: "ok", text: "Password changed. Remembered devices will ask for two-step again." });
    } catch {
      setMessage({ tone: "error", text: "Your password was not changed: the connection failed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileCard id="password" title="Password" state={{ text: changedLabel ? `changed ${changedLabel}` : "change not recorded", shape: "none" }}>
      <form onSubmit={submit}>
        <fieldset disabled={saving || Boolean(readOnlyReason)} className="space-y-3">
          <div>
            <label htmlFor={`${id}-current`} className={PROFILE_LABEL}>Current password</label>
            <input id={`${id}-current`} type="password" autoComplete="current-password" className={PROFILE_INPUT} value={form.current} onChange={(event) => setForm((current) => ({ ...current, current: event.target.value }))} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${id}-next`} className={PROFILE_LABEL}>New password</label>
              <input id={`${id}-next`} type="password" autoComplete="new-password" placeholder="At least 8 characters" className={PROFILE_INPUT} value={form.next} onChange={(event) => setForm((current) => ({ ...current, next: event.target.value }))} />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${id}-confirm`} className={PROFILE_LABEL}>Confirm</label>
              <input id={`${id}-confirm`} type="password" autoComplete="new-password" placeholder="Same again" className={PROFILE_INPUT} value={form.confirm} onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <EButton type="submit" size="sm" disabled={!form.current || !form.next}>{saving ? "Changing…" : "Change password"}</EButton>
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Forgot it? Sign out and use &ldquo;Forgot password&rdquo;.</span>
          </div>
          <ProfileMessage message={message} />
        </fieldset>
      </form>
    </ProfileCard>
  );
}

/* ── Notifications to you ────────────────────────────────────────────────── */

export type NotificationCategoryInfo = { key: string; label: string; description: string };
type ChannelKey = "web" | "email" | "sms";
type Preferences = Record<string, Record<ChannelKey, boolean>>;
type NotificationsLoad =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "impersonating" }
  | { kind: "ready"; preferences: Preferences; hasPhone: boolean; phone: string | null };

const CHANNELS: Array<{ key: ChannelKey; label: string; short: string }> = [
  { key: "web", label: "Inbox and alerts", short: "Inbox" },
  { key: "email", label: "Email", short: "Email" },
  { key: "sms", label: "SMS", short: "SMS" },
];

export function NotificationsCard({ categories, readOnlyReason }: { categories: NotificationCategoryInfo[]; readOnlyReason: string | null }) {
  const [load, setLoad] = React.useState<NotificationsLoad>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<Message>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/me/notification-preferences", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body) return setLoad({ kind: "failed", message: typeof body?.error === "string" ? body.error : "Your notification switches could not be loaded." });
        if (body.impersonating) return setLoad({ kind: "impersonating" });
        setLoad({ kind: "ready", preferences: body.preferences as Preferences, hasPhone: Boolean(body.hasPhone), phone: body.phone ?? null });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "Your notification switches could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  async function toggle(category: string, channel: ChannelKey, value: boolean) {
    if (load.kind !== "ready") return;
    const key = `${category}:${channel}`;
    const previous = load.preferences;
    setSavingKey(key);
    setMessage(null);
    setLoad({ ...load, preferences: { ...previous, [category]: { ...previous[category], [channel]: value } } });
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [category]: { [channel]: value } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.preferences) {
        setLoad((current) => (current.kind === "ready" ? { ...current, preferences: previous } : current));
        setMessage({ tone: "error", text: `Not saved: ${typeof body?.error === "string" ? body.error : "try again."}` });
        return;
      }
      setLoad((current) => (current.kind === "ready" ? { ...current, preferences: body.preferences } : current));
      setMessage({ tone: "ok", text: "Saved." });
      window.dispatchEvent(new Event(PERSONAL_SWITCHES_CHANGED_EVENT));
    } catch {
      setLoad((current) => (current.kind === "ready" ? { ...current, preferences: previous } : current));
      setMessage({ tone: "error", text: "Not saved: the connection failed." });
    } finally {
      setSavingKey(null);
    }
  }

  const intro = "Each kind of notice and how it reaches you. The same switches as your panel in Notifications › People; changes there show here.";

  return (
    <ProfileCard id="notifications" title="Notifications to you">
      <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{intro}</p>
      {load.kind === "loading" ? (
        <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading your switches…</p>
      ) : load.kind === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          {load.message} Nothing is shown rather than a guess.
          <EButton variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
        </div>
      ) : load.kind === "impersonating" ? (
        <p className="text-[0.875rem]">{readOnlyReason ?? "Not shown while testing as someone else."}</p>
      ) : (
        <>
          {/* Desktop: one table. Phone: one card per kind with route chips. */}
          <div role="region" aria-label="Notification switches" className="overflow-x-auto max-sm:hidden">
            <table className="w-full min-w-[620px] text-left text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <th scope="col" className="py-2 pr-3 font-[550]">Kind of notice</th>
                  {CHANNELS.map((channel) => <th key={channel.key} scope="col" className="px-3 py-2 text-center font-[550]">{channel.label}</th>)}
                  <th scope="col" className="py-2 pl-3 font-[550]">What you get</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.key} className="border-b border-[hsl(var(--e-border))] last:border-0">
                    <th scope="row" className="py-2 pr-3 font-[550]">{category.label}</th>
                    {CHANNELS.map((channel) => {
                      const smsBlocked = channel.key === "sms" && !load.hasPhone;
                      return (
                        <td key={channel.key} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${category.label}: ${channel.label}`}
                            className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                            checked={Boolean(load.preferences[category.key]?.[channel.key])}
                            disabled={Boolean(readOnlyReason) || savingKey !== null || (smsBlocked && !load.preferences[category.key]?.sms)}
                            title={smsBlocked ? "Add a mobile number in Details first." : undefined}
                            onChange={(event) => void toggle(category.key, channel.key, event.target.checked)}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3 text-[hsl(var(--e-muted-foreground))]">{category.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2.5 sm:hidden">
            {categories.map((category) => (
              <li key={category.key} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.875rem] font-[600]">{category.label}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{category.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CHANNELS.map((channel) => {
                    const on = Boolean(load.preferences[category.key]?.[channel.key]);
                    const smsBlocked = channel.key === "sms" && !load.hasPhone && !on;
                    return (
                      <button
                        key={channel.key}
                        type="button"
                        aria-pressed={on}
                        disabled={Boolean(readOnlyReason) || savingKey !== null || smsBlocked}
                        onClick={() => void toggle(category.key, channel.key, !on)}
                        className={cn(
                          "min-h-11 rounded-full border px-4 text-[0.8125rem] disabled:opacity-60",
                          on ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))]",
                        )}
                      >
                        {on ? "✓ " : ""}{channel.short}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          <p className={cn(PROFILE_HINT, "mt-3")}>
            {load.hasPhone ? `Ticking SMS uses ${load.phone}. ` : "SMS is off until you add a mobile number in Details first. "}
            A ticked box means we try that route; each notice says if it was queued, handed over or failed.
          </p>
          <ProfileMessage message={message} />
        </>
      )}
      {/* Each notification, per transport, and the all/per-transport switches (lib/notifications/personal). */}
      <div className="mt-4 border-t border-[hsl(var(--e-border))] pt-4">
        <h3 className="mb-2 text-[0.9375rem] font-semibold">Each notification</h3>
        <PersonalSwitchesPanel source={{ kind: "self" }} framed={false} showTopics={false} />
      </div>
    </ProfileCard>
  );
}

/* ── Your sending choices ────────────────────────────────────────────────── */

type SavedChoice = { transports: string[]; savedAt: string };
type ChoicesLoad =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; readable: boolean; kinds: Record<string, SavedChoice>; impersonating: boolean };

const TRANSPORT_WORD: Record<string, string> = { INBOX: "Inbox", PUSH: "Phone alert", EMAIL: "Email", SMS: "SMS" };

export function SendingChoicesCard({ kindLabels, timeZone, readOnlyReason }: { kindLabels: Record<string, string>; timeZone: string; readOnlyReason: string | null }) {
  const [load, setLoad] = React.useState<ChoicesLoad>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [clearing, setClearing] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<Message>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/me/send-transports", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body) return setLoad({ kind: "failed", message: typeof body?.error === "string" ? body.error : "Your sending choices could not be loaded." });
        setLoad({ kind: "ready", readable: body.readable !== false, kinds: (body.kinds ?? {}) as Record<string, SavedChoice>, impersonating: Boolean(body.impersonating) });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "Your sending choices could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  async function askAgain(kind: string) {
    setClearing(kind);
    setMessage(null);
    try {
      const res = await fetch("/api/me/send-transports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setMessage({ tone: "error", text: `Not changed: ${typeof body?.error === "string" ? body.error : "try again."}` });
        return;
      }
      setLoad({ kind: "ready", readable: true, kinds: (body.kinds ?? {}) as Record<string, SavedChoice>, impersonating: false });
      setMessage({ tone: "ok", text: "The dialog will ask again next time." });
    } catch {
      setMessage({ tone: "error", text: "Not changed: the connection failed." });
    } finally {
      setClearing(null);
    }
  }

  const saved = load.kind === "ready" ? Object.entries(load.kinds) : [];
  const state: CardState | null = load.kind === "ready" && !load.impersonating ? { text: `${saved.length} saved`, shape: "none" } : null;

  return (
    <ProfileCard id="sending" title="Your sending choices" state={state}>
      <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Your &ldquo;Don&rsquo;t ask again&rdquo; answers. They also live in Notifications › Preferences.</p>
      {load.kind === "loading" ? (
        <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
      ) : load.kind === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          {load.message}
          <EButton variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
        </div>
      ) : load.impersonating ? (
        <p className="text-[0.875rem]">{readOnlyReason ?? "Not shown while testing as someone else."}</p>
      ) : !load.readable ? (
        <p role="alert" className="text-[0.875rem]">Your saved choices could not be read, so every dialog asks again.</p>
      ) : saved.length === 0 ? (
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No saved answers: every dialog asks which routes to use.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {saved.map(([kind, choice]) => (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-[550]">{kindLabels[kind] ?? kind}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {choice.transports.map((transport) => TRANSPORT_WORD[transport] ?? transport).join(", ")} · saved {formatDay(choice.savedAt, timeZone)}
                </span>
              </span>
              <EButton variant="outline" size="sm" disabled={Boolean(readOnlyReason) || clearing !== null} onClick={() => void askAgain(kind)}>
                {clearing === kind ? "Changing…" : "Ask me again"}
              </EButton>
            </li>
          ))}
        </ul>
      )}
      <ProfileMessage message={message} />
    </ProfileCard>
  );
}

function formatDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
