"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { GoogleAddressInput } from "@/components/shared/google-address-input";
import { toast } from "@/hooks/use-toast";
import type { ClientPortalVisibility } from "@/lib/settings";

const CLIENT_PORTAL_OVERRIDE_FIELDS: Array<[keyof ClientPortalVisibility, string]> = [
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
  ["allowInventoryThresholdEdits", "Allow inventory threshold edits"],
  ["allowStockRuns", "Allow stock runs"],
  ["allowCaseReplies", "Allow case replies"],
];

interface EditClientFormProps {
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
    portalVisibilityOverrides: Partial<ClientPortalVisibility> | null;
  };
  defaultPortalVisibility: ClientPortalVisibility;
}

export function EditClientForm({ client, defaultPortalVisibility }: EditClientFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    notes: client.notes ?? "",
    portalVisibilityOverrides: { ...(client.portalVisibilityOverrides ?? {}) },
  });
  const [welcomeNote, setWelcomeNote] = useState("");

  async function saveClient() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to save client.");
      }

      toast({ title: "Client updated" });
      router.push(`/admin/clients/${client.id}`);
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err.message ?? "Failed to update client.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deactivateClient(credentials?: { pin?: string; password?: string }) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to deactivate client.");
      }

      toast({ title: "Client deactivated" });
      setDeleteOpen(false);
      router.push("/admin/clients");
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Deactivate failed",
        description: err.message ?? "Failed to deactivate client.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function sendInvite(credentials?: { pin?: string; password?: string }) {
    if (!form.email.trim()) {
      toast({ title: "Client email is required", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          welcomeNote,
          security: credentials,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to send client invite.");
      }
      setInviteOpen(false);
      toast({
        title: payload.warning ? "Invite sent with warning" : "Client invite sent",
        description: payload.warning ?? "The client's existing password was replaced and a temporary password invite was sent.",
      });
    } catch (err: any) {
      toast({
        title: "Invite failed",
        description: err.message ?? "Failed to send client invite.",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Edit Client</h2>
          <p className="text-sm text-muted-foreground">Update contact details and notes.</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/admin/clients/${client.id}`}>Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                maxLength={16}
                placeholder="0451217210 or +61451217210"
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <GoogleAddressInput
                id="address"
                value={form.address}
                onChange={(value) => setForm((prev) => ({ ...prev, address: value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
            <div>
              <p className="text-sm font-medium">Client portal visibility overrides</p>
              <p className="text-xs text-muted-foreground">
                These switches override the global client portal defaults only for this client.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {CLIENT_PORTAL_OVERRIDE_FIELDS.map(([key, label]) => {
                const overrideValue = form.portalVisibilityOverrides[key];
                const effectiveValue =
                  typeof overrideValue === "boolean" ? overrideValue : defaultPortalVisibility[key];
                return (
                  <div key={key} className="rounded border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <Label className="text-xs">{label}</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Default: {defaultPortalVisibility[key] ? "Shown" : "Hidden"}
                        </p>
                      </div>
                      <Switch
                        checked={effectiveValue}
                        onCheckedChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            portalVisibilityOverrides: {
                              ...prev.portalVisibilityOverrides,
                              [key]: value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Portal invitation</p>
              <p className="text-xs text-muted-foreground">
                Send a fresh invitation with a temporary password. Any current password will be replaced.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="welcomeNote">Welcome note</Label>
              <Textarea
                id="welcomeNote"
                value={welcomeNote}
                onChange={(e) => setWelcomeNote(e.target.value)}
                placeholder="Optional note to include in the invitation email"
              />
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setInviteOpen(true)} disabled={inviting || !form.email.trim()}>
                {inviting ? "Sending..." : "Send invite / reset password"}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleting}>
              {deleting ? "Deactivating..." : "Deactivate client"}
            </Button>
            <Button onClick={saveClient} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Deactivate client"
        description="This will hide the client from active lists. Existing records remain in history."
        actionKey="deactivateClient"
        confirmLabel="Deactivate"
        requireSecurityVerification
        loading={deleting}
        onConfirm={deactivateClient}
      />

      <TwoStepConfirmDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Send client portal invitation"
        description="This resets the linked client account password and emails a temporary password with your welcome note."
        actionKey="sendClientInvite"
        confirmLabel="Send invite"
        requireSecurityVerification
        loading={inviting}
        onConfirm={sendInvite}
      />
    </div>
  );
}
