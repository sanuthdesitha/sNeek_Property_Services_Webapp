"use client";

import { useEffect, useMemo, useState } from "react";
import { Shield, ShieldCheck, Trash2, UserCog, UserX, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { ProfileActivityLog } from "@/components/admin/profile-activity-log";
import { toast } from "@/hooks/use-toast";

type AccountRole = "ADMIN" | "OPS_MANAGER" | "CLEANER" | "CLIENT" | "LAUNDRY";

interface BankDetails {
  accountName?: string;
  bankName?: string;
  bsb?: string;
  accountNumber?: string;
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
  profileEditOverride?: {
    canEditName: boolean;
    canEditPhone: boolean;
    canEditEmail: boolean;
  } | null;
  extendedProfile?: {
    businessName: string | null;
    abn: string | null;
    address: string | null;
    contactNumber: string | null;
    bankDetails: BankDetails | null;
  } | null;
}

interface ClientItem {
  id: string;
  name: string;
}

const MANAGED_ROLES: AccountRole[] = ["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "LAUNDRY"];

export function UsersManager({ canManage }: { canManage: boolean }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [availabilityByCleaner, setAvailabilityByCleaner] = useState<Record<string, string>>({});
  const [roleFilter, setRoleFilter] = useState<"all" | string>("all");
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [rolePolicyDefaults, setRolePolicyDefaults] = useState<Record<string, { canEditName: boolean; canEditPhone: boolean; canEditEmail: boolean }>>({});
  const [overrideForm, setOverrideForm] = useState({
    canEditName: true,
    canEditPhone: true,
    canEditEmail: false,
  });
  const [accountForm, setAccountForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "CLEANER" as AccountRole,
    clientId: "",
    isActive: true,
    businessName: "",
    abn: "",
    address: "",
    contactNumber: "",
    bankDetails: {
      accountName: "",
      bankName: "",
      bsb: "",
      accountNumber: "",
    },
  });
  const [busyUserId, setBusyUserId] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserItem | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "CLEANER" as Extract<AccountRole, "CLEANER" | "CLIENT" | "LAUNDRY">,
    phone: "",
    clientId: "new",
    clientName: "",
    clientAddress: "",
    businessName: "",
    abn: "",
    address: "",
    contactNumber: "",
    bankDetails: {
      accountName: "",
      bankName: "",
      bsb: "",
      accountNumber: "",
    },
  });

  async function loadUsers(filter: string = roleFilter) {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("includeInactive", "1");
    if (filter !== "all") params.set("role", filter);
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    const body = await res.json().catch(() => []);
    setUsers(Array.isArray(body) ? body : []);
    setLoading(false);
  }

  async function loadClients() {
    const res = await fetch("/api/admin/clients");
    const body = await res.json().catch(() => []);
    setClients(Array.isArray(body) ? body : []);
  }

  async function loadRoleDefaults() {
    const res = await fetch("/api/admin/settings");
    const body = await res.json().catch(() => null);
    if (res.ok && body?.profileEditPolicy) {
      setRolePolicyDefaults(body.profileEditPolicy);
    }
  }

  async function loadCleanerAvailability() {
    const res = await fetch("/api/admin/cleaners/availability");
    const body = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(body)) return;
    const map: Record<string, string> = {};
    for (const row of body) {
      const weeklyDays = Object.keys(row?.availability?.weekly ?? {}).length;
      const overrides = Object.keys(row?.availability?.dateOverrides ?? {}).length;
      const mode = row?.availability?.mode === "FLEXIBLE" ? "Flexible" : "Fixed";
      map[row.id] = `${mode} | ${weeklyDays} weekly day(s) | ${overrides} override(s)`;
    }
    setAvailabilityByCleaner(map);
  }

  useEffect(() => {
    loadUsers("all");
    loadClients();
    loadRoleDefaults();
    loadCleanerAvailability();
  }, []);

  async function createUser() {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast({ title: "Name, email, and password are required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || undefined,
        clientId: form.role === "CLIENT" && form.clientId !== "new" ? form.clientId : undefined,
        clientName: form.role === "CLIENT" && form.clientId === "new" ? form.clientName.trim() : undefined,
        clientAddress: form.role === "CLIENT" && form.clientId === "new" ? form.clientAddress.trim() : undefined,
        businessName: form.businessName.trim() || undefined,
        abn: form.abn.trim() || undefined,
        address: form.address.trim() || undefined,
        contactNumber: form.contactNumber.trim() || undefined,
        bankDetails:
          form.role === "CLEANER" || form.role === "LAUNDRY"
            ? {
                accountName: form.bankDetails.accountName.trim(),
                bankName: form.bankDetails.bankName.trim(),
                bsb: form.bankDetails.bsb.trim(),
                accountNumber: form.bankDetails.accountNumber.trim(),
              }
            : undefined,
      };

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to create account.");

      toast({
        title: "Account created",
        description: "The account is active immediately and can sign in now.",
        variant: "default",
      });
      setForm({
        name: "",
        email: "",
        password: "",
        role: "CLEANER",
        phone: "",
        clientId: "new",
        clientName: "",
        clientAddress: "",
        businessName: "",
        abn: "",
        address: "",
        contactNumber: "",
        bankDetails: {
          accountName: "",
          bankName: "",
          bsb: "",
          accountNumber: "",
        },
      });
      await loadUsers();
      await loadClients();
      await loadCleanerAvailability();
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message ?? "Failed to create account.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function resendOtp(userId: string) {
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/resend-otp`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Try again.");
      toast({ title: "OTP sent" });
    } catch (err: any) {
      toast({ title: "Could not resend OTP", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusyUserId("");
    }
  }

  function openEditor(user: UserItem) {
    const roleDefault = rolePolicyDefaults[user.role] ?? {
      canEditName: true,
      canEditPhone: true,
      canEditEmail: false,
    };
    setEditingUser(user);
    setAccountForm({
      name: user.name ?? "",
      email: user.email,
      phone: user.phone ?? "",
      role: user.role,
      clientId: user.clientId ?? "",
      isActive: !!user.isActive,
      businessName: user.extendedProfile?.businessName ?? "",
      abn: user.extendedProfile?.abn ?? "",
      address: user.extendedProfile?.address ?? "",
      contactNumber: user.extendedProfile?.contactNumber ?? user.phone ?? "",
      bankDetails: {
        accountName: user.extendedProfile?.bankDetails?.accountName ?? "",
        bankName: user.extendedProfile?.bankDetails?.bankName ?? "",
        bsb: user.extendedProfile?.bankDetails?.bsb ?? "",
        accountNumber: user.extendedProfile?.bankDetails?.accountNumber ?? "",
      },
    });
    setOverrideForm(user.profileEditOverride ?? roleDefault);
  }

  function closeEditor() {
    setEditingUser(null);
  }

  async function saveUserChanges() {
    if (!editingUser) return;
    if (!accountForm.name.trim() || !accountForm.email.trim()) {
      toast({ title: "Name and email are required.", variant: "destructive" });
      return;
    }
    if (accountForm.role === "CLIENT" && !accountForm.clientId) {
      toast({ title: "Client role must be linked to a client profile.", variant: "destructive" });
      return;
    }

    setBusyUserId(editingUser.id);
    try {
      const updateRes = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountForm.name.trim(),
          email: accountForm.email.trim(),
          phone: accountForm.phone.trim() || null,
          role: accountForm.role,
          isActive: accountForm.isActive,
          clientId: accountForm.role === "CLIENT" ? accountForm.clientId : null,
          businessName: accountForm.businessName.trim() || null,
          abn: accountForm.abn.trim() || null,
          address: accountForm.address.trim() || null,
          contactNumber: accountForm.contactNumber.trim() || null,
          bankDetails:
            accountForm.role === "CLEANER" || accountForm.role === "LAUNDRY"
              ? {
                  accountName: accountForm.bankDetails.accountName.trim(),
                  bankName: accountForm.bankDetails.bankName.trim(),
                  bsb: accountForm.bankDetails.bsb.trim(),
                  accountNumber: accountForm.bankDetails.accountNumber.trim(),
                }
              : null,
        }),
      });
      const updateBody = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok) throw new Error(updateBody.error ?? "Could not update account.");

      const overrideRes = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          profileEditOverride: overrideForm,
        }),
      });
      const overrideBody = await overrideRes.json().catch(() => ({}));
      if (!overrideRes.ok) throw new Error(overrideBody.error ?? "Could not update profile permissions.");

      toast({ title: "Account updated" });
      closeEditor();
      await loadUsers();
      await loadCleanerAvailability();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message ?? "Could not update account.", variant: "destructive" });
    } finally {
      setBusyUserId("");
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
      await loadUsers();
    } catch (err: any) {
      toast({ title: "Status update failed", description: err.message ?? "Could not update account.", variant: "destructive" });
    } finally {
      setBusyUserId("");
    }
  }

  async function resetPassword(credentials?: { pin?: string; password?: string }) {
    if (!resetTarget) return;
    setResettingPassword(true);
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
      setResettingPassword(false);
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
      await loadUsers();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message ?? "Could not delete account.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const counts = useMemo(() => {
    const active = users.filter((user) => user.isActive).length;
    const pending = users.filter((user) => !user.isActive || !user.emailVerified).length;
    const admins = users.filter((user) => user.role === "ADMIN").length;
    return { active, pending, admins };
  }, [users]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">User Accounts</h2>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Create, edit, disable, reset, and manage account access."
            : "View accounts and verification state. Admin access is required for changes."}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total accounts</p><p className="text-2xl font-bold">{users.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active</p><p className="text-2xl font-bold">{counts.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Admins</p><p className="text-2xl font-bold">{counts.admins}</p></CardContent></Card>
      </section>

      <Tabs defaultValue="list">
        <TabsList className="flex w-full flex-wrap justify-start gap-2 overflow-x-auto">
          <TabsTrigger value="list">Accounts</TabsTrigger>
          {canManage ? <TabsTrigger value="create">Create Account</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="list">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">All Accounts</CardTitle>
                <Select
                value={roleFilter}
                onValueChange={(value) => {
                  setRoleFilter(value);
                  loadUsers(value);
                }}
              >
                  <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {MANAGED_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {loading ? (
                  <p className="px-6 py-8 text-sm text-muted-foreground">Loading accounts...</p>
                ) : users.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-muted-foreground">No accounts found.</p>
                ) : (
                  users.map((user) => (
                    <div key={user.id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{user.name ?? "Unnamed user"}</p>
                          <Badge variant={user.isActive ? "success" : "secondary"}>
                            {user.isActive ? "Active" : "Disabled"}
                          </Badge>
                          {!user.emailVerified ? <Badge variant="warning">Pending verification</Badge> : null}
                          <Badge variant="outline">{user.role}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{user.email}</p>
                        {user.phone ? <p className="text-xs text-muted-foreground">{user.phone}</p> : null}
                        {user.extendedProfile?.contactNumber ? (
                          <p className="text-xs text-muted-foreground">Contact: {user.extendedProfile.contactNumber}</p>
                        ) : null}
                        {user.extendedProfile?.address ? (
                          <p className="text-xs text-muted-foreground">Address: {user.extendedProfile.address}</p>
                        ) : null}
                        {user.extendedProfile?.businessName ? (
                          <p className="text-xs text-muted-foreground">Business: {user.extendedProfile.businessName}</p>
                        ) : null}
                        {user.extendedProfile?.abn ? (
                          <p className="text-xs text-muted-foreground">ABN: {user.extendedProfile.abn}</p>
                        ) : null}
                        {user.client ? <p className="text-xs text-muted-foreground">Client profile: {user.client.name}</p> : null}
                        {user.role === "CLEANER" && availabilityByCleaner[user.id] ? (
                          <p className="text-xs text-muted-foreground">Availability: {availabilityByCleaner[user.id]}</p>
                        ) : null}
                        {user.profileEditOverride ? <p className="text-xs text-primary">Custom profile permission override active</p> : null}
                      </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {(!user.emailVerified || !user.isActive) ? (
                          <Button size="sm" variant="secondary" disabled={busyUserId === user.id} onClick={() => resendOtp(user.id)}>
                            <Mail className="mr-2 h-4 w-4" />
                            Resend OTP
                          </Button>
                        ) : null}
                        {canManage ? (
                          <>
                            <Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => openEditor(user)}>
                              <UserCog className="mr-2 h-4 w-4" />
                              Edit
                            </Button>
                            <Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => setResetTarget(user)}>
                              <KeyRound className="mr-2 h-4 w-4" />
                              Reset Password
                            </Button>
                            <Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => toggleActive(user)}>
                              {user.isActive ? <UserX className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                              {user.isActive ? "Disable" : "Activate"}
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busyUserId === user.id} onClick={() => setDeleteTarget(user)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canManage ? (
          <TabsContent value="create">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create Cleaner / Client / Laundry Account</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={form.role}
                      onValueChange={(value: "CLEANER" | "CLIENT" | "LAUNDRY") =>
                        setForm((prev) => ({ ...prev, role: value }))
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CLEANER">Cleaner</SelectItem>
                        <SelectItem value="CLIENT">Client</SelectItem>
                        <SelectItem value="LAUNDRY">Laundry</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone (optional)</Label>
                    <Input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Contact number (optional)</Label>
                    <Input
                      value={form.contactNumber}
                      onChange={(e) => setForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Address (optional)</Label>
                    <Input
                      value={form.address}
                      onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                    />
                  </div>
                </div>

                {(form.role === "CLIENT" || form.role === "LAUNDRY") ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Business name (optional)</Label>
                      <Input
                        value={form.businessName}
                        onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>ABN (optional)</Label>
                      <Input value={form.abn} onChange={(e) => setForm((prev) => ({ ...prev, abn: e.target.value }))} />
                    </div>
                  </div>
                ) : null}

                {(form.role === "CLEANER" || form.role === "LAUNDRY") ? (
                  <div className="space-y-3 rounded-md border p-4">
                    <p className="text-sm font-medium">Bank details (optional)</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Account name</Label>
                        <Input
                          value={form.bankDetails.accountName}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              bankDetails: { ...prev.bankDetails, accountName: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Bank name</Label>
                        <Input
                          value={form.bankDetails.bankName}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              bankDetails: { ...prev.bankDetails, bankName: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>BSB</Label>
                        <Input
                          value={form.bankDetails.bsb}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              bankDetails: { ...prev.bankDetails, bsb: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Account number</Label>
                        <Input
                          value={form.bankDetails.accountNumber}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              bankDetails: { ...prev.bankDetails, accountNumber: e.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {form.role === "CLIENT" ? (
                  <div className="space-y-4 rounded-md border p-4">
                    <p className="text-sm font-medium">Client Mapping</p>
                    <div className="space-y-1.5">
                      <Label>Use Existing Client (or create new)</Label>
                      <Select value={form.clientId} onValueChange={(value) => setForm((prev) => ({ ...prev, clientId: value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">Create new client profile</SelectItem>
                          {clients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {form.clientId === "new" ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Client Name (optional)</Label>
                          <Input value={form.clientName} onChange={(e) => setForm((prev) => ({ ...prev, clientName: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Client Address (optional)</Label>
                          <Input value={form.clientAddress} onChange={(e) => setForm((prev) => ({ ...prev, clientAddress: e.target.value }))} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button onClick={createUser} disabled={saving}>
                    {saving ? "Creating..." : "Create account"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={accountForm.name} onChange={(e) => setAccountForm((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={accountForm.email} onChange={(e) => setAccountForm((prev) => ({ ...prev, email: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={accountForm.phone} onChange={(e) => setAccountForm((prev) => ({ ...prev, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={accountForm.role} onValueChange={(value: AccountRole) => setAccountForm((prev) => ({ ...prev, role: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MANAGED_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>{role.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">Account active</p>
                    <p className="text-xs text-muted-foreground">Disable to block login</p>
                  </div>
                  <Switch checked={accountForm.isActive} onCheckedChange={(value) => setAccountForm((prev) => ({ ...prev, isActive: value }))} />
                </div>
              </div>
              {accountForm.role === "CLIENT" ? (
                <div className="space-y-1.5">
                  <Label>Linked client profile</Label>
                  <Select value={accountForm.clientId || ""} onValueChange={(value) => setAccountForm((prev) => ({ ...prev, clientId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Contact number (optional)</Label>
                  <Input
                    value={accountForm.contactNumber}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, contactNumber: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Address (optional)</Label>
                  <Input
                    value={accountForm.address}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, address: e.target.value }))}
                  />
                </div>
              </div>
              {(accountForm.role === "CLIENT" || accountForm.role === "LAUNDRY") ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Business name (optional)</Label>
                    <Input
                      value={accountForm.businessName}
                      onChange={(e) => setAccountForm((prev) => ({ ...prev, businessName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>ABN (optional)</Label>
                    <Input
                      value={accountForm.abn}
                      onChange={(e) => setAccountForm((prev) => ({ ...prev, abn: e.target.value }))}
                    />
                  </div>
                </div>
              ) : null}
              {(accountForm.role === "CLEANER" || accountForm.role === "LAUNDRY") ? (
                <div className="space-y-3 rounded-md border p-4">
                  <p className="text-sm font-medium">Bank details (optional)</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Account name</Label>
                      <Input
                        value={accountForm.bankDetails.accountName}
                        onChange={(e) =>
                          setAccountForm((prev) => ({
                            ...prev,
                            bankDetails: { ...prev.bankDetails, accountName: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Bank name</Label>
                      <Input
                        value={accountForm.bankDetails.bankName}
                        onChange={(e) =>
                          setAccountForm((prev) => ({
                            ...prev,
                            bankDetails: { ...prev.bankDetails, bankName: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>BSB</Label>
                      <Input
                        value={accountForm.bankDetails.bsb}
                        onChange={(e) =>
                          setAccountForm((prev) => ({
                            ...prev,
                            bankDetails: { ...prev.bankDetails, bsb: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Account number</Label>
                      <Input
                        value={accountForm.bankDetails.accountNumber}
                        onChange={(e) =>
                          setAccountForm((prev) => ({
                            ...prev,
                            bankDetails: { ...prev.bankDetails, accountNumber: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="space-y-3 rounded-md border p-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <p className="text-sm font-medium">Profile Edit Permissions</p>
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <Label className="text-sm">Can edit name</Label>
                <Switch checked={overrideForm.canEditName} onCheckedChange={(value) => setOverrideForm((prev) => ({ ...prev, canEditName: value }))} />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <Label className="text-sm">Can edit phone</Label>
                <Switch checked={overrideForm.canEditPhone} onCheckedChange={(value) => setOverrideForm((prev) => ({ ...prev, canEditPhone: value }))} />
              </div>
              <div className="flex items-center justify-between rounded border p-3">
                <Label className="text-sm">Can edit email</Label>
                <Switch checked={overrideForm.canEditEmail} onCheckedChange={(value) => setOverrideForm((prev) => ({ ...prev, canEditEmail: value }))} />
              </div>
            </section>

            {editingUser ? (
              <ProfileActivityLog endpoint={`/api/admin/users/${editingUser.id}/activity`} title="Profile Activity" />
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeEditor}>Cancel</Button>
              <Button disabled={busyUserId === editingUser?.id || savingOverride} onClick={saveUserChanges}>
                {busyUserId === editingUser?.id ? "Saving..." : "Save account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        title="Reset account password"
        description={
          resetTarget
            ? `This sends a new temporary password to ${resetTarget.name ?? resetTarget.email} and logs out existing sessions.`
            : "This resets the account password."
        }
        confirmPhrase="RESET"
        confirmLabel="Reset password"
        requireSecurityVerification
        loading={resettingPassword}
        onConfirm={resetPassword}
      />

      <TwoStepConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete account"
        description={
          deleteTarget
            ? `This will permanently delete ${deleteTarget.name ?? deleteTarget.email}. Accounts with job history cannot be deleted.`
            : "This action is permanent."
        }
        confirmPhrase="DELETE"
        confirmLabel="Delete account"
        requireSecurityVerification
        loading={deleting}
        onConfirm={deleteUser}
      />
    </div>
  );
}
