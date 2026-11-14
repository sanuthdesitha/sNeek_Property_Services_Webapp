"use client";

/**
 * Invite person (board "Invite person", 2026-11-16): the ONE way to create a
 * staff account or a client login. Role cards first, then only the fields
 * that role needs, how they sign in, optional SMS with the link (off unless
 * ticked), starting permission packs for an ops manager (nothing ticked),
 * and a summary of what one press creates and sends. Same request as the
 * old dialog (POST /api/admin/users); from Hiring it opens filled from the
 * application and hires through the application's hire route, which uses
 * the same account service. Administrators only (checked again on the server).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { BankFields, EMPTY_BANK, type BankDraft } from "@/components/v2/admin/accounts/person/bank-fields";
import {
  ACCOUNT_KIND_CARDS,
  accountKindLabel,
  emailFailed,
  invitationEmailSentence,
  isAccountKind,
  isHireAccountKind,
  type AccountCreateOutcome,
  type AccountKind,
} from "@/lib/accounts/create-account-rules";
import { ChoiceCard, LinkBox, newIdempotencyKey, ResultNotice, StepCard, SummaryRail } from "./form-parts";

export type InviteOption = { id: string; name: string };
export type InviteArea = { key: string; label: string };
export type InvitePrefill = { applicationId: string; name: string; email: string; phone: string | null; kind: AccountKind | null; refusal: string | null };

type SignIn = "INVITATION" | "PASSWORD";

type InviteDraft = {
  kind: AccountKind;
  name: string;
  email: string;
  phone: string;
  signIn: SignIn;
  password: string;
  sendSms: boolean;
  clientId: string;
  abn: string;
  bank: BankDraft;
  laundrySupplierId: string;
  opsPacks: string[];
};

type EmailCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "free" }
  | { status: "inUse"; message: string; existingId: string | null }
  | { status: "unknown" };

type InviteResult =
  | { kind: "created"; outcome: AccountCreateOutcome; link: string | null; linkError: string | null; copied: boolean }
  | { kind: "inUse"; message: string; existingId: string | null }
  | { kind: "error"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyDraft(kind: AccountKind, prefill: InvitePrefill | null): InviteDraft {
  return {
    kind,
    name: prefill?.name ?? "",
    email: prefill?.email ?? "",
    phone: prefill?.phone ?? "",
    signIn: "INVITATION",
    password: "",
    sendSms: false,
    clientId: "",
    abn: "",
    bank: { ...EMPTY_BANK },
    laundrySupplierId: "",
    opsPacks: [],
  };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "them";
}

function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

function bankFilled(bank: BankDraft): boolean {
  return Boolean(bank.accountName.trim() || bank.bankName.trim() || bank.bsb.trim() || bank.accountNumber.trim());
}

export function InvitePersonPage({
  initialKind,
  clients,
  partners,
  opsAreas,
  smsReady,
  timeZone,
  prefill,
}: {
  initialKind: AccountKind;
  clients: InviteOption[];
  partners: InviteOption[];
  opsAreas: InviteArea[];
  smsReady: boolean;
  timeZone: string;
  prefill: InvitePrefill | null;
}) {
  const fromHiring = prefill !== null;
  const [draft, setDraft] = useState<InviteDraft>(() => emptyDraft(prefill?.kind ?? initialKind, prefill));
  const [emailCheck, setEmailCheck] = useState<EmailCheck>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [touched, setTouched] = useState(false);
  const keyRef = useRef<string>(newIdempotencyKey());

  function patch(next: Partial<InviteDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    // A changed draft is a new request; an unchanged retry keeps its key.
    keyRef.current = newIdempotencyKey();
  }

  // The email check: obsolete reads are cancelled and a late answer never fills a newer email.
  useEffect(() => {
    if (fromHiring) return;
    const email = draft.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      setEmailCheck({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEmailCheck({ status: "checking" });
      try {
        const purpose = draft.kind === "CLIENT" ? "client-login" : "staff";
        const res = await fetch(`/api/admin/users/email-check?email=${encodeURIComponent(email)}&purpose=${purpose}`, { signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as { checked?: boolean; inUse?: boolean; message?: string | null; existing?: { id?: string } | null };
        if (controller.signal.aborted) return;
        if (!res.ok || !body.checked) return setEmailCheck({ status: "unknown" });
        setEmailCheck(body.inUse ? { status: "inUse", message: body.message ?? "This email already has an account.", existingId: body.existing?.id ?? null } : { status: "free" });
      } catch {
        if (!controller.signal.aborted) setEmailCheck({ status: "unknown" });
      }
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.email, draft.kind, fromHiring]);

  const kindCards = useMemo(
    () => ACCOUNT_KIND_CARDS.filter((card) => !fromHiring || card.kind === "VA" || isHireAccountKind(card.kind)),
    [fromHiring],
  );

  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("Add their name.");
  if (!EMAIL_PATTERN.test(draft.email.trim())) issues.push("Add a valid email.");
  if (emailCheck.status === "inUse") issues.push("The email is already used.");
  if (draft.signIn === "PASSWORD" && draft.password.length < 8) issues.push("The password needs at least 8 characters.");
  if (draft.kind === "CLIENT" && !draft.clientId) issues.push("A client login must be linked to a client.");
  if (fromHiring && prefill?.refusal) issues.push(prefill.refusal);

  const phone = draft.phone.trim();
  const smsDisabledReason = !smsReady ? "SMS is not set up for this organisation." : !phone ? "Add a phone number to send the link by SMS." : draft.signIn !== "INVITATION" ? "Only an invitation has a link to send." : null;
  const willSms = draft.sendSms && !smsDisabledReason;
  const showBank = draft.kind === "CLEANER" || draft.kind === "LAUNDRY";
  const pronoun = firstName(draft.name);

  async function copyLink(userId: string): Promise<{ link: string | null; error: string | null }> {
    const url = fromHiring
      ? `/api/admin/workforce/hiring/applications/${encodeURIComponent(prefill!.applicationId)}/invitation`
      : `/api/admin/users/${encodeURIComponent(userId)}/account-emails/invitation-link`;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fromHiring ? { action: "copy" } : {}) });
      const body = (await res.json().catch(() => ({}))) as { link?: string; error?: string };
      if (!res.ok || !body.link) return { link: null, error: body.error ?? "The link could not be read." };
      return { link: body.link, error: null };
    } catch {
      return { link: null, error: "The link could not be read." };
    }
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (saving || issues.length > 0) return;
    setSaving(true);
    setResult(null);
    try {
      const request = fromHiring
        ? {
            url: `/api/admin/workforce/hiring/applications/${encodeURIComponent(prefill!.applicationId)}/hire`,
            body: { accountKind: draft.kind, sendSms: willSms, idempotencyKey: keyRef.current, opsPacks: draft.kind === "OPS_MANAGER" ? draft.opsPacks : undefined },
          }
        : {
            url: "/api/admin/users",
            body: {
              name: draft.name.trim(),
              email: draft.email.trim(),
              phone: phone || undefined,
              role: draft.kind,
              invite: draft.signIn === "INVITATION",
              password: draft.signIn === "PASSWORD" ? draft.password : undefined,
              sendSms: willSms,
              clientId: draft.kind === "CLIENT" ? draft.clientId : undefined,
              abn: draft.kind === "CLIENT" || draft.kind === "LAUNDRY" ? draft.abn.trim() || undefined : undefined,
              laundrySupplierId: draft.kind === "LAUNDRY" ? draft.laundrySupplierId || undefined : undefined,
              bankDetails: showBank && bankFilled(draft.bank) ? draft.bank : undefined,
              opsPacks: draft.kind === "OPS_MANAGER" ? draft.opsPacks : undefined,
              idempotencyKey: keyRef.current,
            },
          };
      const res = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; existing?: { id?: string } | null; outcome?: AccountCreateOutcome };
      if (!res.ok || !body.outcome) {
        if (body.code === "EMAIL_IN_USE") setResult({ kind: "inUse", message: body.error ?? "This email already has an account.", existingId: body.existing?.id ?? null });
        else setResult({ kind: "error", message: `${body.error ?? "The account could not be created."} Nothing was created.` });
        return;
      }
      const outcome = body.outcome;
      let link: string | null = null;
      let linkError: string | null = null;
      let copied = false;
      if (emailFailed(outcome)) {
        const read = await copyLink(outcome.user.id);
        link = read.link;
        linkError = read.error;
        if (link) copied = await writeClipboard(link);
      }
      setResult({ kind: "created", outcome, link, linkError, copied });
    } catch {
      setResult({ kind: "error", message: "The request did not reach the server. Your entries are kept; try again." });
    } finally {
      setSaving(false);
    }
  }

  async function copyAgain(userId: string) {
    const read = await copyLink(userId);
    if (!read.link) {
      setResult((current) => (current?.kind === "created" ? { ...current, linkError: read.error } : current));
      return;
    }
    const copied = await writeClipboard(read.link);
    setResult((current) => (current?.kind === "created" ? { ...current, link: read.link, linkError: null, copied } : current));
  }

  function inviteAnother() {
    setDraft(emptyDraft(draft.kind, null));
    setResult(null);
    setTouched(false);
    keyRef.current = newIdempotencyKey();
  }

  const created = result?.kind === "created" ? result : null;
  const backHref = fromHiring ? `/v2/admin/hiring/applications/${prefill!.applicationId}` : "/v2/admin/accounts";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="min-w-0 space-y-3">
        <p className="e-eyebrow">
          <Link href={backHref} className="inline-flex min-h-[44px] items-center gap-1 underline-offset-2 hover:underline sm:min-h-0">
            <ArrowLeft className="h-3 w-3" aria-hidden /> {fromHiring ? "Application" : "People"}
          </Link>
        </p>
        <h1 className="e-display-md">Invite person</h1>
        <p className="text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          Choose what they do first; the form then asks only what that role needs. Administrators only, as today.
        </p>
        <div className="e-signature-rule" />
      </header>

      {created ? (
        <CreatedNotice result={created} timeZone={timeZone} fromHiring={fromHiring} onCopy={() => copyAgain(created.outcome.user.id)} onAnother={inviteAnother} />
      ) : null}
      {result?.kind === "inUse" ? (
        <ResultNotice tone="problem" title="Email already used" subtitle="Nothing created" pill="Refused" live="assertive">
          <p>
            {result.message}{" "}
            {result.existingId ? (
              <Link className="underline" href={`/v2/admin/accounts/users/${result.existingId}`}>Open that account</Link>
            ) : null}
          </p>
        </ResultNotice>
      ) : null}
      {result?.kind === "error" ? (
        <ResultNotice tone="problem" title="Not created" subtitle="Your entries are kept" pill="Failed" live="assertive">
          <p>{result.message}</p>
        </ResultNotice>
      ) : null}

      {created ? null : (
        <form onSubmit={submit} noValidate className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <legend className="sr-only">New account</legend>
            <StepCard id="invite-kind" step={1} title="What they do" done>
              <div role="radiogroup" aria-label="What they do" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {kindCards.map((card) =>
                  card.kind === "VA" ? (
                    <div key="VA" className="flex min-h-[4.5rem] min-w-0 flex-col gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                      <span className="text-[0.875rem] font-semibold">{card.title}</span>
                      <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        Created from the <Link className="underline" href="/v2/admin/accounts?tab=assistants">Assistants tab</Link> with its team
                      </span>
                    </div>
                  ) : (
                    <ChoiceCard
                      key={card.kind}
                      name="invite-kind"
                      selected={draft.kind === card.kind}
                      title={card.title}
                      description={card.description}
                      onSelect={() => isAccountKind(card.kind) && patch({ kind: card.kind, signIn: card.kind === "CLIENT" || fromHiring ? "INVITATION" : draft.signIn })}
                    />
                  ),
                )}
              </div>
            </StepCard>

            <StepCard id="invite-about" step={2} title="About them" done={Boolean(draft.name.trim() && EMAIL_PATTERN.test(draft.email.trim()) && emailCheck.status !== "inUse")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <EField label={<>Name <span aria-hidden className="text-[hsl(var(--e-danger))]">*</span></>} hint={touched && !draft.name.trim() ? "Add their name." : undefined}>
                  <EInput value={draft.name} readOnly={fromHiring} autoComplete="off" onChange={(e) => patch({ name: e.target.value })} className="max-sm:text-[16px]" aria-required="true" />
                </EField>
                <EField
                  label={<>Email <span aria-hidden className="text-[hsl(var(--e-danger))]">*</span></>}
                  hint={fromHiring ? "From the application." : emailHint(emailCheck, touched && !EMAIL_PATTERN.test(draft.email.trim()))}
                >
                  <EInput type="email" value={draft.email} readOnly={fromHiring} autoComplete="off" onChange={(e) => patch({ email: e.target.value })} className="max-sm:text-[16px]" aria-required="true" />
                </EField>
                <EField label="Phone, optional" hint={fromHiring ? "From the application." : undefined}>
                  <EInput type="tel" inputMode="tel" maxLength={16} readOnly={fromHiring} placeholder="0438 112 905" value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} className="max-sm:text-[16px]" />
                </EField>
              </div>
              {emailCheck.status === "inUse" ? (
                <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
                  {emailCheck.message}{" "}
                  {emailCheck.existingId ? <Link className="underline" href={`/v2/admin/accounts/users/${emailCheck.existingId}`}>Open that account</Link> : null}
                </p>
              ) : null}
              {showBank && !fromHiring ? (
                <details className="mt-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
                  <summary className="min-h-[36px] cursor-pointer py-1.5 text-[0.8125rem]">
                    <span className="font-[550]">Bank details, optional</span> · BSB and account for {draft.kind === "LAUNDRY" ? "invoices" : "cleaner pay"}. Can be added by {pronoun} in their profile later.
                  </summary>
                  <div className="pt-2">
                    <BankFields title="Bank details" value={draft.bank} onChange={(bank) => patch({ bank })} />
                  </div>
                </details>
              ) : null}
            </StepCard>

            <RoleSection draft={draft} patch={patch} clients={clients} partners={partners} opsAreas={opsAreas} fromHiring={fromHiring} touched={touched} />

            <StepCard id="invite-sign-in" step={3} title="How they sign in" done={draft.signIn === "INVITATION" || draft.password.length >= 8}>
              <div role="radiogroup" aria-label="How they sign in" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <ChoiceCard
                  name="invite-sign-in"
                  selected={draft.signIn === "INVITATION"}
                  title="Email an invitation"
                  description="A link to set their own password, valid 7 days. Resend from their account."
                  onSelect={() => patch({ signIn: "INVITATION" })}
                />
                <ChoiceCard
                  name="invite-sign-in"
                  selected={draft.signIn === "PASSWORD"}
                  disabled={fromHiring || draft.kind === "CLIENT"}
                  title="Set a password now"
                  description={fromHiring ? "Hires always get the invitation link." : draft.kind === "CLIENT" ? "Client logins always get the invitation link." : "Active at once with the password you type. Tell them yourself."}
                  onSelect={() => patch({ signIn: "PASSWORD", sendSms: false })}
                />
              </div>
              {draft.signIn === "PASSWORD" ? (
                <EField label="Password" hint="At least 8 characters. The account is active at once." className="mt-3 sm:max-w-sm">
                  <EInput type="password" autoComplete="new-password" value={draft.password} onChange={(e) => patch({ password: e.target.value })} className="max-sm:text-[16px]" />
                </EField>
              ) : null}
              <fieldset className="mt-4">
                <legend className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Also send</legend>
                <label className="mt-1.5 flex min-h-[44px] flex-wrap items-center gap-x-2 gap-y-1 text-[0.875rem]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                    checked={draft.sendSms && !smsDisabledReason}
                    disabled={Boolean(smsDisabledReason)}
                    onChange={(e) => patch({ sendSms: e.target.checked })}
                    aria-describedby="invite-sms-hint"
                  />
                  <span>SMS with the link{phone ? ` to ${phone}` : ""}</span>
                  <span id="invite-sms-hint" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {smsDisabledReason ?? "Off unless ticked. The email is always sent with an invitation."}
                  </span>
                </label>
              </fieldset>
            </StepCard>
          </fieldset>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
            <SummaryRail
              title="Create and invite"
              issues={issues.length}
              rows={[
                { label: "Account", value: <><span className="font-semibold">{draft.name.trim() || "Name to add"}</span>, {accountKindLabel(draft.kind)}</> },
                { label: "Sign-in", value: draft.signIn === "INVITATION" ? "Invitation link, 7 days" : "Password you set now" },
                { label: "Sends", value: draft.signIn === "INVITATION" ? `1 email; ${willSms ? "1 SMS" : "no SMS"}` : "Nothing; tell them yourself" },
                { label: "Then", value: fromHiring ? "The application moves to Hired" : nextStepLine(draft.kind) },
              ]}
              action={
                <EButton type="submit" className="w-full" disabled={saving} aria-describedby={issues.length && touched ? "invite-issues" : undefined}>
                  {saving ? "Creating…" : draft.signIn === "INVITATION" ? (fromHiring ? "Hire and invite" : "Create and invite") : "Create account"}
                </EButton>
              }
              note="Fields freeze while saving; a failure keeps them and says why. The link is shown when the email cannot be sent."
            />
            {touched && issues.length ? (
              <ul id="invite-issues" role="alert" className="list-disc space-y-1 pl-5 text-[0.8125rem] text-[hsl(var(--e-danger))]">
                {issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            ) : null}
            <p className={`flex gap-2 rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem] ${toneNoticeClass("info")}`}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {fromHiring ? "Filled from the application, with the role from the offer. Hiring creates the account through this same invitation." : "From Hiring, this page opens filled from the application, with the role from the offer."}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

function emailHint(check: EmailCheck, invalid: boolean): string | undefined {
  if (invalid) return "Add a valid email.";
  if (check.status === "checking") return "Checking…";
  if (check.status === "free") return "No other account uses this email";
  if (check.status === "unknown") return "Could not check the email now; it is checked again when you create.";
  return undefined;
}

function nextStepLine(kind: AccountKind): string {
  if (kind === "CLEANER") return "Their page: availability, home location, pay rates";
  if (kind === "OPS_MANAGER") return "Their page; packs can change in Settings › Access";
  if (kind === "CLIENT") return "The client's page lists the login";
  return "Their page opens";
}

function RoleSection({
  draft,
  patch,
  clients,
  partners,
  opsAreas,
  fromHiring,
  touched,
}: {
  draft: InviteDraft;
  patch: (next: Partial<InviteDraft>) => void;
  clients: InviteOption[];
  partners: InviteOption[];
  opsAreas: InviteArea[];
  fromHiring: boolean;
  touched: boolean;
}) {
  if (draft.kind === "OPS_MANAGER") {
    const toggle = (key: string, on: boolean) => patch({ opsPacks: on ? [...draft.opsPacks, key] : draft.opsPacks.filter((value) => value !== key) });
    return (
      <StepCard id="invite-packs" step={2} title="Starting permission packs" done aside={`${draft.opsPacks.length} at manage`}>
        <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Nothing is ticked to start: a new ops manager reaches only the areas you tick here, at Manage. Change them later in Settings › Access › Roles.
        </p>
        <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {opsAreas.map((area) => {
            const on = draft.opsPacks.includes(area.key);
            return (
              <li key={area.key} className="border-b border-[hsl(var(--e-border))] last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                <label className="flex min-h-[44px] items-center gap-2 text-[0.875rem]">
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={on} onChange={(e) => toggle(area.key, e.target.checked)} />
                  <span className="min-w-0 flex-1">{area.label}</span>
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{on ? "manage" : "none"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </StepCard>
    );
  }
  if (draft.kind === "ADMIN") {
    return (
      <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        An administrator never needs packs: full rights do not depend on them.
      </p>
    );
  }
  if (draft.kind === "CLIENT" && !fromHiring) {
    return (
      <StepCard id="invite-client" step={2} title="Linked client" done={Boolean(draft.clientId)} aside="required">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EField label="Client" hint={touched && !draft.clientId ? "A client login must be linked to a client." : "Clients themselves are made in Add client."}>
            <ESelect value={draft.clientId} onChange={(e) => patch({ clientId: e.target.value })} className="max-sm:text-[16px]">
              <option value="">Choose a client…</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </ESelect>
          </EField>
          <EField label="ABN, optional">
            <EInput inputMode="numeric" maxLength={14} placeholder="11 digits" value={draft.abn} onChange={(e) => patch({ abn: e.target.value })} className="max-sm:text-[16px]" />
          </EField>
        </div>
      </StepCard>
    );
  }
  if (draft.kind === "LAUNDRY" && !fromHiring) {
    return (
      <StepCard id="invite-laundry" step={2} title="Laundry partner" done aside="invoices need these">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EField label="Works for" hint={partners.length ? "Optional. The partner's team sees this person's runs." : "No laundry partners yet. Link from Suppliers after creating."}>
            <ESelect value={draft.laundrySupplierId} onChange={(e) => patch({ laundrySupplierId: e.target.value })} disabled={partners.length === 0} className="max-sm:text-[16px]">
              <option value="">Not linked yet</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </ESelect>
          </EField>
          <EField label="ABN, optional">
            <EInput inputMode="numeric" maxLength={14} placeholder="11 digits" value={draft.abn} onChange={(e) => patch({ abn: e.target.value })} className="max-sm:text-[16px]" />
          </EField>
        </div>
      </StepCard>
    );
  }
  return null;
}

function CreatedNotice({
  result,
  timeZone,
  fromHiring,
  onCopy,
  onAnother,
}: {
  result: Extract<InviteResult, { kind: "created" }>;
  timeZone: string;
  fromHiring: boolean;
  onCopy: () => void;
  onAnother: () => void;
}) {
  const { outcome } = result;
  const name = outcome.user.name ?? outcome.user.email;
  const until = outcome.invitation ? formatDay(outcome.invitation.expiresAt, timeZone) : null;
  const accountHref = `/v2/admin/accounts/users/${outcome.user.id}`;
  const sms = outcome.sms.state === "ACCEPTED" ? " SMS with the link queued with the provider." : outcome.sms.state === "NOT_SENT" || outcome.sms.state === "NO_PHONE" ? ` The SMS was not sent: ${outcome.sms.error ?? "unknown reason"}.` : "";
  if (outcome.signIn === "PASSWORD") {
    return (
      <ResultNotice tone="good" title="Account created" subtitle="Active now" pill="Created">
        <p>{name} can sign in now with the password you set. Nothing was emailed.</p>
        <div className="flex flex-wrap gap-2">
          <EButton asChild size="sm"><Link href={accountHref}>Open {firstName(name)}&apos;s account</Link></EButton>
          <EButton size="sm" variant="outline" onClick={onAnother}>Invite another</EButton>
        </div>
      </ResultNotice>
    );
  }
  if (emailFailed(outcome)) {
    return (
      <ResultNotice tone="attention" title="Email not sent" subtitle="Account exists, link shown" pill="Share it yourself" live="assertive">
        <p>
          {invitationEmailSentence(outcome)}
          {result.copied ? " The link is copied to your clipboard." : ""}
          {sms}
        </p>
        {result.link ? <LinkBox link={result.link} /> : <p className="text-[hsl(var(--e-danger))]">{result.linkError ?? "The link could not be read."}</p>}
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline" onClick={onCopy}>Copy invitation link</EButton>
          <EButton asChild size="sm"><Link href={`${accountHref}?tab=access`}>Resend from the account</Link></EButton>
        </div>
      </ResultNotice>
    );
  }
  return (
    <ResultNotice tone="good" title={fromHiring ? "Hired" : "Invited"} subtitle="Status message" pill="Email queued">
      <p>
        Invitation for <span className="font-semibold">{outcome.user.email}</span> queued with the email provider{until ? `. Valid until ${until}` : ""}. Not signed in yet.{sms}
        {outcome.replayed ? " (This repeats the first press: nothing new was created or sent.)" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <EButton asChild size="sm"><Link href={accountHref}>Open {firstName(name)}&apos;s account</Link></EButton>
        <EButton size="sm" variant="outline" onClick={onCopy}>{result.copied ? "Copied" : "Copy invitation link"}</EButton>
        {fromHiring ? null : <EButton size="sm" variant="outline" onClick={onAnother}>Invite another</EButton>}
      </div>
      {result.linkError ? <p className="text-[hsl(var(--e-danger))]">{result.linkError}</p> : null}
    </ResultNotice>
  );
}
