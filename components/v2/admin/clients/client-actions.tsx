"use client";

/**
 * ESTATE client actions — edit / portal invite / delete for the v2 client 360.
 * Same API surface as the v1 workspace:
 *   edit    → PATCH  /api/admin/clients/:id   (partial: name, email, phone, address, suburb, state, postcode, notes, portalVisibilityOverrides)
 *   invite  → POST   /api/admin/clients/:id/invite   { welcomeNote?, security }
 *   delete  → DELETE /api/admin/clients/:id          { security }
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, PencilLine, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import type { ClientPortalVisibility } from "@/lib/settings";

/**
 * Per-client portal visibility overrides — ported from v1's edit-client-form.
 * The field list mirrors lib/validations/client.ts's
 * clientPortalVisibilityOverrideSchema (the PATCH route strips anything else),
 * so a key added here without a schema entry would silently not persist.
 */
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
  ["showLiveProgress", "Show live mid-clean progress"],
  ["showCases", "Show cases/issues"],
  ["showExtraPayRequests", "Show extra pay requests"],
  ["showQuoteRequests", "Show quote requests"],
  ["showApprovals", "Show approval requests"],
  ["showCleanerNames", "Show cleaner names to client"],
  ["allowInventoryThresholdEdits", "Allow inventory threshold edits"],
  ["allowStockRuns", "Allow stock runs"],
  ["allowCaseReplies", "Allow case replies"],
];

type PortalVisibilityOverrides = Partial<Record<keyof ClientPortalVisibility, boolean>>;

export type ClientActionsClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  suburb: string | null;
  state?: string | null;
  postcode?: string | null;
  notes?: string | null;
  isActive: boolean;
  portalVisibilityOverrides?: PortalVisibilityOverrides | null;
};

export function ClientActions({
  client,
  defaultPortalVisibility,
}: {
  client: ClientActionsClient;
  /** Workspace-level defaults, so each row can say what "Default" resolves to. */
  defaultPortalVisibility: ClientPortalVisibility;
}) {
  const router = useRouter();

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: client.name ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    suburb: client.suburb ?? "",
    state: client.state ?? "",
    postcode: client.postcode ?? "",
    latitude: null as number | null,
    longitude: null as number | null,
    placeId: null as string | null,
    notes: client.notes ?? "",
  });
  // Tri-state per module: key absent = inherit workspace default, true = force
  // shown, false = force hidden. Kept outside `form` so the save payload can
  // always include it — sending {} is how "no overrides left" is persisted
  // (the PATCH route normalises an empty object to JsonNull).
  const [overrides, setOverrides] = useState<PortalVisibilityOverrides>({
    ...(client.portalVisibilityOverrides ?? {}),
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [welcomeNote, setWelcomeNote] = useState("");
  const [invitePin, setInvitePin] = useState("");
  const [invitePassword, setInvitePassword] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function saveEdit() {
    if (!form.name.trim()) {
      toast({ title: "Client name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          address: form.address.trim() || undefined,
          suburb: form.suburb.trim() || undefined,
          state: form.state.trim() || undefined,
          postcode: form.postcode.trim() || undefined,
          latitude: form.latitude ?? undefined,
          longitude: form.longitude ?? undefined,
          placeId: form.placeId ?? undefined,
          notes: form.notes.trim() || undefined,
          // Always sent (never undefined) so clearing the last override
          // actually persists — the API treats an empty object as "no
          // overrides" and stores JsonNull.
          portalVisibilityOverrides: overrides,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update client.");
      toast({ title: "Client updated" });
      setEditOpen(false);
      router.refresh();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update client.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite() {
    if (!invitePin.trim() && !invitePassword.trim()) {
      toast({ title: "Enter your admin PIN or password to send the invite.", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          welcomeNote: welcomeNote.trim() || undefined,
          security: {
            pin: invitePin.trim() || undefined,
            password: invitePassword.trim() || undefined,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the portal invite.");
      toast({ title: "Portal invite sent", description: `Invitation emailed to ${client.email ?? client.name}.` });
      setInviteOpen(false);
      setWelcomeNote("");
      setInvitePin("");
      setInvitePassword("");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Invite failed", description: err?.message ?? "Could not send the portal invite.", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  async function deleteClient(credentials?: { pin?: string; password?: string }) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete client.");
      toast({ title: "Client removed" });
      setDeleteOpen(false);
      router.push("/v2/admin/clients");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? "Could not delete client.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <EButton size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <PencilLine className="h-3.5 w-3.5" />
          Edit
        </EButton>
        {client.email ? (
          <EButton size="sm" variant="outline-gold" onClick={() => setInviteOpen(true)}>
            <Mail className="h-3.5 w-3.5" />
            Portal invite
          </EButton>
        ) : null}
        <EButton size="sm" variant="ghost" className="text-[hsl(var(--e-danger))]" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </EButton>
      </div>

      {/* Edit client */}
      <EModal open={editOpen} onClose={() => setEditOpen(false)} eyebrow="Clients" title="Edit client" wide>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name">
              <EInput value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </EField>
            <EField label="Email">
              <EInput type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            </EField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Phone">
              <EInput type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </EField>
            <EField label="Address">
              <EAddressInput
                value={form.address}
                placeholder="Start typing an address…"
                onChange={(text) => setForm((p) => ({ ...p, address: text }))}
                onSelect={(r) =>
                  setForm((p) => ({
                    ...p,
                    address: r.formattedAddress,
                    suburb: r.suburb ?? p.suburb,
                    state: r.state ?? p.state,
                    postcode: r.postcode ?? p.postcode,
                    latitude: r.lat,
                    longitude: r.lng,
                    placeId: r.placeId,
                  }))
                }
              />
            </EField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Suburb">
              <EInput value={form.suburb} onChange={(e) => setForm((p) => ({ ...p, suburb: e.target.value }))} />
            </EField>
            <EField label="State">
              <EInput value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} placeholder="NSW" />
            </EField>
            <EField label="Postcode">
              <EInput value={form.postcode} onChange={(e) => setForm((p) => ({ ...p, postcode: e.target.value }))} inputMode="numeric" maxLength={4} />
            </EField>
          </div>
          <EField label="Notes" hint="Internal notes about this client.">
            <ETextarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </EField>

          {/* Portal visibility overrides — tri-state per module (inherit / shown / hidden) */}
          <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.5)] p-4">
            <div>
              <p className="text-[0.8125rem] font-[550]">Portal visibility overrides</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Override the workspace portal defaults for this client only. &ldquo;Default&rdquo; follows the global setting, including future changes to it.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {CLIENT_PORTAL_OVERRIDE_FIELDS.map(([key, label]) => {
                const value = overrides[key];
                const selected = value === true ? "shown" : value === false ? "hidden" : "inherit";
                return (
                  <EField key={key} label={label}>
                    <ESelect
                      value={selected}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOverrides((prev) => {
                          // "Default" must DELETE the key, not store a boolean:
                          // a stored boolean would pin this client to today's
                          // default instead of inheriting future changes.
                          if (next === "inherit") {
                            const { [key]: _removed, ...rest } = prev;
                            return rest;
                          }
                          return { ...prev, [key]: next === "shown" };
                        });
                      }}
                    >
                      <option value="inherit">Default ({defaultPortalVisibility[key] ? "Shown" : "Hidden"})</option>
                      <option value="shown">Shown</option>
                      <option value="hidden">Hidden</option>
                    </ESelect>
                  </EField>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save client"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Portal invite — optional welcome note, security-verified like v1 */}
      <EModal open={inviteOpen} onClose={() => setInviteOpen(false)} eyebrow="Clients" title="Send portal invite">
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Emails {client.email} a portal invitation with a one-time setup link.
          </p>
          <EField label="Welcome note" hint="Optional message included in the invitation email.">
            <ETextarea value={welcomeNote} onChange={(e) => setWelcomeNote(e.target.value)} placeholder="A short personal welcome…" />
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Admin PIN" hint="Enter your PIN or your password.">
              <EInput inputMode="numeric" maxLength={12} value={invitePin} onChange={(e) => setInvitePin(e.target.value)} placeholder="••••" />
            </EField>
            <EField label="Password">
              <EInput type="password" autoComplete="current-password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
            </EField>
          </div>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={sendInvite} disabled={inviting || (!invitePin.trim() && !invitePassword.trim())}>
              {inviting ? "Sending…" : "Send invite"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Delete client — security-verified */}
      <EConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete client"
        description={`This removes ${client.name} and their portal access. Properties and job history rules from the API apply. Enter your PIN or password to continue.`}
        confirmLabel="Delete client"
        confirmPhrase="DELETE"
        requireSecurity
        loading={deleting}
        onConfirm={deleteClient}
      />
    </>
  );
}
