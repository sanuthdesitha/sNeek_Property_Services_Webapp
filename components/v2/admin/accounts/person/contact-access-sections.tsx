"use client";

/**
 * Profile tab: Contact and Access, each edited in place.
 *  Contact → PATCH /api/admin/users/[id] { name, email, phone }            (ADMIN)
 *  Access  → PATCH /api/admin/users/[id] { role, clientId }                 (ADMIN)
 *            PATCH /api/admin/users { userId, profileEditOverride } when changed (ADMIN)
 * Extra roles keep their own panel and endpoint (`/roles`, ADMIN only).
 */
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { ExtraRolesPanel } from "@/components/v2/admin/accounts/extra-roles-panel";
import type { PersonCapabilities, PersonProfile, ProfileEditPolicy } from "@/lib/accounts/person-types";
import { StatusPill, formatLastSeen } from "../hub/account-display";
import { MANAGED_ROLES, isManagedRole, roleLabel } from "../hub/managed-roles";
import { EditableSection, FactList, ensureOk } from "./editable-section";

type SectionProps = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };

const FALLBACK_POLICY: ProfileEditPolicy = { canEditName: true, canEditPhone: true, canEditEmail: false };
const POLICY_FIELDS: Array<[keyof ProfileEditPolicy, string]> = [
  ["canEditName", "Can edit name"],
  ["canEditPhone", "Can edit phone"],
  ["canEditEmail", "Can edit email"],
];

type ContactDraft = { name: string; email: string; phone: string };

export function ContactSection({ profile, caps, onChanged }: SectionProps) {
  const location = [profile.location.suburb, profile.location.state, profile.location.postcode].filter(Boolean).join(" ");
  return (
    <EditableSection<ContactDraft>
      title="Contact"
      personId={profile.id}
      canEdit={caps.isAdmin}
      view={
        <FactList
          labelWidth={70}
          rows={[
            { label: "Name", value: profile.name ?? "Unnamed" },
            {
              label: "Email",
              value: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {profile.email} {profile.emailVerified ? <EPill tone="ok">Verified</EPill> : <EPill tone="warn">Not verified</EPill>}
                </span>
              ),
            },
            { label: "Phone", value: profile.phone ?? "–" },
            { label: "Suburb", value: location || profile.location.address || "–" },
            ...(profile.availability ? [{ label: "Availability", value: profile.availability }] : []),
            { label: "Last seen", value: formatLastSeen(profile.lastSeenAt, undefined, { invited: profile.status === "INVITED" }) },
          ]}
        />
      }
      makeDraft={() => ({ name: profile.name ?? "", email: profile.email, phone: profile.phone ?? "" })}
      renderEdit={(draft, setDraft) => (
        <>
          <EField label="Name"><EInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></EField>
          <EField label="Email" hint="They sign in with this."><EInput type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></EField>
          <EField label="Phone"><EInput type="tel" inputMode="tel" maxLength={16} placeholder="0451217210 or +61451217210" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></EField>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Street address is edited under Pay → Payroll &amp; identity.</p>
        </>
      )}
      save={async (draft) => {
        if (!draft.name.trim() || !draft.email.trim()) throw new Error("Name and email are required.");
        const res = await fetch(`/api/admin/users/${profile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim() || null }),
        });
        await ensureOk(res, "Could not update contact details.");
      }}
      onSaved={onChanged}
    />
  );
}

type AccessDraft = { role: string; clientId: string; overrideOn: boolean; policy: ProfileEditPolicy };

function useClientOptions(): Array<{ id: string; name: string }> {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/clients", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((body: unknown) => setClients(Array.isArray(body) ? (body as Array<{ id: string; name: string }>) : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return clients;
}

function signInLabel(profile: PersonProfile): string {
  if (profile.status === "INVITED") return "Invite not accepted";
  return profile.twoFactorEnabled ? "Password + 2FA" : "Password";
}

function policyLabel(profile: PersonProfile): string {
  if (!profile.profileEditOverride) return `${roleLabel(profile.role)} role default`;
  const allowed = POLICY_FIELDS.filter(([key]) => profile.profileEditOverride?.[key]).map(([, label]) => label.replace("Can edit ", ""));
  return `Custom: ${allowed.length ? allowed.join(", ") : "no self-service edits"}`;
}

function AccessEdit({ draft, setDraft, managed }: { draft: AccessDraft; setDraft: (next: AccessDraft) => void; managed: boolean }) {
  const clients = useClientOptions();
  return (
    <>
      {managed ? (
        <EField label="Role">
          <ESelect value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
            {MANAGED_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </ESelect>
        </EField>
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">An assistant&apos;s role and access belong to their VA team (Assistants tab).</p>
      )}
      {draft.role === "CLIENT" ? (
        <EField label="Linked client profile">
          <ESelect value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
            <option value="">Select client…</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </ESelect>
        </EField>
      ) : null}
      <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2">
        <ESwitch checked={draft.overrideOn} onCheckedChange={(on) => setDraft({ ...draft, overrideOn: on })} label="Custom profile edit permissions" />
        {draft.overrideOn
          ? POLICY_FIELDS.map(([key, label]) => (
              <ESwitch key={key} checked={draft.policy[key]} onCheckedChange={(value) => setDraft({ ...draft, policy: { ...draft.policy, [key]: value } })} label={label} />
            ))
          : <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Off: the role default from Settings applies.</p>}
      </div>
    </>
  );
}

export function AccessSection({ profile, caps, onChanged }: SectionProps) {
  const managed = isManagedRole(profile.role);
  const showExtraRoles = profile.role !== "CLIENT" && profile.role !== "VA";
  return (
    <>
      <EditableSection<AccessDraft>
        title="Access"
        personId={profile.id}
        canEdit={caps.isAdmin}
        view={
          <FactList
            labelWidth={70}
            rows={[
              {
                label: "Roles",
                value: (
                  <span className="inline-flex flex-wrap gap-1">
                    <EPill>{profile.roleLabel}</EPill>
                    {profile.extraRoles.map((extra) => <EPill key={extra.role} tone="gold">{extra.label}</EPill>)}
                  </span>
                ),
              },
              ...(profile.role === "CLIENT" ? [{ label: "Client", value: profile.client?.name ?? "Not linked" }] : []),
              { label: "Sign-in", value: signInLabel(profile) },
              { label: "Status", value: <StatusPill status={profile.status} inviteAgeDays={profile.inviteAgeDays} /> },
              { label: "Self-edit", value: policyLabel(profile) },
            ]}
          />
        }
        makeDraft={() => ({
          role: profile.role,
          clientId: profile.client?.id ?? "",
          overrideOn: profile.profileEditOverride !== null,
          policy: profile.profileEditOverride ?? profile.roleEditDefault ?? FALLBACK_POLICY,
        })}
        renderEdit={(draft, setDraft) => <AccessEdit draft={draft} setDraft={setDraft} managed={managed} />}
        save={async (draft) => {
          if (draft.role === "CLIENT" && !draft.clientId) throw new Error("A client login must be linked to a client profile.");
          if (managed && (draft.role !== profile.role || draft.clientId !== (profile.client?.id ?? ""))) {
            const res = await fetch(`/api/admin/users/${profile.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: draft.role as Role, clientId: draft.role === "CLIENT" ? draft.clientId : null }),
            });
            await ensureOk(res, "Could not update access.");
          }
          const desired = draft.overrideOn ? draft.policy : null;
          if (JSON.stringify(desired) !== JSON.stringify(profile.profileEditOverride)) {
            const res = await fetch("/api/admin/users", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: profile.id, profileEditOverride: desired }),
            });
            await ensureOk(res, "Role saved, but the profile edit permissions could not be saved.");
          }
        }}
        onSaved={onChanged}
      />
      {showExtraRoles ? (
        <ExtraRolesPanel
          key={profile.id}
          userId={profile.id}
          userName={profile.name ?? profile.email}
          primaryRole={profile.role}
          canManage={caps.isAdmin}
          initialExtraRoles={profile.extraRoles}
        />
      ) : null}
    </>
  );
}
