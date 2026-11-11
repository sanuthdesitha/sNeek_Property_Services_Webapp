"use client";

/**
 * "Invite person": the create-account dialog moved here unchanged from the old
 * staff manager. Email invitation or set password; role; linked client for a
 * client login; ABN for client and laundry; bank details for cleaner and
 * laundry. Same `POST /api/admin/users` and payload. ADMIN only (the route
 * refuses anyone else, so the button is not shown to them).
 */
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { BankFields, type BankDraft, EMPTY_BANK } from "../person/bank-fields";
import { MANAGED_ROLES, roleLabel, type ManagedRole } from "./managed-roles";

type CreateForm = { name: string; email: string; phone: string; role: ManagedRole; clientId: string; password: string; abn: string; bank: BankDraft };
type ClientOption = { id: string; name: string };
type CreatedInvitation = { email: string; link: string; emailSent: boolean };

function emptyForm(role: ManagedRole): CreateForm {
  return { name: "", email: "", phone: "", role, clientId: "", password: "", abn: "", bank: { ...EMPTY_BANK } };
}

export function InvitePersonDialog({ open, defaultRole, onClose, onCreated }: { open: boolean; defaultRole: ManagedRole; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [form, setForm] = useState<CreateForm>(() => emptyForm(defaultRole));
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(defaultRole));
    setCreated(null);
    setError(null);
    const controller = new AbortController();
    fetch("/api/admin/clients", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((body: unknown) => setClients(Array.isArray(body) ? (body as ClientOption[]) : []))
      .catch(() => {
        if (!controller.signal.aborted) setClients([]);
      });
    return () => controller.abort();
  }, [open, defaultRole]);

  function patch(next: Partial<CreateForm>) {
    setForm((current) => ({ ...current, ...next }));
  }

  async function create() {
    if (!form.name.trim() || !form.email.trim()) return setError("Name and email are required.");
    if (mode === "password" && !form.password) return setError("Password is required in set-password mode.");
    if (form.role === "CLIENT" && !form.clientId) return setError("Client accounts must be linked to a client profile.");
    setCreating(true);
    setError(null);
    try {
      const wantsAbn = form.role === "CLIENT" || form.role === "LAUNDRY";
      const wantsBank = form.role === "CLEANER" || form.role === "LAUNDRY";
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        invite: mode === "invite",
        role: form.role,
        phone: form.phone.trim() || undefined,
        clientId: form.role === "CLIENT" ? form.clientId : undefined,
        abn: wantsAbn ? form.abn.trim() || undefined : undefined,
        bankDetails: wantsBank
          ? { accountName: form.bank.accountName.trim(), bankName: form.bank.bankName.trim(), bsb: form.bank.bsb.trim(), accountNumber: form.bank.accountNumber.trim() }
          : undefined,
      };
      if (mode === "password") payload.password = form.password;
      const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string; invitationLink?: string; invitationEmailSent?: boolean };
      if (!res.ok) throw new Error(body.error ?? "Failed to create account.");
      onCreated();
      if (mode === "invite" && body.invitationLink) {
        setCreated({ email: body.email ?? form.email.trim(), link: body.invitationLink, emailSent: !!body.invitationEmailSent });
        try {
          await navigator.clipboard.writeText(body.invitationLink);
        } catch {
          /* clipboard not granted — the link is shown on screen */
        }
        toast({ title: body.invitationEmailSent ? "Invitation sent" : "Account created", variant: body.invitationEmailSent ? "default" : "destructive" });
      } else {
        toast({ title: "Account created", description: "The account is active immediately and can sign in now." });
        onClose();
      }
      setForm(emptyForm(defaultRole));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} eyebrow="Accounts" title="Invite person" wide>
      {created ? (
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Invitation for <span className="font-[550]">{created.email}</span>{" "}
            {created.emailSent ? "was emailed and is" : "could not be emailed — share this link manually; it is"} copied to your clipboard.
          </p>
          <div className="break-all rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5 text-[0.8125rem]">{created.link}</div>
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setCreated(null)}>Invite another</EButton>
            <EButton variant="primary" size="sm" onClick={onClose}>Done</EButton>
          </div>
        </div>
      ) : (
        <fieldset disabled={creating} className="space-y-4">
          <div role="group" aria-label="How they sign in" className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
            {(["invite", "password"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={
                  "rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] " +
                  (mode === option ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]")
                }
              >
                {option === "invite" ? "Email invitation" : "Set password"}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name"><EInput value={form.name} onChange={(e) => patch({ name: e.target.value })} /></EField>
            <EField label="Email"><EInput type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} /></EField>
            <EField label="Phone" hint="Optional.">
              <EInput type="tel" inputMode="tel" maxLength={16} placeholder="0451217210 or +61451217210" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} />
            </EField>
            <EField label="Role">
              <ESelect value={form.role} onChange={(e) => patch({ role: e.target.value as ManagedRole })}>
                {MANAGED_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </ESelect>
            </EField>
          </div>
          {form.role === "CLIENT" ? (
            <EField label="Linked client profile">
              <ESelect value={form.clientId} onChange={(e) => patch({ clientId: e.target.value })}>
                <option value="">Select client…</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </ESelect>
            </EField>
          ) : null}
          {form.role === "CLIENT" || form.role === "LAUNDRY" ? (
            <EField label="ABN" hint="Optional. 11 digits.">
              <EInput inputMode="numeric" maxLength={14} placeholder="11 digits" value={form.abn} onChange={(e) => patch({ abn: e.target.value })} />
            </EField>
          ) : null}
          {form.role === "CLEANER" || form.role === "LAUNDRY" ? (
            <BankFields title="Bank details (optional)" value={form.bank} onChange={(bank) => patch({ bank })} />
          ) : null}
          {mode === "password" ? (
            <EField label="Password" hint="The account is active immediately with this password.">
              <EInput type="password" autoComplete="new-password" value={form.password} onChange={(e) => patch({ password: e.target.value })} />
            </EField>
          ) : (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">An invitation email with a one-time setup link is sent to the new account.</p>
          )}
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
            <EButton variant="primary" size="sm" onClick={create}>{creating ? "Creating…" : mode === "invite" ? "Send invitation" : "Create account"}</EButton>
          </div>
        </fieldset>
      )}
    </EModal>
  );
}
