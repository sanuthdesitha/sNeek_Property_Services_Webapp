"use client";

/**
 * ESTATE staff accounts manager — v2-native replacement for the v1
 * UsersManager. Same API surface, new Estate UI:
 *   list           → GET    /api/admin/users?includeInactive=1[&role=X]
 *   clients        → GET    /api/admin/clients          (for CLIENT linking)
 *   create         → POST   /api/admin/users            { name, email, phone?, role, invite, password?, clientId? }
 *   edit fields    → PATCH  /api/admin/users/[id]       { name, email, phone, role, isActive, clientId? }
 *   resend invite  → POST   /api/admin/users/[id]/resend-otp
 *   toggle active  → PATCH  /api/admin/users/[id]       { isActive }
 *   reset password → POST   /api/admin/users/[id]/reset-password { security }
 *   reset 2FA      → POST   /api/admin/users/[id]/disable-2fa    { security }
 *   delete         → DELETE /api/admin/users/[id]       { security: { pin?, password? } }
 *   edit override  → PATCH  /api/admin/users            { userId, profileEditOverride }
 *   availability   → GET    /api/admin/cleaners/availability (roster summary line)
 *   role defaults  → GET    /api/admin/settings          (profileEditPolicy, read-only here)
 * Ported from v1 UsersManager: per-user profile-edit overrides, ABN + bank
 * details at creation, and the cleaner availability summary. Full extended
 * profile EDITS still live on the account page (Payroll & identity card).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart2,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
  UserCog,
  UserRoundPlus,
  UserX,
  Shield,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EAvatar,
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
} from "@/components/v2/admin/estate-kit";

type AccountRole = "ADMIN" | "OPS_MANAGER" | "QA_INSPECTOR" | "CLEANER" | "CLIENT" | "LAUNDRY";

const MANAGED_ROLES: AccountRole[] = [
  "ADMIN",
  "OPS_MANAGER",
  "QA_INSPECTOR",
  "CLEANER",
  "CLIENT",
  "LAUNDRY",
];

const ROLE_TONE: Record<AccountRole, "gold" | "primary" | "info" | "success" | "neutral" | "aubergine"> = {
  ADMIN: "gold",
  OPS_MANAGER: "primary",
  QA_INSPECTOR: "aubergine",
  CLEANER: "success",
  CLIENT: "info",
  LAUNDRY: "neutral",
};

/**
 * Per-field self-service profile edit rights. The server stores these either
 * as a role-level default (settings.profileEditPolicy) or as a whole-object
 * per-user override (settings.profileEditOverrides[userId]). An override
 * replaces the role default entirely — it is all-or-nothing, never per-field —
 * and null/absent means "inherit the role default", which is why the UI pairs
 * one enable switch with three field switches instead of tri-state controls.
 */
interface ProfileEditPolicy {
  canEditName: boolean;
  canEditPhone: boolean;
  canEditEmail: boolean;
}

interface UserItem {
  id: string;
  name: string | null;
  email: string;
  role: AccountRole;
  phone: string | null;
  isActive: boolean;
  emailVerified?: string | null;
  clientId?: string | null;
  client?: { id: string; name: string } | null;
  profileEditOverride?: ProfileEditPolicy | null;
}

interface ClientItem {
  id: string;
  name: string;
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ");
}

export function EstateStaffManager({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const [busyUserId, setBusyUserId] = useState("");

  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "CLEANER" as AccountRole,
    clientId: "",
    isActive: true,
  });
  const [saving, setSaving] = useState(false);

  // Role-level profile-edit defaults (read-only here — edited in Settings).
  // Shown so admins can see what "inherit" resolves to before overriding.
  const [rolePolicyDefaults, setRolePolicyDefaults] = useState<Record<string, ProfileEditPolicy>>({});
  // Per-user override editing state. `overrideEnabled` mirrors whether the
  // server stores an override object (vs null = inherit the role default).
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideForm, setOverrideForm] = useState<ProfileEditPolicy>({
    canEditName: true,
    canEditPhone: true,
    canEditEmail: false,
  });
  // Snapshot of the override as loaded, so save can skip the ADMIN-only
  // collection PATCH when nothing changed (see saveEdit for why that matters).
  const [initialOverride, setInitialOverride] = useState<ProfileEditPolicy | null>(null);

  // Cleaner id → compact availability summary for the roster line.
  const [availabilityByCleaner, setAvailabilityByCleaner] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserItem | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reset2faTarget, setReset2faTarget] = useState<UserItem | null>(null);
  const [resetting2fa, setResetting2fa] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<"invite" | "password">("invite");
  // ABN + bank details are captured at creation (v1 parity) so payroll-ready
  // accounts don't need a second trip to the extended-profile editor. All
  // optional — blank values are dropped by the API's blank-to-undefined zod
  // preprocessing.
  const EMPTY_CREATE_FORM = {
    name: "",
    email: "",
    phone: "",
    role: "CLEANER" as AccountRole,
    clientId: "",
    password: "",
    abn: "",
    bankAccountName: "",
    bankName: "",
    bankBsb: "",
    bankAccountNumber: "",
  };
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createdInvitation, setCreatedInvitation] = useState<{ email: string; link: string; emailSent: boolean } | null>(null);

  const loadUsers = useCallback(async (filter: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("includeInactive", "1");
      if (filter !== "all") params.set("role", filter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setUsers(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers(roleFilter);
  }, [roleFilter, loadUsers]);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((res) => res.json())
      .then((body) => setClients(Array.isArray(body) ? body : []))
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    // Same source the Settings page reads; only profileEditPolicy is used.
    // A failed load is non-fatal — the modal falls back to a safe default.
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.profileEditPolicy) setRolePolicyDefaults(body.profileEditPolicy);
      })
      .catch(() => {});
  }, []);

  const loadCleanerAvailability = useCallback(async () => {
    // Summary only — full availability editing lives on the cleaner's page.
    // Failures are swallowed: the roster must still render without the line.
    try {
      const res = await fetch("/api/admin/cleaners/availability", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(body)) return;
      const map: Record<string, string> = {};
      for (const row of body) {
        const weeklyDays = Object.keys(row?.availability?.weekly ?? {}).length;
        const overrides = Object.keys(row?.availability?.dateOverrides ?? {}).length;
        const mode = row?.availability?.mode === "FLEXIBLE" ? "Flexible" : "Fixed";
        map[row.id] =
          `${mode} · ${weeklyDays} weekly day${weeklyDays === 1 ? "" : "s"}` +
          (overrides > 0 ? ` · ${overrides} override${overrides === 1 ? "" : "s"}` : "");
      }
      setAvailabilityByCleaner(map);
    } catch {
      /* decorative line — ignore network failures */
    }
  }, []);

  useEffect(() => {
    void loadCleanerAvailability();
  }, [loadCleanerAvailability]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      `${u.name ?? ""} ${u.email} ${u.phone ?? ""}`.toLowerCase().includes(q)
    );
  }, [users, search]);

  function openEditor(user: UserItem) {
    setEditing(user);
    setForm({
      name: user.name ?? "",
      email: user.email,
      phone: user.phone ?? "",
      role: user.role,
      clientId: user.clientId ?? "",
      isActive: !!user.isActive,
    });
    const existingOverride = user.profileEditOverride ?? null;
    setInitialOverride(existingOverride);
    setOverrideEnabled(!!existingOverride);
    // Seed the switches from the role default when no override exists yet, so
    // enabling the override starts from what the user can already do today.
    setOverrideForm(
      existingOverride ??
        rolePolicyDefaults[user.role] ?? { canEditName: true, canEditPhone: true, canEditEmail: false }
    );
  }

  async function saveEdit() {
    if (!editing) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast({ title: "Name and email are required.", variant: "destructive" });
      return;
    }
    if (form.role === "CLIENT" && !form.clientId) {
      toast({ title: "Client role must be linked to a client profile.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          role: form.role,
          isActive: form.isActive,
          clientId: form.role === "CLIENT" ? form.clientId : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update account.");

      // Persist the per-user override only when it actually changed: the
      // collection PATCH is ADMIN-only (stricter than the field PATCH above),
      // so skipping no-op writes keeps plain field edits working for
      // OPS_MANAGERs and avoids rewriting the settings blob on every save.
      const desiredOverride = overrideEnabled ? overrideForm : null;
      if (JSON.stringify(desiredOverride) !== JSON.stringify(initialOverride)) {
        const overrideRes = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: editing.id, profileEditOverride: desiredOverride }),
        });
        const overrideBody = await overrideRes.json().catch(() => ({}));
        if (!overrideRes.ok) throw new Error(overrideBody.error ?? "Could not update profile permissions.");
      }

      toast({ title: "Account updated" });
      setEditing(null);
      await loadUsers(roleFilter);
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: UserItem) {
    setBusyUserId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update status.");
      toast({ title: user.isActive ? "Account disabled" : "Account activated" });
      await loadUsers(roleFilter);
    } catch (err: any) {
      toast({ title: "Status update failed", description: err.message, variant: "destructive" });
    } finally {
      setBusyUserId("");
    }
  }

  async function resendOtp(userId: string) {
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/resend-otp`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Try again.");
      toast({ title: "Invitation OTP sent" });
    } catch (err: any) {
      toast({ title: "Could not resend OTP", description: err.message, variant: "destructive" });
    } finally {
      setBusyUserId("");
    }
  }

  async function resetPassword(credentials?: { pin?: string; password?: string }) {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reset password.");
      if (body.warning && body.tempPassword) {
        toast({
          title: "Password reset, email failed",
          description: `Temporary password: ${body.tempPassword}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Temporary password sent", description: "The user received a reset email." });
      }
      setResetTarget(null);
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message ?? "Could not reset password.", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function reset2fa(credentials?: { pin?: string; password?: string }) {
    if (!reset2faTarget) return;
    setResetting2fa(true);
    try {
      const res = await fetch(`/api/admin/users/${reset2faTarget.id}/disable-2fa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reset 2FA.");
      toast({ title: "Two-step verification reset", description: "They can sign in with their password and set it up again." });
      setReset2faTarget(null);
      await loadUsers(roleFilter);
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message ?? "Could not reset 2FA.", variant: "destructive" });
    } finally {
      setResetting2fa(false);
    }
  }

  async function createUser() {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      toast({ title: "Name and email are required.", variant: "destructive" });
      return;
    }
    if (createMode === "password" && !createForm.password) {
      toast({ title: "Password is required in manual-password mode.", variant: "destructive" });
      return;
    }
    if (createForm.role === "CLIENT" && !createForm.clientId) {
      toast({ title: "Client accounts must be linked to a client profile.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      // Same role gating as v1: ABN is a business identifier (clients /
      // laundry contractors), bank details are payout rails (cleaners /
      // laundry). Blank strings are stripped server-side by zod preprocess.
      const wantsAbn = createForm.role === "CLIENT" || createForm.role === "LAUNDRY";
      const wantsBank = createForm.role === "CLEANER" || createForm.role === "LAUNDRY";
      const payload: Record<string, unknown> = {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        invite: createMode === "invite",
        role: createForm.role,
        phone: createForm.phone.trim() || undefined,
        clientId: createForm.role === "CLIENT" ? createForm.clientId : undefined,
        abn: wantsAbn ? createForm.abn.trim() || undefined : undefined,
        bankDetails: wantsBank
          ? {
              accountName: createForm.bankAccountName.trim(),
              bankName: createForm.bankName.trim(),
              bsb: createForm.bankBsb.trim(),
              accountNumber: createForm.bankAccountNumber.trim(),
            }
          : undefined,
      };
      if (createMode === "password") payload.password = createForm.password;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to create account.");
      if (createMode === "invite" && body.invitationLink) {
        setCreatedInvitation({
          email: body.email ?? createForm.email.trim(),
          link: body.invitationLink,
          emailSent: !!body.invitationEmailSent,
        });
        try {
          await navigator.clipboard.writeText(body.invitationLink);
        } catch {
          /* clipboard not granted — the link is shown on screen */
        }
        toast({
          title: body.invitationEmailSent ? "Invitation sent" : "Account created",
          description: body.invitationEmailSent
            ? "Invitation email sent and link copied to clipboard."
            : "Invitation email failed — share the link manually (copied to clipboard).",
          variant: body.invitationEmailSent ? "default" : "destructive",
        });
      } else {
        toast({ title: "Account created", description: "The account is active immediately and can sign in now." });
        setCreateOpen(false);
      }
      setCreateForm(EMPTY_CREATE_FORM);
      await loadUsers(roleFilter);
      // A freshly created cleaner should get an availability line immediately.
      await loadCleanerAvailability();
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message ?? "Failed to create account.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(credentials?: { pin?: string; password?: string }) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete account.");
      toast({ title: "Account deleted" });
      setDeleteTarget(null);
      await loadUsers(roleFilter);
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <ECard className={"grid gap-2 p-3 " + (canManage ? "sm:grid-cols-[1fr_12rem_auto]" : "sm:grid-cols-[1fr_12rem]")}>
        <EInput
          placeholder="Search name, email or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ESelect value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          {MANAGED_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </ESelect>
        {canManage ? (
          <EButton variant="gold" onClick={() => { setCreatedInvitation(null); setCreateOpen(true); }}>
            <UserRoundPlus className="h-4 w-4" />
            New account
          </EButton>
        ) : null}
      </ECard>

      {/* Roster */}
      <ECard>
        {loading ? (
          <p className="px-6 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading accounts…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No accounts found.
          </p>
        ) : (
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {filtered.map((user) => (
              <div
                key={user.id}
                className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <EAvatar name={user.name ?? user.email} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[0.9375rem] font-[550]">{user.name ?? "Unnamed user"}</p>
                      <EBadge tone={ROLE_TONE[user.role] ?? "neutral"} soft>
                        {roleLabel(user.role)}
                      </EBadge>
                      <EBadge tone={user.isActive ? "success" : "neutral"}>
                        {user.isActive ? "Active" : "Disabled"}
                      </EBadge>
                      {!user.emailVerified ? <EBadge tone="warning" soft>Pending verification</EBadge> : null}
                      {/* Flag deviations from the role-level policy so admins can
                          spot per-user exceptions without opening each account. */}
                      {user.profileEditOverride ? (
                        <EBadge tone="info" soft>Custom profile permissions</EBadge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {user.email}
                      {user.phone ? ` · ${user.phone}` : ""}
                      {user.client ? ` · Client: ${user.client.name}` : ""}
                    </p>
                    {user.role === "CLEANER" && availabilityByCleaner[user.id] ? (
                      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        Availability: {availabilityByCleaner[user.id]}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {user.role !== "CLIENT" ? (
                    <EButton asChild size="sm" variant="ghost">
                      <Link href={`/v2/admin/accounts/users/${user.id}`}>
                        <BarChart2 className="h-3.5 w-3.5" />
                        Profile
                      </Link>
                    </EButton>
                  ) : null}
                  {!user.emailVerified || !user.isActive ? (
                    <EButton
                      size="sm"
                      variant="outline"
                      disabled={busyUserId === user.id}
                      onClick={() => resendOtp(user.id)}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Resend invite
                    </EButton>
                  ) : null}
                  {canManage ? (
                    <>
                      <EButton
                        size="sm"
                        variant="outline"
                        disabled={busyUserId === user.id}
                        onClick={() => openEditor(user)}
                      >
                        <UserCog className="h-3.5 w-3.5" />
                        Edit
                      </EButton>
                      <EButton
                        size="sm"
                        variant="ghost"
                        disabled={busyUserId === user.id}
                        onClick={() => setResetTarget(user)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Reset password
                      </EButton>
                      <EButton
                        size="sm"
                        variant="ghost"
                        disabled={busyUserId === user.id}
                        onClick={() => setReset2faTarget(user)}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        Reset 2FA
                      </EButton>
                      <EButton
                        size="sm"
                        variant="ghost"
                        disabled={busyUserId === user.id}
                        onClick={() => toggleActive(user)}
                        className={user.isActive ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-success))]"}
                      >
                        {user.isActive ? <UserX className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        {user.isActive ? "Disable" : "Activate"}
                      </EButton>
                      <EButton
                        size="sm"
                        variant="ghost"
                        disabled={busyUserId === user.id}
                        onClick={() => setDeleteTarget(user)}
                        className="text-[hsl(var(--e-danger))]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </EButton>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </ECard>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <EButton size="sm" variant="ghost" onClick={() => void loadUsers(roleFilter)}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </EButton>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            <KeyRound className="h-3 w-3" />
            Extended profile &amp; bank details: open an account and edit its Payroll &amp; identity card.
          </span>
        </div>
      </div>

      {/* Edit modal — basic account fields */}
      <EModal
        open={!!editing}
        onClose={() => setEditing(null)}
        eyebrow="Accounts"
        title="Manage account"
        wide
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name">
              <EInput value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </EField>
            <EField label="Email">
              <EInput
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </EField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Phone">
              <EInput
                type="tel"
                inputMode="tel"
                maxLength={16}
                placeholder="0451217210 or +61451217210"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </EField>
            <EField label="Role">
              <ESelect
                value={form.role}
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as AccountRole }))}
              >
                {MANAGED_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          {form.role === "CLIENT" ? (
            <EField label="Linked client profile">
              <ESelect
                value={form.clientId}
                onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
              >
                <option value="">Select client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : null}
          <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <div>
              <p className="text-[0.875rem] font-[550]">Account active</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Disable to block login.</p>
            </div>
            <ESwitch checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
          </div>

          {/* Per-user profile-edit override. The server stores either null
              (inherit the role default) or a complete three-field object, so
              the enable switch flips between those two shapes rather than
              offering per-field tri-states. */}
          <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
                <div>
                  <p className="text-[0.875rem] font-[550]">Profile edit permissions</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {overrideEnabled
                      ? "Custom override — replaces the role default for this account."
                      : `Inheriting the ${roleLabel(form.role)} role default.`}
                  </p>
                </div>
              </div>
              <ESwitch
                checked={overrideEnabled}
                onCheckedChange={(v) => {
                  setOverrideEnabled(v);
                  if (v) {
                    // Start the override from the effective policy (existing
                    // override, else role default) so enabling it changes
                    // nothing until a field switch is actually flipped.
                    setOverrideForm(
                      initialOverride ??
                        rolePolicyDefaults[form.role] ?? { canEditName: true, canEditPhone: true, canEditEmail: false }
                    );
                  }
                }}
              />
            </div>
            {overrideEnabled ? (
              <div className="space-y-2">
                {(
                  [
                    ["canEditName", "Can edit name"],
                    ["canEditPhone", "Can edit phone"],
                    ["canEditEmail", "Can edit email"],
                  ] as Array<[keyof ProfileEditPolicy, string]>
                ).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2"
                  >
                    <p className="text-[0.8125rem]">{label}</p>
                    <ESwitch
                      checked={overrideForm[key]}
                      onCheckedChange={(v) => setOverrideForm((p) => ({ ...p, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Extended profile and bank details are edited on the account&apos;s page (Payroll &amp; identity card).
          </p>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </EButton>
            <EButton variant="primary" size="sm" onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save account"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Create account — invite or manual password (same POST /api/admin/users as v1) */}
      <EModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        eyebrow="Accounts"
        title="New account"
        wide
      >
        {createdInvitation ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
              Invitation for <span className="font-[550]">{createdInvitation.email}</span>{" "}
              {createdInvitation.emailSent ? "was emailed and is" : "could not be emailed — share this link manually; it is"}{" "}
              copied to your clipboard.
            </p>
            <div className="break-all rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              {createdInvitation.link}
            </div>
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" size="sm" onClick={() => setCreatedInvitation(null)}>
                Create another
              </EButton>
              <EButton variant="primary" size="sm" onClick={() => { setCreatedInvitation(null); setCreateOpen(false); }}>
                Done
              </EButton>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
              {(["invite", "password"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCreateMode(mode)}
                  aria-current={createMode === mode ? "page" : undefined}
                  className={
                    "rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                    (createMode === mode
                      ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                      : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
                  }
                >
                  {mode === "invite" ? "Email invitation" : "Set password"}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Name">
                <EInput value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} />
              </EField>
              <EField label="Email">
                <EInput type="email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
              </EField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Phone" hint="Optional.">
                <EInput
                  type="tel"
                  inputMode="tel"
                  maxLength={16}
                  placeholder="0451217210 or +61451217210"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                />
              </EField>
              <EField label="Role">
                <ESelect value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value as AccountRole }))}>
                  {MANAGED_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </ESelect>
              </EField>
            </div>
            {createForm.role === "CLIENT" ? (
              <EField label="Linked client profile">
                <ESelect value={createForm.clientId} onChange={(e) => setCreateForm((p) => ({ ...p, clientId: e.target.value }))}>
                  <option value="">Select client…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
            {/* v1 parity: capture ABN (business roles) and bank payout details
                (paid roles) up front so payroll-ready accounts don't need a
                second trip to the extended-profile editor after creation. */}
            {createForm.role === "CLIENT" || createForm.role === "LAUNDRY" ? (
              <EField label="ABN" hint="Optional. 11 digits.">
                <EInput
                  inputMode="numeric"
                  maxLength={14}
                  placeholder="11 digits"
                  value={createForm.abn}
                  onChange={(e) => setCreateForm((p) => ({ ...p, abn: e.target.value }))}
                />
              </EField>
            ) : null}
            {createForm.role === "CLEANER" || createForm.role === "LAUNDRY" ? (
              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[550]">Bank details (optional)</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EField label="Account name">
                    <EInput
                      value={createForm.bankAccountName}
                      onChange={(e) => setCreateForm((p) => ({ ...p, bankAccountName: e.target.value }))}
                    />
                  </EField>
                  <EField label="Bank name">
                    <EInput
                      value={createForm.bankName}
                      onChange={(e) => setCreateForm((p) => ({ ...p, bankName: e.target.value }))}
                    />
                  </EField>
                  <EField label="BSB">
                    <EInput
                      inputMode="numeric"
                      maxLength={7}
                      placeholder="123456"
                      value={createForm.bankBsb}
                      onChange={(e) => setCreateForm((p) => ({ ...p, bankBsb: e.target.value }))}
                    />
                  </EField>
                  <EField label="Account number">
                    <EInput
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="6 to 10 digits"
                      value={createForm.bankAccountNumber}
                      onChange={(e) => setCreateForm((p) => ({ ...p, bankAccountNumber: e.target.value }))}
                    />
                  </EField>
                </div>
              </div>
            ) : null}
            {createMode === "password" ? (
              <EField label="Password" hint="The account is active immediately with this password.">
                <EInput
                  type="password"
                  autoComplete="new-password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                />
              </EField>
            ) : (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                An invitation email with a one-time setup link is sent to the new account.
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" onClick={createUser} disabled={creating}>
                {creating ? "Creating…" : createMode === "invite" ? "Send invitation" : "Create account"}
              </EButton>
            </div>
          </div>
        )}
      </EModal>

      {/* Reset password — security-verified (same policy as v1) */}
      <EConfirmModal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset password"
        description={
          resetTarget
            ? `Generate a temporary password for ${resetTarget.name ?? resetTarget.email} and email it to them. Enter your PIN or password to continue.`
            : undefined
        }
        confirmLabel="Reset password"
        requireSecurity
        danger={false}
        loading={resetting}
        onConfirm={resetPassword}
      />

      {/* Reset 2FA — security-verified (same policy as v1) */}
      <EConfirmModal
        open={!!reset2faTarget}
        onClose={() => setReset2faTarget(null)}
        title="Reset two-step verification"
        description={
          reset2faTarget
            ? `${reset2faTarget.name ?? reset2faTarget.email} will be able to sign in with just their password and set 2FA up again. Enter your PIN or password to continue.`
            : undefined
        }
        confirmLabel="Reset 2FA"
        requireSecurity
        loading={resetting2fa}
        onConfirm={reset2fa}
      />

      {/* Delete — high-risk confirm: DELETE phrase + PIN/password (same policy as v1) */}
      <EConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete account"
        description={
          deleteTarget
            ? `This will permanently delete ${deleteTarget.name ?? deleteTarget.email}. Accounts with job history cannot be deleted.`
            : "This action is permanent."
        }
        confirmLabel="Delete account"
        confirmPhrase="DELETE"
        requireSecurity
        loading={deleting}
        onConfirm={deleteUser}
      />
    </div>
  );
}
