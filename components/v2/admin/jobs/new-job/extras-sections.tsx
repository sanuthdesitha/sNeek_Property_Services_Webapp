"use client";

/**
 * Sections 5–7: what the laundry rules will do (a preview of the live rule
 * book, planning nothing), extras and instructions, and the client's booking
 * email with its gate and transport.
 */
import { useState } from "react";
import Link from "next/link";
import { EInput, ETextarea, EField } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { ETonePill } from "@/components/v2/ui/tone-band";
import { NoticeImagesInput } from "@/components/v2/admin/jobs/notice-images-input";
import { JobAttachmentsInput } from "@/components/v2/admin/jobs/job-attachments-input";
import { dayLabel, type GuestDraft, type NewJobDraft } from "@/lib/jobs/new-job/draft";
import type { NewJobBookingEmail, NewJobLaundryPreview, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";
import { ChoiceChip, Disclosure, Faint, NewMark } from "./new-job-ui";

const SCENARIO_TEXT: Record<string, { title: string; detail: string }> = {
  BACK_TO_BACK: { title: "Back to back", detail: "next clean within a day" },
  MICRO_CYCLE: { title: "Micro-cycle", detail: "next clean within three days" },
  COMPRESSED: { title: "Compressed", detail: "more than three days to the next clean" },
  FALLBACK: { title: "No next clean yet", detail: "fallback return window" },
  KEY_LOST: { title: "Key lost", detail: "pickup and drop on the clean day" },
};

export function laundrySummary(preview: NewJobLaundryPreview | null | undefined): string {
  if (!preview) return "Choose a date";
  if (preview.kind === "not_applicable") return "Not applicable";
  if (preview.kind === "unavailable") return "Preview unavailable";
  return `Preview: ${dayLabel(preview.pickupDate)} → ${dayLabel(preview.dropoffDate)}`;
}

export function LaundryPreviewBody({ preview, compact = false }: { preview: NewJobLaundryPreview | null; compact?: boolean }) {
  if (!preview) return <Faint>Choose a property and a date to preview the laundry run.</Faint>;
  if (preview.kind !== "preview") return <Faint>{preview.reason}</Faint>;
  const scenario = SCENARIO_TEXT[preview.scenario] ?? { title: preview.scenario, detail: "" };
  if (compact) {
    return (
      <p className="text-[0.8125rem]">
        Pickup <strong>{dayLabel(preview.pickupDate)}</strong> · Drop <strong>{dayLabel(preview.dropoffDate)}</strong> · {scenario.title}
        {preview.flagged ? <span className="text-[hsl(var(--e-band-attention-fg))]"> · flagged: {preview.note}</span> : null}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Pickup</p>
          <p className="text-[0.9375rem] font-[600]">{dayLabel(preview.pickupDate)}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{preview.pickupTime ? `partner time ${preview.pickupTime}` : "no partner time that day"}</p>
        </div>
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Drop-off</p>
          <p className="text-[0.9375rem] font-[600]">{dayLabel(preview.dropoffDate)}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {preview.nextCleanDayKey ? `next known clean ${dayLabel(preview.nextCleanDayKey)}` : "no next clean known yet"}
            {preview.dropoffTime ? ` · partner time ${preview.dropoffTime}` : " · no partner time that day"}
          </p>
        </div>
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Scenario</p>
          <p className="text-[0.9375rem] font-[600]">{scenario.title}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{scenario.detail}{preview.flagged ? ` · flagged: ${preview.flagReason ?? ""}` : ", no flag"}</p>
        </div>
      </div>
      <Faint>
        Preview only: no run is planned now. The run is made when the office approves the week&apos;s plan or the calendar-sync draft, or when the cleaner reports laundry. Rule changes made later can still re-plan it while it is pending. Other dates picked on this page are not counted until they are created.
      </Faint>
    </div>
  );
}

export function LaundryAside({ preview }: { preview: NewJobLaundryPreview | null }) {
  return (
    <Link href="/v2/admin/settings/scheduling-rules" className="text-[hsl(var(--e-primary))] underline">
      {preview?.kind === "preview" ? `Scheduling rules, live version ${preview.rulesVersion}` : "Scheduling rules"}
    </Link>
  );
}

export type ExtrasSectionProps = {
  draft: NewJobDraft;
  facts: NewJobPropertyFacts | null;
  update: (patch: Partial<NewJobDraft>) => void;
  compact?: boolean;
};

function GuestFields({ guest, onChange }: { guest: GuestDraft; onChange: (patch: Partial<GuestDraft>) => void }) {
  const set = (key: keyof GuestDraft) => (event: { target: { value: string } }) => onChange({ [key]: event.target.value } as Partial<GuestDraft>);
  return (
    <div className="space-y-3">
      <Faint>Optional for jobs made here; calendar-synced turnovers fill these in automatically.</Faint>
      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Guest name"><EInput value={guest.guestName} onChange={set("guestName")} /></EField>
        <EField label="Reservation code"><EInput value={guest.reservationCode} onChange={set("reservationCode")} /></EField>
      </div>
      <div className="grid gap-3 grid-cols-3">
        <EField label="Adults"><EInput type="number" min="0" value={guest.adults} onChange={set("adults")} /></EField>
        <EField label="Children"><EInput type="number" min="0" value={guest.children} onChange={set("children")} /></EField>
        <EField label="Infants"><EInput type="number" min="0" value={guest.infants} onChange={set("infants")} /></EField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Guest phone"><EInput type="tel" inputMode="tel" maxLength={20} value={guest.guestPhone} onChange={set("guestPhone")} /></EField>
        <EField label="Guest email"><EInput type="email" value={guest.guestEmail} onChange={set("guestEmail")} /></EField>
        <EField label="Check-in"><EInput type="datetime-local" value={guest.checkinAtLocal} onChange={set("checkinAtLocal")} /></EField>
        <EField label="Checkout"><EInput type="datetime-local" value={guest.checkoutAtLocal} onChange={set("checkoutAtLocal")} /></EField>
      </div>
      <EField label="Guest profile URL"><EInput value={guest.guestProfileUrl} onChange={set("guestProfileUrl")} /></EField>
      <EField label="Booking location or extra details"><ETextarea value={guest.locationText} onChange={set("locationText")} /></EField>
    </div>
  );
}

export function ExtrasSection({ draft, facts, update, compact = false }: ExtrasSectionProps) {
  const [writing, setWriting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPhoto, setNewPhoto] = useState(true);
  const chosenTitles = new Set(draft.specialTasks.map((task) => task.title));
  const suggestions = (facts?.recentTaskTitles ?? []).filter((title) => !chosenTitles.has(title));

  function addTask(title: string, requiresPhoto: boolean) {
    const clean = title.trim();
    if (!clean || chosenTitles.has(clean)) return;
    update({ specialTasks: [...draft.specialTasks, { id: `task-${Date.now()}`, title: clean, requiresPhoto }] });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[0.75rem] font-[600] uppercase tracking-wide text-[hsl(var(--e-text-secondary))]">Special tasks on the cleaner&apos;s form</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Special tasks">
          {draft.specialTasks.map((task) => (
            <ChoiceChip key={task.id} selected onClick={() => update({ specialTasks: draft.specialTasks.filter((item) => item.id !== task.id) })}>
              {task.title}{task.requiresPhoto ? " · photo required" : ""}<span className="sr-only"> (selected, press to remove)</span> ✕
            </ChoiceChip>
          ))}
          {suggestions.map((title) => (
            <ChoiceChip key={title} selected={false} onClick={() => addTask(title, false)}>{title}</ChoiceChip>
          ))}
          <ChoiceChip selected={false} onClick={() => setWriting((value) => !value)}>+ {compact ? "Task" : "Write a task"}</ChoiceChip>
        </div>
        {writing ? (
          <div className="flex flex-wrap items-end gap-2">
            <EField label="Task" className="min-w-[12rem] flex-1">
              <EInput value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={160} className="max-sm:text-[16px]" />
            </EField>
            <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
              <input type="checkbox" checked={newPhoto} onChange={(event) => setNewPhoto(event.target.checked)} /> Photo required
            </label>
            <EButton type="button" size="sm" variant="outline" disabled={!newTitle.trim()} onClick={() => { addTask(newTitle, newPhoto); setNewTitle(""); setWriting(false); }}>Add task</EButton>
          </div>
        ) : null}
        <Faint>Each becomes a task with its own photo and note rules. Priced extras from the quote catalogue are added after create from the job page, which emails the client the new total.</Faint>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <EField label={draft.noticeImportant ? "Notice at the door (Important)" : "Notice at the door"}>
            <ETextarea value={draft.notice} onChange={(event) => update({ notice: event.target.value })} maxLength={2000} className="max-sm:text-[16px]" />
          </EField>
          <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
            <input type="checkbox" checked={draft.noticeImportant} onChange={(event) => update({ noticeImportant: event.target.checked })} /> Important (the cleaner acknowledges it)
          </label>
          <Faint>Up to 6 photos · shown on the start briefing</Faint>
          <NoticeImagesInput value={draft.noticeImages} onChange={(noticeImages) => update({ noticeImages })} />
        </div>
        <EField label="Internal note, office only">
          <ETextarea value={draft.internalNote} onChange={(event) => update({ internalNote: event.target.value })} className="max-sm:text-[16px]" />
        </EField>
      </div>
      <div className="space-y-2">
        {draft.jobType === "AIRBNB_TURNOVER" ? (
          <Disclosure summary="Guest and booking details (filled by the calendar)">
            <GuestFields guest={draft.guest} onChange={(patch) => update({ guest: { ...draft.guest, ...patch } })} />
          </Disclosure>
        ) : null}
        <Disclosure summary="Tags and reference files">
          <EField label="Tags" hint="Comma-separated"><EInput value={draft.tagsText} onChange={(event) => update({ tagsText: event.target.value })} /></EField>
          <EField label="Reference files" hint="Attached to every job created from this page.">
            <JobAttachmentsInput value={draft.attachments} onChange={(attachments) => update({ attachments })} />
          </EField>
        </Disclosure>
        <Disclosure summary="Cleaner notes">
          <EField label="Cleaner notes"><ETextarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} /></EField>
        </Disclosure>
      </div>
    </div>
  );
}

export function emailAside(email: NewJobBookingEmail | null): { tone: "good" | "attention" | null; text: string } {
  if (!email) return { tone: null, text: "" };
  if (!email.applies) return { tone: "attention", text: "No client to email" };
  return email.blockedReason ? { tone: "attention", text: "Booking emails off" } : { tone: "good", text: "Booking emails on for this client" };
}

export function ClientEmailSection({ email, draft, update, loading, compact = false }: { email: NewJobBookingEmail | null; draft: NewJobDraft; update: (patch: Partial<NewJobDraft>) => void; loading: boolean; compact?: boolean }) {
  const aside = emailAside(email);
  return (
    <div className="space-y-3">
      {aside.tone && !compact ? <div className="sm:hidden"><ETonePill tone={aside.tone}>{aside.text}</ETonePill></div> : null}
      {!email ? (
        <Faint>{loading ? "Reading the client's email settings…" : "Choose a property and a date to preview the booking email."}</Faint>
      ) : (
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
          <p className="text-[hsl(var(--e-text-secondary))]">
            Email · {email.recipients.length ? `to ${email.recipients.join(", ")}` : "no recipient on file"}
          </p>
          {email.subject ? <p className="mt-1 font-[600]">{email.subject}</p> : null}
          {email.bodyText ? <p className="mt-1 whitespace-pre-line text-[hsl(var(--e-text-secondary))]">{email.bodyText}</p> : null}
        </div>
      )}
      {email?.blockedReason ? <p className="text-[0.8125rem] text-[hsl(var(--e-band-attention-fg))]">Would not be sent today: {email.blockedReason}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Faint>Sent by the booking-confirmation email when the job is saved, if email automation is on and the client has not opted out. Email only; no SMS or push.</Faint>
        <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" checked={!draft.sendBookingConfirmation} onChange={(event) => update({ sendBookingConfirmation: !event.target.checked })} />
          Do not send for this job <NewMark />
        </label>
      </div>
    </div>
  );
}
