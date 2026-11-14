"use client";

/**
 * Add client (board "Add client", 2026-11-16). In the order the office thinks:
 * who they are (with a similar-client notice that only warns), billing
 * (address, payment terms, an existing Xero contact when Xero is connected,
 * internal notes), portal and messages (an invitation-link portal login and
 * the client's notification preferences), then what to do next. The summary
 * says what one press of Add client creates and sends. Same endpoint
 * (POST /api/admin/clients); the result never claims the invitation was opened.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { invitationEmailSentence, type AccountCreateOutcome } from "@/lib/accounts/create-account-rules";
import { LinkBox, newIdempotencyKey, ResultNotice, StepCard, SummaryRail } from "@/components/v2/admin/accounts/invite/form-parts";

type NextStep = "onboarding" | "quote" | null;

type NotificationDraft = { jobUpdates: boolean; enRoute: boolean; startFinish: boolean; liveLocation: boolean };

type ClientDraft = {
  name: string;
  email: string;
  phone: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  /** "default" or a number of days as text. */
  terms: string;
  xeroContactId: string;
  xeroContactName: string;
  notes: string;
  portalLogin: boolean;
  notifications: NotificationDraft;
  next: NextStep;
};

type DuplicateHit = { id: string; name: string; sentence: string };

type XeroContact = { id: string; name: string; email: string | null };

type XeroSearch =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; contacts: XeroContact[]; reason: string | null }
  | { status: "failed"; reason: string };

type AddResult =
  | { kind: "added"; clientId: string; name: string; login: AccountCreateOutcome | null; replayed: boolean; link: string | null; linkError: string | null }
  | { kind: "error"; message: string; field: string | null };

const TERM_CHOICES = [0, 7, 14, 21, 30, 45, 60];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^(?:04\d{8}|\+614\d{8})$/;

const INITIAL: ClientDraft = {
  name: "",
  email: "",
  phone: "",
  address: "",
  suburb: "",
  state: "",
  postcode: "",
  latitude: null,
  longitude: null,
  placeId: null,
  terms: "default",
  xeroContactId: "",
  xeroContactName: "",
  notes: "",
  portalLogin: true,
  notifications: { jobUpdates: true, enRoute: true, startFinish: true, liveLocation: false },
  next: "onboarding",
};

function termsLabel(terms: string, defaultDays: number): string {
  if (terms === "default") return `${defaultDays}-day terms (default)`;
  return terms === "0" ? "due on receipt" : `${terms}-day terms`;
}

export function NewClientForm({
  defaultTermsDays,
  canEditTerms,
  xeroConnected,
  loginRefusal,
}: {
  defaultTermsDays: number;
  canEditTerms: boolean;
  xeroConnected: boolean;
  /** Why this person may not create a portal login here (testing as someone), or null. */
  loginRefusal: string | null;
}) {
  const [draft, setDraft] = useState<ClientDraft>(() => ({ ...INITIAL, portalLogin: loginRefusal === null }));
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<AddResult | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateHit[]>([]);
  const [xeroQuery, setXeroQuery] = useState("");
  const [xeroSearch, setXeroSearch] = useState<XeroSearch>({ status: "idle" });
  const keyRef = useRef(newIdempotencyKey());

  function patch(next: Partial<ClientDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    keyRef.current = newIdempotencyKey();
  }

  function patchNotifications(next: Partial<NotificationDraft>) {
    setDraft((current) => ({ ...current, notifications: { ...current.notifications, ...next } }));
    keyRef.current = newIdempotencyKey();
  }

  // Similar clients (warn only): obsolete reads are cancelled; a late answer never fills newer input.
  useEffect(() => {
    const name = draft.name.trim();
    const email = draft.email.trim();
    const phone = draft.phone.trim();
    if (name.length < 3 && !EMAIL_PATTERN.test(email) && phone.length < 8) {
      setDuplicates([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ name, email, phone });
        const res = await fetch(`/api/admin/clients/duplicates?${query.toString()}`, { signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as { matches?: DuplicateHit[] };
        if (controller.signal.aborted) return;
        setDuplicates(res.ok && Array.isArray(body.matches) ? body.matches : []);
      } catch {
        if (!controller.signal.aborted) setDuplicates([]);
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.name, draft.email, draft.phone]);

  const xeroAbort = useRef<AbortController | null>(null);
  async function searchXero() {
    const q = xeroQuery.trim() || draft.name.trim();
    if (q.length < 2) return setXeroSearch({ status: "failed", reason: "Type at least two letters to search Xero." });
    xeroAbort.current?.abort();
    const controller = new AbortController();
    xeroAbort.current = controller;
    setXeroSearch({ status: "searching" });
    try {
      const res = await fetch(`/api/admin/clients/xero-contacts?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      const body = (await res.json().catch(() => ({}))) as { contacts?: XeroContact[]; reason?: string | null; error?: string };
      if (controller.signal.aborted) return;
      if (!res.ok) return setXeroSearch({ status: "failed", reason: body.error ?? "Xero could not be searched." });
      setXeroSearch({ status: "done", contacts: body.contacts ?? [], reason: body.reason ?? null });
    } catch {
      if (!controller.signal.aborted) setXeroSearch({ status: "failed", reason: "Xero could not be searched." });
    }
  }

  const email = draft.email.trim();
  const phone = draft.phone.replace(/\s+/g, "");
  const fieldErrors: Record<string, string> = {};
  if (!draft.name.trim()) fieldErrors.name = "Add the client's name.";
  if (email && !EMAIL_PATTERN.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (draft.portalLogin && !email) fieldErrors.email = "A portal login needs an email. Add one, or switch the login off.";
  if (phone && !MOBILE_PATTERN.test(phone)) fieldErrors.phone = "Phone accepts 0451 217 210 or +61 451 217 210.";
  const issues = Object.keys(fieldErrors).length;
  const shownError = (field: string) => (touched ? fieldErrors[field] : undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (saving || issues > 0) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: email || undefined,
          phone: phone || undefined,
          address: draft.address || undefined,
          suburb: draft.suburb || undefined,
          state: draft.state || undefined,
          postcode: draft.postcode || undefined,
          latitude: draft.latitude,
          longitude: draft.longitude,
          placeId: draft.placeId,
          notes: draft.notes.trim() || undefined,
          paymentTermsDays: canEditTerms && draft.terms !== "default" ? Number(draft.terms) : undefined,
          xeroContactId: draft.xeroContactId || undefined,
          sendPortalInvite: draft.portalLogin,
          notifications: draft.notifications,
          idempotencyKey: keyRef.current,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string; field?: string | null; login?: AccountCreateOutcome | null; replayed?: boolean };
      if (!res.ok || !body.id) {
        setResult({ kind: "error", message: `${body.error ?? "The client could not be added."} Nothing was added.`, field: body.field ?? null });
        return;
      }
      const login = body.login ?? null;
      let link: string | null = null;
      let linkError: string | null = null;
      if (login && login.email.state !== "ACCEPTED") {
        const read = await readLink(login.user.id);
        link = read.link;
        linkError = read.error;
      }
      setResult({ kind: "added", clientId: body.id, name: body.name ?? draft.name.trim(), login, replayed: body.replayed === true, link, linkError });
    } catch {
      setResult({ kind: "error", message: "The request did not reach the server. Your entries are kept; try again.", field: null });
    } finally {
      setSaving(false);
    }
  }

  async function readLink(userId: string): Promise<{ link: string | null; error: string | null }> {
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails/invitation-link`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { link?: string; error?: string };
      return res.ok && body.link ? { link: body.link, error: null } : { link: null, error: body.error ?? "The link could not be read." };
    } catch {
      return { link: null, error: "The link could not be read." };
    }
  }

  async function copyLink() {
    if (result?.kind !== "added" || !result.login) return;
    const read = result.link ? { link: result.link, error: null } : await readLink(result.login.user.id);
    if (read.link) {
      try {
        await navigator.clipboard.writeText(read.link);
      } catch {
        /* the link stays on screen */
      }
    }
    setResult((current) => (current?.kind === "added" ? { ...current, link: read.link, linkError: read.error } : current));
  }

  if (result?.kind === "added") {
    return <AddedResult result={result} next={draft.next} onCopy={copyLink} />;
  }

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <fieldset disabled={saving} className="min-w-0 space-y-5">
        <legend className="sr-only">New client</legend>
        {result?.kind === "error" ? (
          <ResultNotice tone="problem" title="Not added" subtitle="Your entries are kept" pill="Failed" live="assertive">
            <p>{result.message}</p>
          </ResultNotice>
        ) : null}

        <StepCard id="client-who" step={1} title="Who they are" done={Boolean(draft.name.trim()) && !fieldErrors.email && !fieldErrors.phone}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <EField label={<>Client name <span aria-hidden className="text-[hsl(var(--e-danger))]">*</span></>} hint={shownError("name")}>
              <EInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Seaside Hosting" aria-required="true" aria-invalid={Boolean(shownError("name"))} className="max-sm:text-[16px]" />
            </EField>
            <EField label="Email" hint={shownError("email") ?? "Needed for a portal login and invoices"}>
              <EInput type="email" value={draft.email} onChange={(e) => patch({ email: e.target.value })} placeholder="owner@example.com" aria-invalid={Boolean(shownError("email"))} className={`max-sm:text-[16px] ${shownError("email") ? "border-[hsl(var(--e-danger))]" : ""}`} />
            </EField>
            <EField label="Phone" hint={shownError("phone")}>
              <EInput type="tel" inputMode="tel" maxLength={16} value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="0412 778 230" aria-invalid={Boolean(shownError("phone"))} className="max-sm:text-[16px]" />
            </EField>
          </div>
          {duplicates.length > 0 ? (
            <div role="status" className={`mt-3 rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem] ${toneNoticeClass("attention")}`}>
              {duplicates.map((hit) => (
                <p key={hit.id}>
                  <span className="font-semibold">Similar client:</span> {hit.sentence}{" "}
                  <Link className="underline" href={`/v2/admin/clients/${hit.id}`}>Open {hit.name}</Link> or carry on if this is a different business.
                </p>
              ))}
            </div>
          ) : null}
        </StepCard>

        <StepCard id="client-billing" step={2} title="Billing" done>
          <EField label="Billing address" hint={draft.placeId ? `From the address search: suburb ${draft.suburb || "–"}, state ${draft.state || "–"}, postcode ${draft.postcode || "–"}, map position saved.` : "Pick from the suggestions to save suburb, state, postcode and the map position."}>
            <EAddressInput
              value={draft.address}
              placeholder="Start typing an address…"
              onChange={(text) => patch({ address: text, placeId: null, latitude: null, longitude: null })}
              onSelect={(found) =>
                patch({
                  address: found.formattedAddress,
                  suburb: found.suburb ?? draft.suburb,
                  state: found.state ?? draft.state,
                  postcode: found.postcode ?? draft.postcode,
                  latitude: found.lat,
                  longitude: found.lng,
                  placeId: found.placeId,
                })
              }
            />
          </EField>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <EField label="Payment terms" hint={canEditTerms ? "Issued invoices keep the terms they were sent with." : "Only an administrator, or an operations manager who manages finance, can set terms. The default applies."}>
              <ESelect value={draft.terms} disabled={!canEditTerms} onChange={(e) => patch({ terms: e.target.value })} className="max-sm:text-[16px]">
                <option value="default">{defaultTermsDays} days (default)</option>
                {TERM_CHOICES.filter((days) => days !== defaultTermsDays).map((days) => (
                  <option key={days} value={String(days)}>{days === 0 ? "Due on receipt" : `${days} days`}</option>
                ))}
              </ESelect>
            </EField>
            <XeroContactField
              connected={xeroConnected}
              canLink={canEditTerms}
              draft={draft}
              query={xeroQuery}
              onQuery={setXeroQuery}
              search={xeroSearch}
              onSearch={searchXero}
              onPick={(contact) => patch({ xeroContactId: contact?.id ?? "", xeroContactName: contact?.name ?? "" })}
            />
            <EField label="Internal notes">
              <EInput value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Referred by…" className="max-sm:text-[16px]" />
            </EField>
          </div>
        </StepCard>

        <StepCard id="client-portal" step={3} title="Portal and messages" done>
          <div className="flex flex-wrap items-start justify-between gap-2 border-y border-[hsl(var(--e-border))] py-3">
            <div className="min-w-0">
              <ESwitch checked={draft.portalLogin} disabled={loginRefusal !== null} onCheckedChange={(on) => patch({ portalLogin: on })} label={<span className="font-[550] text-[hsl(var(--e-foreground))]">Give them a portal login</span>} />
              <p className="mt-1 pl-11 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {loginRefusal ?? (draft.portalLogin ? `${email || "Their email"} gets an invitation link to set a password, valid 7 days` : "No login now. Send a portal invite from the client page later.")}
              </p>
            </div>
          </div>
          <h3 className="mt-4 e-eyebrow">What the client is told about each clean</h3>
          <ul className="mt-1 divide-y divide-[hsl(var(--e-border))]">
            <NotificationRow label="Booking confirmations and job updates, by email" aside="client switch" checked={draft.notifications.jobUpdates} onChange={(on) => patchNotifications({ jobUpdates: on })} />
            <NotificationRow label="Cleaner on the way" checked={draft.notifications.enRoute} disabled={!draft.notifications.jobUpdates} onChange={(on) => patchNotifications({ enRoute: on })} />
            <NotificationRow label="Clean started and finished" checked={draft.notifications.startFinish} disabled={!draft.notifications.jobUpdates} onChange={(on) => patchNotifications({ startFinish: on })} />
            <NotificationRow label="Show the cleaner's live location in the portal" checked={draft.notifications.liveLocation} onChange={(on) => patchNotifications({ liveLocation: on })} />
          </ul>
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            These are the client&apos;s existing notification preferences, set here instead of later. Email only; nothing here sends SMS.
          </p>
        </StepCard>

        <StepCard id="client-next" step={4} title="After adding" done={false} aside="Choose one, or none">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <NextCard selected={draft.next === "onboarding"} title="Start property onboarding" description="Opens a new onboarding for this client" onToggle={() => patch({ next: draft.next === "onboarding" ? null : "onboarding" })} />
            <NextCard selected={false} disabled title="Send them an onboarding link" description="Coming in a later step: there is no client onboarding link yet" onToggle={() => undefined} />
            <NextCard selected={draft.next === "quote"} title="Write a quote" description="Opens the quote builder for this client" onToggle={() => patch({ next: draft.next === "quote" ? null : "quote" })} />
          </div>
        </StepCard>
      </fieldset>

      <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
        <SummaryRail
          title="What Add client does"
          issues={touched ? issues : 0}
          rows={[
            { label: "Client", value: <><span className="font-semibold">{draft.name.trim() || "Name to add"}</span>{draft.suburb ? `, ${draft.suburb}` : ""}, {termsLabel(canEditTerms ? draft.terms : "default", defaultTermsDays)}</> },
            { label: "Login", value: draft.portalLogin ? `${email || "email to add"}, client portal` : "None now" },
            { label: "Sends", value: draft.portalLogin ? "1 invitation email" : "Nothing" },
            { label: "Messages", value: draft.notifications.jobUpdates ? "Booking and job emails on" : "Job emails off" },
            { label: "Xero", value: draft.xeroContactId ? `Linked to ${draft.xeroContactName}` : "Not linked" },
            { label: "Then", value: draft.next === "onboarding" ? "New onboarding opens" : draft.next === "quote" ? "Quote builder opens" : "The client page" },
          ]}
          action={<EButton type="submit" className="w-full" disabled={saving}>{saving ? "Adding…" : "Add client"}</EButton>}
          note="Fields freeze while saving. A failed save keeps everything and says why."
        />
        {touched && issues > 0 ? (
          <ul role="alert" className="list-disc space-y-1 pl-5 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {Object.values(fieldErrors).map((message) => <li key={message}>{message}</li>)}
          </ul>
        ) : null}
      </div>
    </form>
  );
}

function NotificationRow({ label, aside, checked, disabled, onChange }: { label: string; aside?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <li className="flex min-h-[44px] items-center justify-between gap-3 py-2">
      <ESwitch checked={checked} disabled={disabled} onCheckedChange={onChange} label={<span className="text-[hsl(var(--e-foreground))]">{label}</span>} />
      {aside ? <span className="shrink-0 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">{aside}</span> : null}
    </li>
  );
}

function NextCard({ selected, disabled, title, description, onToggle }: { selected: boolean; disabled?: boolean; title: string; description: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`flex min-h-[4.5rem] min-w-0 flex-col gap-1 rounded-[var(--e-radius)] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:cursor-not-allowed disabled:bg-[hsl(var(--e-surface-raised))] ${selected ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"}`}
    >
      <span className="text-[0.875rem] font-semibold">{title}</span>
      <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{description}</span>
    </button>
  );
}

function XeroContactField({
  connected,
  canLink,
  draft,
  query,
  onQuery,
  search,
  onSearch,
  onPick,
}: {
  connected: boolean;
  canLink: boolean;
  draft: ClientDraft;
  query: string;
  onQuery: (value: string) => void;
  search: XeroSearch;
  onSearch: () => void;
  onPick: (contact: XeroContact | null) => void;
}) {
  if (!connected || !canLink) {
    return (
      <EField label="Xero contact" hint={!connected ? "Xero is not connected. Leave it for the Xero sync." : "Only an administrator, or an operations manager who manages finance, can link Xero."}>
        <ESelect disabled value="" className="max-sm:text-[16px]">
          <option value="">Not linked</option>
        </ESelect>
      </EField>
    );
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <EField label="Xero contact" hint="Pick an existing Xero contact here, or leave it for the Xero sync. Nothing is created in Xero.">
        <ESelect value={draft.xeroContactId} onChange={(e) => {
          const contacts = search.status === "done" ? search.contacts : [];
          onPick(contacts.find((contact) => contact.id === e.target.value) ?? null);
        }} className="max-sm:text-[16px]">
          <option value="">Not linked</option>
          {draft.xeroContactId && !(search.status === "done" && search.contacts.some((c) => c.id === draft.xeroContactId)) ? <option value={draft.xeroContactId}>{draft.xeroContactName}</option> : null}
          {search.status === "done" ? search.contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ""}</option>
          )) : null}
        </ESelect>
      </EField>
      <div className="flex gap-2">
        <EInput aria-label="Search Xero contacts" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={draft.name || "Search Xero"} className="max-sm:text-[16px]" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }} />
        <EButton type="button" size="sm" variant="outline" onClick={onSearch} disabled={search.status === "searching"}>{search.status === "searching" ? "Searching…" : "Search"}</EButton>
      </div>
      <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {search.status === "failed" ? search.reason : search.status === "done" ? search.reason ?? `${search.contacts.length} found in Xero.` : ""}
      </p>
    </div>
  );
}

function AddedResult({ result, next, onCopy }: { result: Extract<AddResult, { kind: "added" }>; next: NextStep; onCopy: () => void }) {
  const clientHref = `/v2/admin/clients/${result.clientId}`;
  const nextHref = next === "quote" ? `/v2/admin/quotes/new?clientId=${encodeURIComponent(result.clientId)}` : next === "onboarding" ? `/v2/admin/onboarding/new?clientId=${encodeURIComponent(result.clientId)}` : null;
  const nextLabel = next === "quote" ? "Continue to the quote" : "Continue to onboarding";
  const login = result.login;
  if (login && login.email.state !== "ACCEPTED") {
    return (
      <ResultNotice tone="attention" title="Invitation not delivered" subtitle="The client was still created" pill="Email failed" live="assertive">
        <p>
          {result.name} added. {invitationEmailSentence(login)} Copy the link to send it another way, or fix the email on the client page and resend.
        </p>
        {result.link ? <LinkBox link={result.link} /> : result.linkError ? <p className="text-[hsl(var(--e-danger))]">{result.linkError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline" onClick={onCopy}>Copy invitation link</EButton>
          <EButton asChild size="sm"><Link href={clientHref}>Open client</Link></EButton>
          {nextHref ? <EButton asChild size="sm" variant="outline"><Link href={nextHref}>{nextLabel}</Link></EButton> : null}
        </div>
      </ResultNotice>
    );
  }
  return (
    <ResultNotice tone="good" title="Added" subtitle={nextHref ? (next === "quote" ? "Then the quote builder" : "Then onboarding opens") : "Client created"} pill="Created">
      <p>
        <span className="font-semibold">{result.name}</span> added.
        {login ? ` Invitation email queued to ${login.user.email}, not opened yet.` : " No portal login was created."}
        {result.replayed ? " (This repeats the first press: nothing new was created or sent.)" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {nextHref ? <EButton asChild size="sm"><Link href={nextHref}>{nextLabel}</Link></EButton> : null}
        <EButton asChild size="sm" variant={nextHref ? "outline" : "primary"}><Link href={clientHref}>Open client</Link></EButton>
      </div>
    </ResultNotice>
  );
}
