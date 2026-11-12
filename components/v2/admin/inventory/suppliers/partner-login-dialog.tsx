"use client";

/**
 * Link an existing laundry login to a partner, or remove one from its team,
 * from the Suppliers panel. Saves the whole team through the existing partner
 * PATCH (lib/suppliers/partner-body.ts). A laundry login belongs to exactly
 * one partner: linking someone who is on another partner's team moves them,
 * and the confirmation names the partner they leave.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";
import type { LaundryPartnerRecord, LaundryUserOption } from "@/lib/suppliers/directory-types";
import { moveConfirmText, partnerPatchBody, teamMoves } from "@/lib/suppliers/partner-body";

export type LoginChange = { mode: "link" } | { mode: "remove"; userId: string; name: string };

type Props = {
  partner: LaundryPartnerRecord;
  change: LoginChange;
  laundryUsers: LaundryUserOption[];
  partnerNames: ReadonlyMap<string, string>;
  onClose: () => void;
  onSaved: () => void;
};

export function PartnerLoginDialog({ partner, change, laundryUsers, partnerNames, onClose, onSaved }: Props) {
  const selectId = React.useId();
  const [userId, setUserId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const currentIds = partner.team.map((member) => member.id);
  const candidates = laundryUsers.filter((user) => !currentIds.includes(user.id));
  const nextIds = change.mode === "link" ? (userId ? [...currentIds, userId] : currentIds) : currentIds.filter((id) => id !== change.userId);
  const moves = change.mode === "link" && userId ? teamMoves([userId], partner.id, laundryUsers, partnerNames) : [];

  async function save() {
    if (change.mode === "link" && !userId) {
      setError("Choose a laundry login.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/laundry/suppliers/${encodeURIComponent(partner.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partnerPatchBody(partner, { teamUserIds: nextIds })),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? `Could not save (${response.status}).`);
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Nothing was changed on screen; try again.");
    } finally {
      setSaving(false);
    }
  }

  const title = change.mode === "link" ? `Link a laundry login to ${partner.name}` : `Remove ${change.name} from ${partner.name}?`;
  const action = change.mode === "remove" ? "Remove from team" : moves.length ? "Move and link" : "Link login";
  return (
    <EActionDialog
      open
      busy={saving}
      onClose={onClose}
      eyebrow="Laundry partner"
      title={title}
      footer={(
        <>
          <EButton size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" variant={change.mode === "remove" ? "danger" : "primary"} disabled={saving || (change.mode === "link" && !userId)} onClick={() => void save()}>{saving ? "Saving…" : action}</EButton>
        </>
      )}
    >
      {change.mode === "link" ? (
        <fieldset disabled={saving} className="space-y-2">
          <label htmlFor={selectId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Laundry login</label>
          {candidates.length === 0 ? (
            <p>No other laundry portal logins exist. Invite one in People first.</p>
          ) : (
            <ESelect id={selectId} value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Choose…</option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name?.trim() || user.email}{user.isActive ? "" : " (disabled)"}{user.laundrySupplierId ? ` · on ${partnerNames.get(user.laundrySupplierId) ?? "another partner"}` : ""}
                </option>
              ))}
            </ESelect>
          )}
          {moves.length ? <p role="alert" className="text-[hsl(var(--e-warning,var(--e-danger)))]">{moveConfirmText(moves, partner.name)}</p> : null}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">They receive this partner&apos;s &quot;Ask laundry team&quot; requests for runs they may see.</p>
        </fieldset>
      ) : (
        <p>The account stays; it no longer receives {partner.name}&apos;s laundry team requests.</p>
      )}
      {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
