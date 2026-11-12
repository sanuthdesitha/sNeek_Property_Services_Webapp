"use client";

/**
 * Rail cards "Access" and "Laundry", each with its own Edit. Access edits the
 * same fields the old profile form did (lockbox, door code, parking, other,
 * instructions); the door code is shown masked until "Show" and goes to the
 * encrypted column. Laundry edits the laundry partners (allocation), bag label
 * and bag colour. Both send only their own keys; accessInfo is merged server
 * side, so the other keys (attachments, onboarding) survive.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import { LaundryBagColorPicker } from "../property-setup-guide-editor";
import { KeyValues, Muted, SectionCard } from "./section-card";
import { accessText, laundryTeamIds, legacyCodeCarry, type PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";

type Save = (patch: Record<string, unknown>) => Promise<SaveResult>;

function MaskedCode({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-mono">{shown ? code : "••••"}</span>
      <EButton size="sm" variant="ghost" onClick={() => setShown((value) => !value)} aria-label={shown ? "Hide door code" : "Show door code"}>{shown ? "Hide" : "Show"}</EButton>
    </span>
  );
}

type AccessDraft = { lockbox: string; code: string; parking: string; other: string; instructions: string };

export function AccessCard({ property, overview, save, onOpenGuide }: { property: PropertyRecord; overview: PropertyOverview | null; save: Save; onOpenGuide: () => void }) {
  const storedCode = property.accessCode ?? accessText(property, "codes");
  const guideSteps = Array.isArray(property.accessGuide) ? property.accessGuide.length : 0;
  const value = (text: string) => (text.trim() ? text : <Muted>Not recorded</Muted>);
  return (
    <SectionCard<AccessDraft>
      title="Access"
      view={
        <>
          <KeyValues
            rows={[
              ["Lockbox", value(accessText(property, "lockbox"))],
              ["Door code", storedCode ? <MaskedCode code={storedCode} /> : <Muted>Not recorded</Muted>],
              ["Parking", value(accessText(property, "parking"))],
              ["Other", value(accessText(property, "other"))],
              ["Instructions", value(accessText(property, "instructions"))],
            ]}
          />
          <div className="border-t border-[hsl(var(--e-border))]" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
            {overview ? (
              <span>NFC check-in tags: <b>{overview.nfc.active}</b>{overview.nfc.labels.length > 0 ? ` (${overview.nfc.labels.join(", ")})` : ""}</span>
            ) : <Muted>NFC check-in tags: –</Muted>}
            {overview ? <EPill tone={overview.nfc.required ? "ok" : "neutral"}>{overview.nfc.required ? "Required to clock in" : "Not required to clock in"}</EPill> : null}
          </div>
          <button type="button" className="self-start text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={onOpenGuide}>
            Access guide, {guideSteps} {guideSteps === 1 ? "step" : "steps"}
          </button>
        </>
      }
      initialDraft={() => ({
        lockbox: accessText(property, "lockbox"),
        code: storedCode ?? "",
        parking: accessText(property, "parking"),
        other: accessText(property, "other"),
        instructions: accessText(property, "instructions"),
      })}
      form={(draft, setDraft) => (
        <>
          <EField label="Lockbox"><EInput value={draft.lockbox} onChange={(e) => setDraft({ lockbox: e.target.value })} /></EField>
          <EField label="Door code" hint="Stored encrypted"><EInput value={draft.code} autoComplete="off" onChange={(e) => setDraft({ code: e.target.value })} /></EField>
          <EField label="Parking"><EInput value={draft.parking} onChange={(e) => setDraft({ parking: e.target.value })} /></EField>
          <EField label="Other"><EInput value={draft.other} onChange={(e) => setDraft({ other: e.target.value })} /></EField>
          <EField label="Access instructions"><ETextarea value={draft.instructions} onChange={(e) => setDraft({ instructions: e.target.value })} /></EField>
        </>
      )}
      onSave={(draft) => {
        // Every key this card owns is sent explicitly so a field can be cleared.
        const patch: Record<string, unknown> = {
          accessInfo: { lockbox: draft.lockbox, parking: draft.parking, other: draft.other, instructions: draft.instructions },
        };
        // The code is sent when it changed, or when it still lives only in the legacy JSON (moves it to the encrypted column).
        if (draft.code !== (storedCode ?? "") || (!property.accessCode && accessText(property, "codes"))) patch.accessCode = draft.code;
        return save(patch);
      }}
      savedMessage="Access saved"
    />
  );
}

type LaundryAccount = { id: string; name: string; email: string };

function useLaundryAccounts(): LaundryAccount[] {
  const [accounts, setAccounts] = useState<LaundryAccount[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/users?role=LAUNDRY", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown) => {
        if (controller.signal.aborted || !Array.isArray(rows)) return;
        setAccounts(rows.filter((row) => row?.id).map((row) => ({ id: String(row.id), name: String(row.name ?? row.email ?? row.id), email: String(row.email ?? "") })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return accounts;
}

function PartnerPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const accounts = useLaundryAccounts();
  if (accounts.length === 0) return <Muted>No laundry users found. Add laundry staff, or turn Laundry service off for this property.</Muted>;
  return (
    <div className="grid gap-2">
      {accounts.map((account) => (
        <label key={account.id} className="flex min-h-[44px] items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
          <input type="checkbox" className="accent-[hsl(var(--e-primary))]" checked={value.includes(account.id)} onChange={() => onChange(value.includes(account.id) ? value.filter((id) => id !== account.id) : [...value, account.id])} />
          <span className="min-w-0"><span className="font-[550]">{account.name}</span> <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{account.email}</span></span>
        </label>
      ))}
      {value.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">No partners allocated — every active laundry user can see this property and all of them are notified.</p> : null}
    </div>
  );
}

type LaundryDraft = { team: string[]; bagLabel: string; bagColor: string };

export function LaundryCard({ property, overview, save }: { property: PropertyRecord; overview: PropertyOverview | null; save: Save }) {
  const laundry = overview?.laundry ?? null;
  const enabled = property.laundryEnabled !== false;
  const partners = laundry
    ? laundry.partners.length === 0
      ? <Muted>None allocated (every laundry account sees it)</Muted>
      : laundry.partners.map((partner) => (partner.partnerName ? `${partner.partnerName} · ${partner.name}` : partner.name) + (partner.active ? "" : " (inactive)")).join(", ")
    : "–";
  return (
    <SectionCard<LaundryDraft>
      title="Laundry"
      view={
        <>
          {enabled ? (
            <KeyValues
              rows={[
                ["Partners", partners],
                ["Bag", property.laundryBagLabel || property.laundryBagColor ? <>{property.laundryBagColor ? <span aria-hidden className="mr-1 inline-block h-2.5 w-2.5 rounded-[3px] align-middle" style={{ backgroundColor: property.laundryBagColor }} /> : null}{[property.laundryBagColor, property.laundryBagLabel ? `label ${property.laundryBagLabel}` : null].filter(Boolean).join(", ")}</> : <Muted>Not set</Muted>],
                ["Driver access", "Same as cleaners, plus laundry-only guide steps"],
              ]}
            />
          ) : (
            <Muted>Laundry service is off for this property (Service settings).</Muted>
          )}
          <Link className="self-start text-[0.8125rem] text-[hsl(var(--e-primary))] underline" href="/v2/admin/laundry">Open in Laundry</Link>
        </>
      }
      initialDraft={() => ({ team: laundryTeamIds(property), bagLabel: property.laundryBagLabel ?? "", bagColor: property.laundryBagColor ?? "" })}
      form={(draft, setDraft) => (
        <>
          {enabled ? <EField label="Laundry partners"><PartnerPicker value={draft.team} onChange={(team) => setDraft({ team })} /></EField> : null}
          <EField label="Laundry bag label" hint='e.g. "J04"'><EInput value={draft.bagLabel} onChange={(e) => setDraft({ bagLabel: e.target.value })} /></EField>
          <EField label="Laundry bag colour"><LaundryBagColorPicker value={draft.bagColor} onChange={(color) => setDraft({ bagColor: color })} /></EField>
        </>
      )}
      onSave={(draft) =>
        save({
          ...(enabled ? { accessInfo: { laundryTeamUserIds: draft.team }, ...legacyCodeCarry(property) } : {}),
          laundryBagLabel: draft.bagLabel.trim() || null,
          laundryBagColor: draft.bagColor || null,
        })
      }
      savedMessage="Laundry saved"
    />
  );
}
