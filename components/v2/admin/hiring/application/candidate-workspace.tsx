"use client";

/**
 * Hiring application page (boards "Hiring application" and "Hiring on a
 * phone", 2026-11-16). Reads top to bottom like the candidate's story: stage
 * strip, five facts, answers as submitted, documents, the knowledge test by
 * category with free-text answers to mark, interview notes with optional
 * internal scores, and history. The rail holds the one decision for the
 * current stage and, separately, exactly what "Mark hired and invite" will
 * create, checked before anyone confirms. On a phone the sections fold, the
 * stage's decision docks at the bottom and the offer is a sheet.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, FileText, Phone } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EPill } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { EToneCard, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { emailFailed, invitationEmailSentence, type AccountCreateOutcome } from "@/lib/accounts/create-account-rules";
import { INTERVIEW_SCORE_KEYS, INTERVIEW_SCORE_LABEL, type InterviewScoreKey } from "@/lib/hiring/pipeline";
import type { ApplicationView } from "@/lib/hiring/application-view";
import { EmailPreviewModal } from "./email-preview-modal";
import { QuizReview } from "./quiz-review";
import { StageMoveFlow, type OfferDraft, type PendingMove } from "../stage-move";

type Message = { text: string; tone: "success" | "danger" };

type HireState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; outcome: AccountCreateOutcome; link: string | null; linkError: string | null }
  | { status: "failed"; message: string };

function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function heShe(name: string): string {
  return name.trim().split(/\s+/)[0] || "them";
}

export function CandidateWorkspace({ view, smsReady, isAdmin }: { view: ApplicationView; smsReady: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const phone = useIsPhone();
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [offer, setOffer] = useState<OfferDraft>(() => ({ ...view.offer }));
  const [offerSheet, setOfferSheet] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [hire, setHire] = useState<HireState>({ status: "idle" });
  const hireKey = useRef(newKey());

  // A different application starts clean (drafts never carry across people).
  useEffect(() => {
    setOffer({ ...view.offer });
    setSendSms(false);
    setHire({ status: "idle" });
    hireKey.current = newKey();
  }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?hire=1 (from the board's Hired column) opens the account step.
  useEffect(() => {
    if (search?.get("hire") === "1" && view.status === "OFFER" && !view.preview.refusal) setHireOpen(true);
  }, [search, view.status, view.preview.refusal]);

  const kindLabel = view.preview.accountLabel;
  const first = heShe(view.name);
  const smsReason = !smsReady ? "SMS is not set up" : !view.phone ? "No phone on the application" : null;
  const officeKind = view.preview.accountKind === "OPS_MANAGER";

  function startMove(to: string, withOffer?: OfferDraft) {
    setPending({ applicationId: view.id, name: view.name, from: view.status, to, offer: withOffer ?? null });
  }

  async function readLink(): Promise<{ link: string | null; error: string | null }> {
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(view.id)}/invitation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "copy" }) });
      const body = (await res.json().catch(() => ({}))) as { link?: string; error?: string };
      return res.ok && body.link ? { link: body.link, error: null } : { link: null, error: body.error ?? "The link could not be read." };
    } catch {
      return { link: null, error: "The link could not be read." };
    }
  }

  async function confirmHire() {
    setHire({ status: "saving" });
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(view.id)}/hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountKind: view.preview.accountKind ?? undefined, sendSms: sendSms && !smsReason, idempotencyKey: hireKey.current }),
      });
      const body = (await res.json().catch(() => ({}))) as { outcome?: AccountCreateOutcome; error?: string };
      if (!res.ok || !body.outcome) {
        setHire({ status: "failed", message: body.error ?? "Nothing was created." });
        return;
      }
      let link: string | null = null;
      let linkError: string | null = null;
      if (emailFailed(body.outcome)) {
        const read = await readLink();
        link = read.link;
        linkError = read.error;
        if (link) {
          try {
            await navigator.clipboard.writeText(link);
          } catch {
            /* the link stays on screen */
          }
        }
      }
      setHire({ status: "done", outcome: body.outcome, link, linkError });
      setHireOpen(false);
      router.refresh();
    } catch {
      setHire({ status: "failed", message: "The request did not reach the server. Nothing is known to be created; try again." });
    }
  }

  async function copyLink() {
    const read = await readLink();
    if (read.link) {
      try {
        await navigator.clipboard.writeText(read.link);
        setMessage({ text: "Invitation link copied.", tone: "success" });
      } catch {
        setMessage({ text: `Copy this link: ${read.link}`, tone: "success" });
      }
    } else setMessage({ text: read.error ?? "The link could not be read.", tone: "danger" });
    if (hire.status === "done") setHire({ ...hire, link: read.link ?? hire.link, linkError: read.error });
  }

  async function resend() {
    const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(view.id)}/invitation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend" }) });
    const body = (await res.json().catch(() => ({}))) as { stateLabel?: string; error?: string };
    setMessage(res.ok ? { text: `Invitation resent: ${body.stateLabel ?? "sent"}. The old link stops working.`, tone: "success" } : { text: body.error ?? "Not resent.", tone: "danger" });
    if (res.ok) router.refresh();
  }

  const decision = stageDecision(view, { startMove, openOffer: () => setOfferSheet(true), openHire: () => setHireOpen(true), offer, phone });
  const menuItems = [
    ...["NEW", "SCREENING", "INTERVIEW", "OFFER"].filter((stage) => stage !== view.status && view.status !== "HIRED").map((stage, index) => ({ key: stage, label: `Move to ${stage[0]}${stage.slice(1).toLowerCase()}`, heading: index === 0 ? "Move to" : undefined, onSelect: () => startMove(stage, stage === "OFFER" ? offer : undefined) })),
    ...(view.status === "HIRED" ? [] : [
      { key: "withdrawn", label: "Mark withdrawn", separated: true, onSelect: () => startMove("WITHDRAWN") },
      { key: "decline", label: "Decline…", danger: true, onSelect: () => startMove("REJECTED") },
    ]),
  ];

  return (
    <OfferDraftContext.Provider value={{ offer, setOffer }}>
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="e-eyebrow"><Link href="/v2/admin/hiring" className="underline-offset-2 hover:underline">← Hiring</Link></p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="e-display-md break-words">{view.name}</h1>
            <EPill tone="gold">{view.stageLabel}</EPill>
          </div>
          <p className="mt-1 break-words text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{view.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
          <EButton variant="outline" size="sm" onClick={() => setEmailOpen(true)}>Email…</EButton>
          {decision.primary ? <EButton size="sm" onClick={decision.primary.onClick} disabled={decision.primary.disabled}>{decision.primary.label}</EButton> : null}
          {menuItems.length ? <ERowMenu label={`More actions for ${view.name}`} items={menuItems} trigger="More ▾" triggerVariant="outline" /> : null}
        </div>
      </header>
      <div className="e-signature-rule" />

      {message ? (
        <p role={message.tone === "danger" ? "alert" : "status"} className={`rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem] ${toneNoticeClass(message.tone === "danger" ? "problem" : "good")}`}>{message.text}</p>
      ) : null}

      <EStageBar label="Application stages" stages={view.stages.map((stage) => ({ key: stage.key, label: stage.label, state: stage.state, note: stage.note || null }))} terminal={view.status === "REJECTED" || view.status === "WITHDRAWN" ? { title: view.stageLabel, description: view.status === "REJECTED" ? "Declined. Move back to Screening from More to reopen." : "The applicant withdrew." } : null} />

      <ul aria-label="Facts" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {view.facts.map((fact, index) => (
          <li key={fact.label} className={`min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 ${index > 2 ? "max-sm:hidden" : ""}`}>
            <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{fact.label}</p>
            <p className="break-words text-[0.875rem] font-semibold">{fact.value}</p>
            {fact.note ? <p className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">{fact.note}</p> : null}
          </li>
        ))}
      </ul>

      <div className="flex gap-2 sm:hidden">
        {view.phone ? (
          <EButton asChild variant="outline" className="flex-1"><a href={`tel:${view.phone.replace(/\s+/g, "")}`}><Phone className="h-4 w-4" aria-hidden /> Call</a></EButton>
        ) : (
          <EButton variant="outline" className="flex-1" disabled title="No phone on the application">Call</EButton>
        )}
        <EButton variant="outline" className="flex-1" onClick={() => setEmailOpen(true)}>Email…</EButton>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Section title="Answers" aside="Application form as it was when they applied" summary={`${view.answers.length} sections · ${view.answerCount} answers`}>
            {view.answers.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No answers were recorded.</p> : null}
            {view.answers.map((section) => (
              <div key={section.title} className="mb-3 last:mb-0">
                <h3 className="e-eyebrow mb-1">{section.title}</h3>
                <dl className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
                  {section.rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
                      <dt className="text-[hsl(var(--e-muted-foreground))]">{row.label}</dt>
                      <dd className="min-w-0 whitespace-pre-line break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </Section>

          <Section title="Documents" summary={[view.resume ? "CV" : null, view.coverLetter ? "cover letter" : null].filter(Boolean).join(", ") || "None uploaded"}>
            <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
              {view.resume ? (
                <li className="flex items-center gap-3 py-2">
                  <FileText className="h-5 w-5 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{view.resume.name}</p><p className="text-[hsl(var(--e-muted-foreground))]">Uploaded with the application</p></div>
                  <EButton asChild size="sm" variant="outline"><a href={view.resume.url} target="_blank" rel="noreferrer">Open</a></EButton>
                </li>
              ) : null}
              {view.coverLetter ? (
                <li className="py-2">
                  <details>
                    <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 sm:min-h-0">
                      <span className="font-semibold">Cover letter</span>
                      <span className="min-w-0 flex-1 truncate text-[hsl(var(--e-muted-foreground))]">“{view.coverLetter.slice(0, 80)}…”</span>
                      <span className="text-[hsl(var(--e-primary))]">Read</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-line">{view.coverLetter}</p>
                  </details>
                </li>
              ) : null}
              {!view.resume && !view.coverLetter ? <li className="py-2 text-[hsl(var(--e-muted-foreground))]">No documents came with the application.</li> : null}
            </ul>
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Police check, driver licence and (for cleaners) white card are requested after hiring, in their staff documents.</p>
          </Section>

          <KnowledgeTest view={view} onMessage={setMessage} />

          <InterviewSection view={view} onMessage={setMessage} />

          <Section title="History" aside="Organisation time" summary={`${view.history.length} events${view.history[0] ? ` · last ${view.history[0].at}` : ""}`}>
            <ol className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
              {view.history.map((row) => (
                <li key={row.id} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                  <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{row.at}</span>
                  <div className="min-w-0">
                    <p className="break-words">{row.summary}{row.from && row.to ? <> · <EPill>{row.from}</EPill> → <EPill tone="gold">{row.to}</EPill></> : null}</p>
                    {row.body ? <p className="mt-1 whitespace-pre-line rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-2 text-[0.75rem]">{row.body}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
            <LogReply applicationId={view.id} onMessage={setMessage} />
          </Section>
        </div>

        <aside aria-label="Decision" className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className={view.status === "HIRED" ? "" : "max-sm:hidden"}>{decision.card}</div>
          {hire.status === "done" ? (
            <HiredResult outcome={hire.outcome} link={hire.link} linkError={hire.linkError} onCopy={copyLink} first={first} />
          ) : view.hired ? (
            <HiredCard view={view} onCopy={copyLink} onResend={resend} />
          ) : view.status !== "REJECTED" && view.status !== "WITHDRAWN" ? (
            <HirePreviewCard view={view} sendSms={sendSms} onSms={setSendSms} smsReason={smsReason} onHire={() => setHireOpen(true)} officeKind={officeKind} isAdmin={isAdmin} />
          ) : null}
          {view.preview.emailInUse && !view.hired ? (
            <EToneCard tone="problem" header={<div><p className="font-semibold">If the email is already in use</p><p className="text-[0.75rem] opacity-80">Checked before you confirm</p></div>} pill="Cannot hire">
              <p className="text-[0.8125rem]">“{view.preview.emailInUse}” The application stays in {view.stageLabel}.</p>
            </EToneCard>
          ) : null}
        </aside>
      </div>

      <EPhoneActionBar
        label="Application decision"
        hidden={pending !== null || hireOpen || offerSheet}
        secondary={decision.secondary ? <EButton variant="outline" onClick={decision.secondary.onClick}>{decision.secondary.label}</EButton> : undefined}
        primary={decision.primary ? <EButton onClick={decision.primary.onClick} disabled={decision.primary.disabled}>{decision.primary.label}</EButton> : <EButton variant="outline" onClick={() => setEmailOpen(true)}>Email…</EButton>}
      />

      <EBottomSheet
        open={offerSheet}
        onOpenChange={setOfferSheet}
        title="Make an offer"
        footer={<EButton className="w-full" onClick={() => { setOfferSheet(false); startMove("OFFER", offer); }}>Next: check the email</EButton>}
      >
        <OfferFields offer={offer} onChange={setOffer} kinds={view.hireKinds} />
        <p className={`mt-3 rounded-[var(--e-radius)] p-3 text-[0.8125rem] ${toneNoticeClass("info")}`}>The offer email opens next to check and send. &ldquo;Move without email&rdquo; is beside Send.</p>
      </EBottomSheet>

      <EConfirmDialog
        open={hireOpen}
        tier="ordinary"
        title={`Hire ${view.name} as ${kindLabel ? `a ${kindLabel.toLowerCase()}` : "staff"}?`}
        description={`Creates ${first}'s ${kindLabel ?? ""} account and emails an invitation to set a password. ${view.preview.documents.length} documents and their learning are requested. You can deactivate the account later.`}
        confirmLabel="Hire and invite"
        busy={hire.status === "saving"}
        confirmDisabled={Boolean(view.preview.refusal)}
        error={hire.status === "failed" ? `It was not recorded: ${hire.message}` : view.preview.refusal}
        onClose={() => {
          setHireOpen(false);
          if (hire.status === "failed") setHire({ status: "idle" });
        }}
        onConfirm={confirmHire}
      >
        {phone ? <HireChecklist view={view} sendSms={sendSms} onSms={setSendSms} smsReason={smsReason} /> : null}
      </EConfirmDialog>

      <EmailPreviewModal applicationId={view.id} open={emailOpen} onClose={() => setEmailOpen(false)} recipientName={view.name} onSent={() => router.refresh()} onToast={(m) => setMessage({ text: m.title, tone: m.tone ?? "success" })} />

      <StageMoveFlow
        move={pending}
        onMessage={(text, tone) => setMessage({ text, tone })}
        onFinished={(changed) => {
          setPending(null);
          if (changed) router.refresh();
        }}
      />
    </div>
    </OfferDraftContext.Provider>
  );
}

type Action = { label: string; onClick: () => void; disabled?: boolean };

function stageDecision(
  view: ApplicationView,
  ctx: { startMove: (to: string, offer?: OfferDraft) => void; openOffer: () => void; openHire: () => void; offer: OfferDraft; phone: boolean },
): { primary: Action | null; secondary: Action | null; card: React.ReactNode } {
  const decline: Action = { label: "Decline…", onClick: () => ctx.startMove("REJECTED") };
  switch (view.status) {
    case "NEW":
      return {
        primary: { label: "Move to Screening…", onClick: () => ctx.startMove("SCREENING") },
        secondary: decline,
        card: <DecisionCard title="First look" subtitle="Screen or decline" pill="Your move" actions={[{ label: "Move to Screening…", onClick: () => ctx.startMove("SCREENING") }, decline]} />,
      };
    case "SCREENING":
      return {
        primary: { label: "Invite to interview…", onClick: () => ctx.startMove("INTERVIEW") },
        secondary: decline,
        card: <DecisionCard title="Screening" subtitle="Interview or decline" pill="Your move" actions={[{ label: "Invite to interview…", onClick: () => ctx.startMove("INTERVIEW") }, decline]} note="Invite to interview moves the application and opens the interview email to check and send, or skip." />,
      };
    case "INTERVIEW": {
      const offerAction: Action = { label: "Make an offer…", onClick: () => (ctx.phone ? ctx.openOffer() : ctx.startMove("OFFER", ctx.offer)) };
      return {
        primary: offerAction,
        secondary: decline,
        card: <OfferDecisionCard view={view} offerAction={offerAction} decline={decline} />,
      };
    }
    case "OFFER":
      return {
        primary: { label: "Mark hired…", onClick: ctx.openHire, disabled: Boolean(view.preview.refusal) },
        secondary: decline,
        card: (
          <DecisionCard
            title="Offer made"
            subtitle={[view.offer.rate, view.offer.startDate ? `start ${view.offer.startDate}` : null].filter(Boolean).join(" · ") || "Offer details not set"}
            pill={view.stages[3]?.note?.startsWith("Sent") ? "Waiting on reply" : "Send the offer"}
            actions={[decline]}
            note="When they accept, mark them hired below. Nothing happens until you confirm."
          />
        ),
      };
    case "HIRED":
      return { primary: view.hired ? { label: "Open account", onClick: () => window.location.assign(`/v2/admin/accounts/users/${view.hired!.userId}`) } : null, secondary: null, card: null };
    default:
      return {
        primary: { label: "Move back to Screening…", onClick: () => ctx.startMove("SCREENING") },
        secondary: null,
        card: <DecisionCard title={view.stageLabel} subtitle="Closed" pill="Closed" actions={[{ label: "Move back to Screening…", onClick: () => ctx.startMove("SCREENING") }]} />,
      };
  }
}

function DecisionCard({ title, subtitle, pill, actions, note }: { title: string; subtitle: string; pill: string; actions: Action[]; note?: string }) {
  return (
    <EToneCard tone="attention" header={<div><p className="font-semibold">{title}</p><p className="text-[0.75rem] opacity-80">{subtitle}</p></div>} pill={pill}>
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <EButton key={action.label} size="sm" variant={index === 0 ? "primary" : "outline"} onClick={action.onClick} disabled={action.disabled} className={index === 0 ? "flex-1" : undefined}>{action.label}</EButton>
        ))}
      </div>
      {note ? <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</p> : null}
    </EToneCard>
  );
}

function OfferFields({ offer, onChange, kinds }: { offer: OfferDraft; onChange: (next: OfferDraft) => void; kinds: ApplicationView["hireKinds"] }) {
  const patch = (next: Partial<OfferDraft>) => onChange({ ...offer, ...next });
  const chosen = kinds.find((kind) => kind.kind === offer.accountRole);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <EField label="Account role" hint={chosen?.refusal ?? (offer.accountRole ? undefined : "Choose one: hiring no longer guesses it from the title.")}>
        <ESelect value={offer.accountRole} onChange={(e) => patch({ accountRole: e.target.value })} className="max-sm:text-[16px]">
          <option value="">Choose…</option>
          {kinds.map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
        </ESelect>
      </EField>
      <EField label="Role title on the offer">
        <EInput value={offer.roleTitle} onChange={(e) => patch({ roleTitle: e.target.value })} className="max-sm:text-[16px]" />
      </EField>
      <EField label="Pay">
        <EInput value={offer.rate} placeholder="$34.00 per hour" onChange={(e) => patch({ rate: e.target.value })} className="max-sm:text-[16px]" />
      </EField>
      <EField label="Start">
        <EInput value={offer.startDate} placeholder="Mon 23 Nov" onChange={(e) => patch({ startDate: e.target.value })} className="max-sm:text-[16px]" />
      </EField>
    </div>
  );
}

function OfferDecisionCard({ view, offerAction, decline }: { view: ApplicationView; offerAction: Action; decline: Action }) {
  const done = view.interview.label !== "Not booked" && view.stages[2]?.note.startsWith("Done");
  return (
    <EToneCard tone={done ? "attention" : "info"} header={<div><p className="font-semibold">{done ? "Interview done" : "Interview"}</p><p className="text-[0.75rem] opacity-80">Decide: offer or decline</p></div>} pill={done ? "Your move" : view.interview.label}>
      <OfferForm view={view} />
      <div className="mt-3 flex gap-2">
        <EButton size="sm" className="flex-1" onClick={offerAction.onClick}>{offerAction.label}</EButton>
        <EButton size="sm" variant="outline" onClick={decline.onClick}>{decline.label}</EButton>
      </div>
      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Make an offer moves them to Offer and opens the offer email to check and send. Decline asks for a reason and offers the decline email.</p>
    </EToneCard>
  );
}

/** The rail's offer form and the phone sheet edit the same draft, held by CandidateWorkspace. */
type OfferDraftContextValue = { offer: OfferDraft; setOffer: (next: OfferDraft) => void };
const OfferDraftContext = createContext<OfferDraftContextValue | null>(null);

function OfferForm({ view }: { view: ApplicationView }) {
  const draft = useContext(OfferDraftContext);
  if (!draft) return null;
  return (
    <>
      <OfferFields offer={draft.offer} onChange={draft.setOffer} kinds={view.hireKinds} />
      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The pay here is what the offer email says; pay rates are set on the account after hiring.</p>
    </>
  );
}

function HireChecklist({ view, sendSms, onSms, smsReason }: { view: ApplicationView; sendSms: boolean; onSms: (on: boolean) => void; smsReason: string | null }) {
  const kind = view.preview.accountLabel;
  return (
    <div className="space-y-3 text-[0.8125rem]">
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        <CheckRow ok={!view.preview.emailInUse}><span className="font-semibold">{kind ?? "No"} account</span> for {view.email}{view.preview.emailInUse ? "" : " · no other account uses this email"}</CheckRow>
        <CheckRow ok><span className="font-semibold">Invitation link</span>, valid 7 days, to set their own password</CheckRow>
        <CheckRow ok={view.preview.documents.length > 0}><span className="font-semibold">Documents requested:</span> {view.preview.documents.join(", ").toLowerCase() || "none"}</CheckRow>
        <CheckRow ok={Boolean(view.preview.learning)}><span className="font-semibold">Learning assigned:</span> {view.preview.learning || "none"}</CheckRow>
      </ul>
      <fieldset>
        <legend className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Tell {heShe(view.name)} by</legend>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked disabled className="h-4 w-4 accent-[hsl(var(--e-primary))]" /> Email (always sent with the invitation)</label>
        <label className="flex min-h-[44px] flex-wrap items-center gap-x-2">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--e-primary))]" checked={sendSms && !smsReason} disabled={Boolean(smsReason)} onChange={(e) => onSms(e.target.checked)} />
          SMS{view.phone ? ` to ${view.phone}` : ""}
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{smsReason ?? "Off unless ticked"}</span>
        </label>
      </fieldset>
    </div>
  );
}

function CheckRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 py-1.5">
      <span aria-hidden className={ok ? "text-[hsl(var(--e-primary))]" : "text-[hsl(var(--e-danger))]"}>{ok ? <Check className="mt-0.5 h-3.5 w-3.5" /> : "✕"}</span>
      <span className="sr-only">{ok ? "Will happen:" : "Blocked:"}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function HirePreviewCard({ view, sendSms, onSms, smsReason, onHire, officeKind, isAdmin }: { view: ApplicationView; sendSms: boolean; onSms: (on: boolean) => void; smsReason: string | null; onHire: () => void; officeKind: boolean; isAdmin: boolean }) {
  const ready = view.status === "OFFER" && !view.preview.refusal;
  return (
    <EToneCard tone="info" header={<div><p className="font-semibold">When you mark {heShe(view.name)} hired</p><p className="text-[0.75rem] opacity-80">From the Offer stage · nothing happens until you confirm</p></div>}>
      <HireChecklist view={view} sendSms={sendSms} onSms={onSms} smsReason={smsReason} />
      {view.preview.refusal && !view.preview.emailInUse ? <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{view.preview.refusal}</p> : null}
      <EButton variant="outline" className="mt-3 w-full" disabled={!ready} onClick={onHire}>
        Mark hired and invite…{view.status !== "OFFER" ? <span className="ml-1 text-[0.75rem] opacity-80">(after an offer)</span> : null}
      </EButton>
      {officeKind && isAdmin ? (
        <p className="mt-2 text-[0.75rem]">
          An ops manager starts with no packs. <Link className="underline" href={`/v2/admin/accounts?invite=ops_manager&application=${view.id}`}>Hire in Invite person</Link> to set packs while inviting.
        </p>
      ) : null}
    </EToneCard>
  );
}

function HiredResult({ outcome, link, linkError, onCopy, first }: { outcome: AccountCreateOutcome; link: string | null; linkError: string | null; onCopy: () => void; first: string }) {
  const accountHref = `/v2/admin/accounts/users/${outcome.user.id}`;
  if (emailFailed(outcome)) {
    return (
      <div role="alert">
        <EToneCard tone="attention" header={<div><p className="font-semibold">Invitation email failed</p><p className="text-[0.75rem] opacity-80">The account still exists</p></div>} pill="Not delivered">
          <p className="text-[0.8125rem]">The account was created, but the email could not be sent. {invitationEmailSentence(outcome)}</p>
          {link ? <p className="mt-2 break-all rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 font-mono text-[0.75rem]">{link}</p> : <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{linkError}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" onClick={onCopy}>Copy link</EButton>
            <EButton asChild size="sm"><Link href={accountHref}>Open account</Link></EButton>
          </div>
        </EToneCard>
      </div>
    );
  }
  const until = outcome.invitation ? new Date(outcome.invitation.expiresAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Sydney" }) : null;
  return (
    <div role="status">
      <EToneCard tone="good" header={<div><p className="font-semibold">Hired</p><p className="text-[0.75rem] opacity-80">Account created</p></div>} pill="Not signed in">
        <p className="text-[0.8125rem]">
          Account created for {outcome.user.name ?? outcome.user.email}. Invitation email queued{until ? `, link valid until ${until}` : ""}. Not signed in yet.
          {outcome.sms.state === "ACCEPTED" ? " SMS with the link queued." : outcome.sms.state === "NOT_SENT" || outcome.sms.state === "NO_PHONE" ? ` SMS not sent: ${outcome.sms.error ?? "unknown reason"}.` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <EButton asChild size="sm"><Link href={accountHref}>Open {first}&apos;s account</Link></EButton>
          <EButton size="sm" variant="outline" onClick={onCopy}>Copy invitation link</EButton>
        </div>
        <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Next on the account: availability, home location (used for travel distance in suggestions), pay rates.</p>
      </EToneCard>
    </div>
  );
}

function HiredCard({ view, onCopy, onResend }: { view: ApplicationView; onCopy: () => void; onResend: () => void }) {
  const hired = view.hired!;
  const failed = hired.email && hired.email.state !== "ACCEPTED" && hired.invitation?.pending;
  const pill = hired.signedIn ? "Signed in" : failed ? "Not delivered" : "Not signed in";
  return (
    <EToneCard tone={hired.signedIn ? "good" : failed ? "attention" : "good"} header={<div><p className="font-semibold">{hired.kindLabel} account created</p><p className="text-[0.75rem] opacity-80">{hired.createdLabel}</p></div>} pill={pill}>
      <p className="text-[0.8125rem]">
        {hired.signedIn
          ? "They have set a password and signed in."
          : hired.invitation?.pending
            ? `Invitation ${hired.email?.state === "ACCEPTED" ? `queued${hired.email.atLabel ? ` ${hired.email.atLabel}` : ""}` : "email not sent"}, link valid until ${hired.invitation.expiresLabel}.`
            : hired.invitation?.revoked
              ? "The invitation was withdrawn. Resend to issue a new link."
              : "The invitation has expired. Resend to issue a new link."}
        {failed && hired.email?.error ? ` The email provider said: ${hired.email.error}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <EButton asChild size="sm"><Link href={`/v2/admin/accounts/users/${hired.userId}`}>Open account</Link></EButton>
        {hired.invitation?.pending ? <EButton size="sm" variant="outline" onClick={onCopy}>Copy link</EButton> : null}
        {!hired.signedIn ? <EButton size="sm" variant="outline" onClick={onResend}>Resend invitation</EButton> : null}
      </div>
    </EToneCard>
  );
}

function Section({ title, aside, summary, children }: { title: string; aside?: string; summary: string; children: React.ReactNode }) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const id = `section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  if (phone) {
    return (
      <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <h2 id={`${id}-title`} className="m-0">
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-left">
            <span className="min-w-0"><span className="block text-[0.9375rem] font-semibold">{title}</span><span className="block text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">{summary}</span></span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </h2>
        <div id={id} hidden={!open} className="px-4 pb-4">{children}</div>
      </section>
    );
  }
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold">{title}</h2>
        {aside ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function KnowledgeTest({ view, onMessage }: { view: ApplicationView; onMessage: (m: Message) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const test = view.test;
  async function mark(answerId: string, verdict: "right" | "wrong") {
    setBusy(answerId);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(view.id)}/free-text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answerId, verdict }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onMessage({ text: body.error ?? "Not recorded.", tone: "danger" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }
  const summary = test ? `${test.score}% · ${test.freeText.filter((row) => !row.verdict).length} answers to review` : "No test result";
  return (
    <Section title="Knowledge test" aside={test ? test.label : undefined} summary={summary}>
      {test ? (
        <>
          <ul className="space-y-2">
            {test.categories.map((category) => (
              <li key={category.label} className="grid grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-[0.8125rem] sm:grid-cols-[11rem_minmax(0,1fr)_4rem]">
                <span className="truncate">{category.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[hsl(var(--e-surface-raised))]" role="img" aria-label={`${Math.round(category.score)}%`}>
                  <span className="block h-full rounded-full bg-[hsl(var(--e-primary))]" style={{ width: `${Math.max(0, Math.min(100, category.score))}%` }} />
                </span>
                <span className="e-tnum text-right">{Math.round(category.earned)} of {Math.round(category.possible)}</span>
              </li>
            ))}
          </ul>
          {test.freeText.map((row) => (
            <div key={row.id} className="mt-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Free text · {row.verdict ? `marked ${row.verdict}` : "to review"}</p>
              <p className="font-semibold">{row.prompt}</p>
              <p className="mt-1">“{row.answer}”</p>
              <div className="mt-2 flex gap-2">
                <EButton size="sm" variant={row.verdict === "right" ? "primary" : "outline"} aria-pressed={row.verdict === "right"} disabled={busy === row.id} onClick={() => mark(row.id, "right")}>Counts as right</EButton>
                <EButton size="sm" variant={row.verdict === "wrong" ? "primary" : "outline"} aria-pressed={row.verdict === "wrong"} disabled={busy === row.id} onClick={() => mark(row.id, "wrong")}>Counts as wrong</EButton>
              </div>
            </div>
          ))}
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{test.score}% is the score of the auto-marked questions (pass mark {test.passMark}%). Your calls on free-text answers are kept beside it; they do not change the stored score.</p>
        </>
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No knowledge-test result came with the application.</p>
      )}
      {view.quizzes.length ? (
        <details className="mt-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-[0.8125rem] font-[550] sm:min-h-0">Other knowledge tests sent ({view.quizzes.length})</summary>
          <div className="space-y-2">
            {(view.quizzes as Array<Record<string, any>>).map((quiz) => (
              <div key={String(quiz.id)} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5 text-[0.8125rem]">
                <p className="font-semibold">{String(quiz.quizTemplate?.name ?? "Knowledge test")}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{quiz.status === "COMPLETED" ? `Completed · ${Math.round(Number(quiz.score ?? 0))}%` : "Sent · not done"}</p>
                <QuizReview assignment={quiz as never} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </Section>
  );
}

function InterviewSection({ view, onMessage }: { view: ApplicationView; onMessage: (m: Message) => void }) {
  const router = useRouter();
  const [date, setDate] = useState(view.interview.dateInput);
  const [notes, setNotes] = useState(view.interview.notes);
  const [scores, setScores] = useState<Record<InterviewScoreKey, string>>(() => ({
    reliability: view.interview.scores.reliability ? String(view.interview.scores.reliability) : "",
    detail: view.interview.scores.detail ? String(view.interview.scores.detail) : "",
    communication: view.interview.scores.communication ? String(view.interview.scores.communication) : "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scored = INTERVIEW_SCORE_KEYS.filter((key) => scores[key]).length;

  useEffect(() => {
    setDate(view.interview.dateInput);
    setNotes(view.interview.notes);
  }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => date !== view.interview.dateInput || notes !== view.interview.notes || INTERVIEW_SCORE_KEYS.some((key) => (scores[key] || "") !== (view.interview.scores[key] ? String(view.interview.scores[key]) : "")),
    [date, notes, scores, view.interview],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(view.id)}/interview`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewDate: date ? new Date(date).toISOString() : null,
          interviewNotes: notes || null,
          scores: Object.fromEntries(INTERVIEW_SCORE_KEYS.map((key) => [key, scores[key] ? Number(scores[key]) : null])),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(`Not saved: ${body.error ?? "try again"}. Your notes are kept.`);
      onMessage({ text: "Interview notes saved.", tone: "success" });
      router.refresh();
    } catch {
      setError("Not saved: the request did not reach the server. Your notes are kept.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Interview" aside={view.interview.label} summary={`${view.interview.label}${notes ? " · notes" : ""}${scored ? ` · ${scored} scores` : ""}`}>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Interview</legend>
        <EField label="Date and time">
          <EInput type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="sm:max-w-xs max-sm:text-[16px]" />
        </EField>
        <EField label="Notes">
          <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="max-sm:text-[16px]" />
        </EField>
        <div>
          <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Scores, optional</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {INTERVIEW_SCORE_KEYS.map((key) => (
              <EField key={key} label={INTERVIEW_SCORE_LABEL[key]}>
                <ESelect value={scores[key]} onChange={(e) => setScores((current) => ({ ...current, [key]: e.target.value }))} className="max-sm:text-[16px]">
                  <option value="">–</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n} of 5</option>)}
                </ESelect>
              </EField>
            ))}
          </div>
          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Scores are optional and stay internal: never shown or sent to the candidate.</p>
        </div>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <EButton size="sm" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save notes"}</EButton>
      </fieldset>
    </Section>
  );
}

function LogReply({ applicationId, onMessage }: { applicationId: string; onMessage: (m: Message) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(applicationId)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return onMessage({ text: body.error ?? "The reply was not logged.", tone: "danger" });
      setText("");
      onMessage({ text: "Reply logged.", tone: "success" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  return (
    <details className="mt-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-[0.8125rem] font-[550] sm:min-h-0">Paste a reply they sent</summary>
      <EField label="Their reply">
        <ETextarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="max-sm:text-[16px]" />
      </EField>
      <EButton size="sm" variant="outline" className="mt-2" onClick={save} disabled={saving || !text.trim()}>{saving ? "Logging…" : "Log reply"}</EButton>
    </details>
  );
}
