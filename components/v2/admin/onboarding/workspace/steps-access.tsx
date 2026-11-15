"use client";

/** Steps 4–6: access (with who sees codes), linen and laundry (with the rules that will apply), stock list. */
import * as React from "react";
import Link from "next/link";
import { Camera, Eye, Plus, Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, ESwitch } from "@/components/v2/admin/estate-kit";
import { EToneNotice, ETonePill } from "@/components/v2/ui/tone-band";
import type { AccessEntryInput, AccessValues, LaundryValues, StockValues } from "@/lib/onboarding/workspace/values";
import type { AccessEntryView, OnboardingAccessKind, OnboardingPhoto, StockStartingList } from "@/lib/onboarding/workspace/types";
import { STOCK_STARTING_LIST_LABELS, stockStartingList, suggestedStartingList } from "@/lib/onboarding/workspace/stock-lists";
import { useSectionDraft } from "./use-onboarding-workspace";
import { AutoTextField, ONB_INPUT_CLASS, onbInput, ONB_MUTED, newLocalId, numberText, parseNumberInput } from "./onboarding-kit";
import type { StepProps } from "./steps-property";

const ACCESS_KIND_LABELS: Record<OnboardingAccessKind, string> = {
  LOCKBOX: "Lockbox",
  KEYS: "Keys",
  ENTRY: "Building entry",
  ALARM: "Alarm",
  PARKING: "Parking",
  WIFI: "Wifi",
  OTHER: "Other",
};

type LocalEntry = AccessEntryView & { codeDraft?: string };

/** Upload one photo through the existing office upload route; the original is kept. */
export async function uploadOfficePhoto(file: File): Promise<OnboardingPhoto> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "onboarding-access");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.url !== "string" || typeof body.key !== "string") throw new Error(typeof body.error === "string" ? body.error : "The photo was not uploaded. Try again.");
  return { url: body.url, key: body.key, source: "ADMIN_CREATED" };
}

function toInput(entry: LocalEntry): AccessEntryInput {
  return { id: entry.id, kind: entry.kind, where: entry.where, photos: entry.photos, ...(entry.codeDraft !== undefined ? { code: entry.codeDraft } : {}) };
}

export function AccessStep({ view, values, send, surveyId, onReviewed }: StepProps<AccessValues> & { surveyId: string; onReviewed: () => void }) {
  const [entries, setEntries] = React.useState<LocalEntry[]>(values.entries);
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;
  const { draft, set, commit } = useSectionDraft<{ wifiNetwork: string; wifiPassword: string }>({ wifiNetwork: values.wifiNetwork, wifiPassword: values.wifiPassword }, send);
  const [revealed, setRevealed] = React.useState<Record<string, string>>({});
  const [busyEntry, setBusyEntry] = React.useState<string | null>(null);
  const [entryError, setEntryError] = React.useState<string | null>(null);

  // Codes in a request are sent once; afterwards the screen only knows a code exists.
  const sendEntries = (next: LocalEntry[]) => {
    send({ entries: next.map(toInput) });
    const settled = next.map((entry) => (entry.codeDraft !== undefined ? { ...entry, codeDraft: undefined, hasCode: Boolean(entry.codeDraft.trim()), codeNeedsReview: false } : entry));
    setEntries(settled);
  };
  const update = (id: string, patch: Partial<LocalEntry>) => setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  const reveal = async (entry: LocalEntry) => {
    setBusyEntry(entry.id);
    setEntryError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${surveyId}/access-codes/${entry.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reveal" }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "The code could not be shown.");
      setRevealed((current) => ({ ...current, [entry.id]: body.code ?? "" }));
      window.setTimeout(() => setRevealed((current) => { const next = { ...current }; delete next[entry.id]; return next; }), 30_000);
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "The code could not be shown.");
    } finally {
      setBusyEntry(null);
    }
  };

  const review = async (entry: LocalEntry) => {
    setBusyEntry(entry.id);
    setEntryError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${surveyId}/access-codes/${entry.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review" }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "The code was not marked as reviewed.");
      update(entry.id, { codeNeedsReview: false });
      onReviewed();
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "The code was not marked as reviewed.");
    } finally {
      setBusyEntry(null);
    }
  };

  const addPhoto = async (entry: LocalEntry, file: File) => {
    setBusyEntry(entry.id);
    setEntryError(null);
    try {
      const photo = await uploadOfficePhoto(file);
      sendEntries(entriesRef.current.map((candidate) => (candidate.id === entry.id ? { ...candidate, photos: [...candidate.photos, photo] } : candidate)));
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "The photo was not uploaded.");
    } finally {
      setBusyEntry(null);
    }
  };

  const codeKinds: OnboardingAccessKind[] = ["LOCKBOX", "ALARM", "ENTRY", "KEYS", "OTHER"];

  return (
    <div className="space-y-4">
      {view.legacyAccess.length > 0 ? (
        <EToneNotice tone="info" title="From the earlier wizard">
          {view.legacyAccess.map((detail) => `${detail.detailType.replace(/_/g, " ").toLowerCase()}${detail.hasValue ? " (saved)" : ""}${detail.photoUrl ? " · photo" : ""}`).join(", ")}. These still reach the property on activation.
          {view.legacyAlarmCodeSaved ? " An alarm code is saved there too." : ""}
        </EToneNotice>
      ) : null}
      {entryError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{entryError}</p> : null}
      {entries.length === 0 ? <p className={ONB_MUTED}>No access details yet. Add the lockbox or keys, building entry and alarm.</p> : null}
      <ul className="space-y-3">
        {entries.map((entry, index) => (
          <li key={entry.id} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Access ${index + 1} kind`} className={onbInput("w-auto")} value={entry.kind} onChange={(event) => sendEntries(entries.map((candidate) => (candidate.id === entry.id ? { ...candidate, kind: event.target.value as OnboardingAccessKind } : candidate)))}>
                {Object.entries(ACCESS_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
              </select>
              {entry.source === "CLIENT_SUBMITTED" ? <ETonePill tone="info">From client</ETonePill> : null}
              {entry.codeNeedsReview ? <ETonePill tone="attention">Code to review</ETonePill> : null}
              <EButton className="ml-auto" variant="ghost" size="icon" aria-label={`Remove ${ACCESS_KIND_LABELS[entry.kind]} details`} onClick={() => sendEntries(entries.filter((candidate) => candidate.id !== entry.id))}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </EButton>
            </div>
            <AutoTextField label="Where and how" value={entry.where} placeholder="Side gate, left of the letterboxes" onChange={(v) => update(entry.id, { where: v })} onCommit={() => sendEntries(entriesRef.current)} />
            {codeKinds.includes(entry.kind) ? (
              <div className="flex flex-wrap items-end gap-2">
                <EField label="Code" hint={entry.hasCode ? "A code is stored encrypted. Type a new one to replace it." : "Stored encrypted. Never put a code in a photo caption."} className="min-w-[12rem] flex-1">
                  <input
                    className={ONB_INPUT_CLASS}
                    type="password"
                    autoComplete="off"
                    value={entry.codeDraft ?? ""}
                    placeholder={entry.hasCode ? "••••" : "Not set"}
                    onChange={(event) => update(entry.id, { codeDraft: event.target.value })}
                    onBlur={() => { if (entriesRef.current.find((candidate) => candidate.id === entry.id)?.codeDraft !== undefined) sendEntries(entriesRef.current); }}
                  />
                </EField>
                {entry.hasCode && entry.codeDraft === undefined ? (
                  <EButton variant="outline" size="sm" disabled={busyEntry === entry.id} onClick={() => void reveal(entry)}>
                    <Eye className="h-4 w-4" aria-hidden /> {revealed[entry.id] !== undefined ? revealed[entry.id] || "(empty)" : "Show"}
                  </EButton>
                ) : null}
                {entry.codeNeedsReview ? (
                  <EButton variant="primary" size="sm" disabled={busyEntry === entry.id} onClick={() => void review(entry)}>Mark code reviewed</EButton>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {entry.photos.map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.key} src={photo.url} alt={`${ACCESS_KIND_LABELS[entry.kind]} photo`} className="h-16 w-16 rounded-[var(--e-radius)] object-cover" />
              ))}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))]">
                <Camera className="h-4 w-4" aria-hidden /> {busyEntry === entry.id ? "Uploading…" : "Photo"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busyEntry === entry.id} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addPhoto(entry, file); }} />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <EButton variant="outline" size="sm" onClick={() => sendEntries([...entries, { id: newLocalId("access"), kind: entries.some((entry) => entry.kind === "LOCKBOX") ? "ENTRY" : "LOCKBOX", where: "", photos: [], source: "ADMIN_CREATED", codeReviewedAt: null, codeReviewedById: null, hasCode: false, codeNeedsReview: false }])}>
        <Plus className="h-4 w-4" aria-hidden /> Add access detail
      </EButton>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AutoTextField label="Wifi network" value={draft.wifiNetwork} onChange={(v) => set("wifiNetwork", v)} onCommit={() => commit("wifiNetwork")} />
        <AutoTextField label="Wifi password" value={draft.wifiPassword} onChange={(v) => set("wifiPassword", v)} onCommit={() => commit("wifiPassword")} />
      </div>
      <section aria-labelledby="who-sees-codes" className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <h3 id="who-sees-codes" className="bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem] font-[600]">Who sees codes</h3>
        <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
          <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]"><dt className="font-[550]">Assigned cleaner</dt><dd>From accepting the job until the end of the day after the clean (existing rule).</dd></div>
          <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]"><dt className="font-[550]">Maintenance worker</dt><dd>Only when the office shares access on their item (existing).</dd></div>
          <div className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]"><dt className="font-[550]">Laundry partner</dt><dd>As today: the access guide entries, never the stored lockbox, door or alarm codes. A run-day lockbox window is not offered: the existing access model has no time window for laundry.</dd></div>
        </dl>
      </section>
    </div>
  );
}

type Supplier = { id: string; name: string };

export function LaundryStep({ view, values, send }: StepProps<LaundryValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<LaundryValues>(values, send);
  const [suppliers, setSuppliers] = React.useState<Supplier[] | null>(null);
  const [suppliersError, setSuppliersError] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/laundry/suppliers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body)) throw new Error("load");
        setSuppliers(body as Supplier[]);
      })
      .catch(() => { if (!controller.signal.aborted) setSuppliersError(true); });
    return () => controller.abort();
  }, []);
  const rules = view.laundryRules;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <EField label="Laundry service">
          <select className={ONB_INPUT_CLASS} value={draft.hasLaundry === null ? "" : draft.hasLaundry ? "on" : "off"} onChange={(event) => setAndCommit("hasLaundry", event.target.value === "" ? null : event.target.value === "on")}>
            <option value="">Not answered</option>
            <option value="on">On</option>
            <option value="off">Off, no laundry service</option>
          </select>
        </EField>
        <EField label="Partner" hint={suppliersError ? "The partner list could not be loaded." : undefined}>
          <select className={ONB_INPUT_CLASS} value={draft.laundrySupplierId ?? ""} disabled={suppliers === null} onChange={(event) => setAndCommit("laundrySupplierId", event.target.value || null)}>
            <option value="">{suppliers === null && !suppliersError ? "Loading…" : "No partner chosen"}</option>
            {(suppliers ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            {draft.laundrySupplierId && suppliers && !suppliers.some((supplier) => supplier.id === draft.laundrySupplierId) ? <option value={draft.laundrySupplierId}>{view.laundryPartnerName ?? "Saved partner"}</option> : null}
          </select>
        </EField>
        <EField label="Detergent">
          <select className={ONB_INPUT_CLASS} value={draft.detergentType} onChange={(event) => setAndCommit("detergentType", event.target.value)}>
            <option value="">Not set</option>
            <option value="STANDARD">Standard</option>
            <option value="HYPOALLERGENIC">Hypoallergenic</option>
            <option value="ECO">Eco</option>
            <option value="CLIENT_PROVIDED">Client provided</option>
          </select>
        </EField>
        <AutoTextField label="Linen sets on site" inputMode="numeric" value={numberText(draft.linenSets)} onChange={(v) => set("linenSets", parseNumberInput(v))} onCommit={() => commit("linenSets")} />
        <AutoTextField label="Spare (buffer) sets" inputMode="numeric" value={numberText(draft.linenBufferSets)} onChange={(v) => set("linenBufferSets", parseNumberInput(v))} onCommit={() => commit("linenBufferSets")} />
        <AutoTextField label="Bag colour" value={draft.bagColor} onChange={(v) => set("bagColor", v)} onCommit={() => commit("bagColor")} />
        <AutoTextField label="Bag label" value={draft.bagLabel} onChange={(v) => set("bagLabel", v)} onCommit={() => commit("bagLabel")} />
      </div>
      <section aria-labelledby="laundry-rules" className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[hsl(var(--e-band-info-bg))] px-3 py-2">
          <div>
            <h3 id="laundry-rules" className="text-[0.8125rem] font-[600]">Rules that will plan this property&apos;s runs</h3>
            <p className="text-[0.75rem] text-[hsl(var(--e-band-info-muted))]">{rules.state === "ok" ? `Scheduling rules, live version ${rules.version} · read only here` : "Read only here"}</p>
          </div>
          <EButton asChild variant="ghost" size="sm"><Link href="/v2/admin/settings?tab=scheduling-rules">Open rules</Link></EButton>
        </div>
        {rules.state === "ok" ? (
          <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
            {rules.lines.map((line) => <li key={line} className="px-3 py-2">{line}</li>)}
            {typeof draft.linenBufferSets === "number" ? <li className="px-3 py-2">This property: {draft.linenBufferSets} spare set{draft.linenBufferSets === 1 ? "" : "s"} on activation.</li> : null}
          </ul>
        ) : (
          <p role="alert" className="px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">The scheduling rules could not be read: {rules.reason}</p>
        )}
      </section>
    </div>
  );
}

export function StockStep({ view, values, send }: StepProps<StockValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<StockValues>(values, send);
  const suggested = suggestedStartingList(view.values.rooms.bedrooms);
  const applyList = (list: StockStartingList) => {
    const rows = stockStartingList(list);
    set("startFrom", list);
    set("rows", rows);
    send({ startFrom: list, rows });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ESwitch checked={draft.consumablesProvided} onCheckedChange={(checked) => setAndCommit("consumablesProvided", checked)} label="We restock consumables · the property tracks stock" />
      </div>
      {draft.consumablesProvided ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[0.8125rem] font-[550]" htmlFor="stock-start-from">Start from</label>
            <select id="stock-start-from" className={onbInput("w-auto")} value={draft.startFrom ?? ""} onChange={(event) => { if (event.target.value) applyList(event.target.value as StockStartingList); }}>
              <option value="">Choose a standard list…</option>
              {(Object.keys(STOCK_STARTING_LIST_LABELS) as StockStartingList[]).map((list) => (
                <option key={list} value={list}>{STOCK_STARTING_LIST_LABELS[list]}{list === suggested ? " (matches the bedrooms)" : ""}</option>
              ))}
            </select>
          </div>
          {draft.rows.length === 0 ? <p className={ONB_MUTED}>No stock list yet. Without one, activation creates the full default set as today.</p> : (
            <div role="region" aria-label="Stock list" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full min-w-[30rem] text-[0.8125rem]">
                <thead className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <tr><th className="px-3 py-2 font-[550]">Item</th><th className="px-3 py-2 font-[550]">Par level</th><th className="px-3 py-2 font-[550]">Reorder at</th><th className="px-3 py-2 font-[550]">On hand</th><th className="px-3 py-2"><span className="sr-only">Remove</span></th></tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--e-border))]">
                  {draft.rows.map((row) => (
                    <tr key={row.sku}>
                      <td className="px-3 py-1.5">{row.name} <span className={ONB_MUTED}>({row.unit})</span></td>
                      <td className="px-3 py-1.5"><input aria-label={`${row.name} par level`} inputMode="numeric" className={onbInput("w-20")} value={numberText(row.parLevel)} onChange={(event) => set("rows", draft.rows.map((r) => (r.sku === row.sku ? { ...r, parLevel: parseNumberInput(event.target.value) } : r)))} onBlur={() => commit("rows")} /></td>
                      <td className="px-3 py-1.5"><input aria-label={`${row.name} reorder level`} inputMode="numeric" className={onbInput("w-20")} value={numberText(row.reorderAt)} onChange={(event) => set("rows", draft.rows.map((r) => (r.sku === row.sku ? { ...r, reorderAt: parseNumberInput(event.target.value) } : r)))} onBlur={() => commit("rows")} /></td>
                      <td className={`px-3 py-1.5 ${ONB_MUTED}`}>Not counted yet</td>
                      <td className="px-3 py-1.5 text-right"><EButton variant="ghost" size="icon" aria-label={`Remove ${row.name}`} onClick={() => setAndCommit("rows", draft.rows.filter((r) => r.sku !== row.sku))}><Trash2 className="h-4 w-4" aria-hidden /></EButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={ONB_MUTED}>Rows are created on activation with these par and reorder levels. The property&apos;s stock record has no &quot;not counted&quot; value, so on hand starts at the par level, as the existing default stock does, until the first count.</p>
        </>
      ) : (
        <p className={ONB_MUTED}>Off: the property does not track stock and no stock rows are created.</p>
      )}
    </div>
  );
}
