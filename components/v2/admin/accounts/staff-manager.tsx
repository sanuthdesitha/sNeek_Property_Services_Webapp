"use client";

/**
 * ESTATE staff accounts manager — v2-native replacement for the v1
 * UsersManager. Same API surface, new Estate UI:
 *   list           → GET    /api/admin/users?includeInactive=1[&role=X]
 *   clients        → GET    /api/admin/clients          (for CLIENT linking)
 *   edit fields    → PATCH  /api/admin/users/[id]       { name, email, phone, role, isActive, clientId? }
 *   resend invite  → POST   /api/admin/users/[id]/resend-otp
 *   toggle active  → PATCH  /api/admin/users/[id]       { isActive }
 *   delete         → DELETE /api/admin/users/[id]       { security: { pin?, password? } }
 * Account creation and the deep profile-permission / bank-detail flows stay in
 * the classic accounts workspace (discreet link below the roster).
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
  UserX,
  ShieldCheck,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EAvatar,
  EClassicLink,
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

  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      <ECard className="grid gap-2 p-3 sm:grid-cols-[1fr_12rem]">
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
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {user.email}
                      {user.phone ? ` · ${user.phone}` : ""}
                      {user.client ? ` · Client: ${user.client.name}` : ""}
                    </p>
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
            Create accounts, password resets & 2FA:
          </span>
          <EClassicLink href="/admin/accounts?tab=staff">classic accounts workspace</EClassicLink>
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
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Extended profile, bank details and edit-permission overrides live in the{" "}
            <EClassicLink href="/admin/accounts?tab=staff">classic workspace</EClassicLink>.
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
