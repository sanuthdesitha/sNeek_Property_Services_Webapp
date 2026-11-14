"use client";

import * as React from "react";
import Link from "next/link";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { findEmailDesign as emailDesign } from "@/lib/email-design/all-designs";
import { checkBrandColour, COLOUR_PRESETS, FOOTER_EXTRA_LIMIT, formatRatio, isHexColour, themeContrastReport, themeProblems } from "@/lib/email-design/theme";
import { BUTTON_SHAPES, HEADING_STYLES, type ButtonShape, type EmailTheme, type HeadingStyle } from "@/lib/email-design/types";
import type { LookViewResponse } from "@/lib/email-design/view-types";
import { sendJson } from "../use-notification-read";
import { newIdempotencyKey } from "./design-model";
import { EmailPreview } from "./email-preview";

const SHAPE_LABEL: Record<ButtonShape, string> = { square: "Square", rounded: "Rounded", pill: "Pill" };
const HEADING_LABEL: Record<HeadingStyle, string> = { serif: "Serif", sans: "Sans" };

const inputClass = "min-h-[44px] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm";

function formatTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Settings › Company & brand › Email look (approved board "Email design
 * system", section 3). Administrators change the logo, the brand colour
 * (five checked presets or a custom colour that must give button text
 * 4.5:1), button shape, heading style, sender name, reply-to and one extra
 * footer line. Saving keeps a draft; publishing changes every email and asks
 * for the administrator's own PIN (tier C, checked on the server). Business
 * details come from Company details and are not edited here.
 */
export function EmailLookScreen({ initial, timeZone }: { initial: LookViewResponse; timeZone: string }) {
  const [view, setView] = React.useState(initial);
  const [draft, setDraft] = React.useState<EmailTheme>(initial.row.draft?.theme ?? initial.published);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState<null | "save" | "discard" | "publish" | "test">(null);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [customInput, setCustomInput] = React.useState(initial.row.draft?.theme.preset === "custom" ? initial.row.draft.theme.brandColor : "#2F6B4F");
  const publishKey = React.useRef(newIdempotencyKey());
  const idBase = React.useId();
  const preview = emailDesign("quoteSentToClient")!;

  const disabled = !view.canEdit || saving !== null;
  const problems = themeProblems(draft);
  const customCheck = checkBrandColour(customInput);
  const contrast = themeContrastReport(draft);
  const hasDraft = Boolean(view.row.draft) || dirty;

  function update(patch: Partial<EmailTheme>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setMessage(null);
  }

  async function saveDraft() {
    setSaving("save");
    const result = await sendJson("/api/admin/notifications/email-look", "PUT", { action: "DRAFT", theme: draft, expectedRevision: view.row.revision });
    setSaving(null);
    if (!result.ok) {
      setMessage({ tone: result.status === 409 ? "warning" : "danger", text: result.status === 409 ? `${result.error} Reload the page to see it; your choices are still here.` : `Draft not saved: ${result.error}` });
      return;
    }
    setView(result.body as LookViewResponse);
    setDirty(false);
    setMessage({ tone: "success", text: "Draft saved. Nothing changes for recipients until it is published." });
  }

  async function discard() {
    setSaving("discard");
    const result = await sendJson("/api/admin/notifications/email-look", "PUT", { action: "DISCARD", expectedRevision: view.row.revision });
    setSaving(null);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.error });
      return;
    }
    const next = result.body as LookViewResponse;
    setView(next);
    setDraft(next.published);
    setDirty(false);
    setMessage({ tone: "success", text: "Draft discarded. The published look is unchanged." });
  }

  async function publish(confirm: ConfirmResult) {
    setSaving("publish");
    setPublishError(null);
    const result = await sendJson("/api/admin/notifications/email-look/publish", "POST", { expectedRevision: view.row.revision, idempotencyKey: publishKey.current, security: confirm.credentials });
    setSaving(null);
    if (!result.ok) {
      setPublishError(`It was not published: ${result.error}`);
      return;
    }
    const body = result.body as { version: number; view: LookViewResponse };
    publishKey.current = newIdempotencyKey();
    setView(body.view);
    setDraft(body.view.published);
    setDirty(false);
    setPublishOpen(false);
    setMessage({ tone: "success", text: `Email look v${body.version} published. Every email uses it from the next send.` });
  }

  async function sendTest() {
    setSaving("test");
    const result = await sendJson("/api/admin/notifications/email-look/test", "POST", { theme: draft });
    setSaving(null);
    if (!result.ok) {
      setMessage({ tone: "danger", text: result.error });
      return;
    }
    const outcome = result.body as { state: string; message: string };
    setMessage({ tone: outcome.state === "provider_accepted" ? "success" : "warning", text: outcome.message });
  }

  const published = view.row.versions.find((item) => item.version === view.row.publishedVersion);
  const statusText = published ? `Published v${published.version} · ${formatTime(published.savedAt, timeZone)} by ${published.actor.name ?? "an administrator"}` : "Standard look (not changed yet)";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm">
        <span className="font-medium">{statusText}</span>
        {hasDraft ? <span className="ml-2 rounded-full bg-[hsl(var(--e-band-attention-bg))] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--e-band-attention-fg))]">{dirty ? "Unsaved changes" : "Draft has changes"}</span> : null}
      </p>
      {!view.canEdit && view.editReason ? <EAlert tone="info" title="View only">{view.editReason}</EAlert> : null}
      {message ? <div role={message.tone === "danger" ? "alert" : "status"}><EAlert tone={message.tone === "success" ? "success" : message.tone} title={message.tone === "success" ? "Done" : message.tone === "warning" ? "Check this" : "Not done"}>{message.text}</EAlert></div> : null}

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <ECard className="min-w-0 flex-1 p-4">
          <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
            <legend className="sr-only">Email look</legend>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${idBase}-logo`} className="text-sm font-medium">Logo (link to a PNG or SVG)</label>
                <input id={`${idBase}-logo`} className={inputClass} value={draft.logoUrl} placeholder="Empty uses the Company & brand logo" onChange={(event) => update({ logoUrl: event.target.value })} />
                <p className="text-xs text-[hsl(var(--e-muted-foreground))]">At least 400 px wide, transparent background, https only. Empty: the Company & brand logo{view.business.logoUrl ? "" : " (none set, so the company name is shown)"}.</p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${idBase}-logo-dark`} className="text-sm font-medium">Logo on dark backgrounds</label>
                <input id={`${idBase}-logo-dark`} className={inputClass} value={draft.logoDarkUrl} placeholder="Empty uses the dark-background logo" onChange={(event) => update({ logoDarkUrl: event.target.value })} />
                <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Used by mail apps in dark mode.</p>
              </div>
            </div>

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Brand colour (buttons, links, logo text)</legend>
              {COLOUR_PRESETS.map((preset) => {
                const ratio = checkBrandColour(preset.color).ratio;
                return (
                  <label key={preset.id} className={`flex min-h-[44px] items-center gap-3 rounded-[var(--e-radius)] border px-3 ${draft.preset === preset.id ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]"}`}>
                    <input type="radio" name={`${idBase}-colour`} checked={draft.preset === preset.id} onChange={() => update({ preset: preset.id, brandColor: preset.color })} />
                    <span aria-hidden className="h-6 w-6 rounded-[var(--e-radius-sm)] border border-black/10" style={{ background: preset.color }} />
                    <span className="flex-1 text-sm">{preset.label} <span className="font-mono text-xs text-[hsl(var(--e-muted-foreground))]">{preset.color}</span></span>
                    <span className="rounded-full bg-[hsl(var(--e-band-good-bg))] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--e-band-good-fg))]">{formatRatio(ratio)} AA</span>
                  </label>
                );
              })}
              <div className={`flex flex-col gap-2 rounded-[var(--e-radius)] border px-3 py-2 ${draft.preset === "custom" ? (customCheck.ok ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))]") : "border-[hsl(var(--e-border))]"}`}>
                <div className="flex min-h-[44px] flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-3 text-sm">
                    <input type="radio" name={`${idBase}-colour`} checked={draft.preset === "custom"} disabled={!customCheck.ok} onChange={() => update({ preset: "custom", brandColor: customInput.toUpperCase() })} />
                    Custom
                  </label>
                  <label htmlFor={`${idBase}-custom`} className="sr-only">Custom colour (hex)</label>
                  <input
                    id={`${idBase}-custom`}
                    value={customInput}
                    maxLength={7}
                    onChange={(event) => {
                      const value = event.target.value.trim();
                      setCustomInput(value);
                      if (draft.preset === "custom" && isHexColour(value) && checkBrandColour(value).ok) update({ brandColor: value.toUpperCase() });
                    }}
                    aria-describedby={`${idBase}-custom-help`}
                    className="min-h-[44px] w-32 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 font-mono text-base sm:text-sm"
                  />
                  {isHexColour(customInput) ? <span aria-hidden className="h-6 w-6 rounded-[var(--e-radius-sm)] border border-black/10" style={{ background: customInput }} /> : null}
                  <span className={`text-xs font-semibold ${customCheck.ok ? "text-[hsl(var(--e-band-good-fg))]" : "text-[hsl(var(--e-band-problem-fg))]"}`}>
                    {isHexColour(customInput) ? `${formatRatio(customCheck.ratio)} ${customCheck.ok ? "AA" : "too light"}` : "Enter # and six digits"}
                  </span>
                </div>
                <p id={`${idBase}-custom-help`} className="text-xs">
                  Button text must reach 4.5:1. A custom colour that fails cannot be saved.
                  {!customCheck.ok && customCheck.suggestion ? (
                    <> The nearest shade that passes is <span className="font-mono">{customCheck.suggestion}</span> ({formatRatio(customCheck.suggestionRatio ?? 0)}). <button type="button" className="underline" onClick={() => { setCustomInput(customCheck.suggestion!); update({ preset: "custom", brandColor: customCheck.suggestion! }); }}>Use it</button></>
                  ) : null}
                </p>
              </div>
            </fieldset>

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">Button shape</legend>
                <div className="flex gap-2">
                  {BUTTON_SHAPES.map((shape) => (
                    <label key={shape} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[var(--e-radius)] border px-2 text-sm ${draft.buttonShape === shape ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))] font-semibold" : "border-[hsl(var(--e-border))]"}`}>
                      <input type="radio" className="sr-only" name={`${idBase}-shape`} checked={draft.buttonShape === shape} onChange={() => update({ buttonShape: shape })} />
                      {SHAPE_LABEL[shape]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Outlook on Windows may draw buttons with square corners; the button stays readable either way.</p>
              </fieldset>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">Headings</legend>
                <div className="flex gap-2">
                  {HEADING_STYLES.map((style) => (
                    <label key={style} className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[var(--e-radius)] border px-2 text-sm ${draft.headingStyle === style ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))] font-semibold" : "border-[hsl(var(--e-border))]"}`}>
                      <input type="radio" className="sr-only" name={`${idBase}-heading`} checked={draft.headingStyle === style} onChange={() => update({ headingStyle: style })} />
                      {HEADING_LABEL[style]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${idBase}-sender`} className="text-sm font-medium">Sender name</label>
                <input id={`${idBase}-sender`} className={inputClass} value={draft.senderName} maxLength={80} placeholder={view.business.companyName} onChange={(event) => update({ senderName: event.target.value })} />
                <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Sending address <span className="font-mono">{view.sendingAddress}</span> is set by the server. Empty keeps the name in that setting.</p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${idBase}-reply`} className="text-sm font-medium">Reply-to</label>
                <input id={`${idBase}-reply`} type="email" className={inputClass} value={draft.replyTo} maxLength={200} placeholder={view.officeInbox || "office@…"} onChange={(event) => update({ replyTo: event.target.value })} />
                <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Client and staff replies go here. Empty: the office inbox{view.officeInbox ? ` (${view.officeInbox})` : ""}. Security emails never set a reply-to.</p>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium">Footer</span>
              <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-sm">
                {[view.business.companyName, view.business.abn ? `ABN ${view.business.abn}` : null, view.business.address || null, view.business.phone || null].filter(Boolean).join(" · ")}
                {" "}<Link className="underline" href="/v2/admin/settings?tab=company">Edit in Company details</Link>
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${idBase}-extra`} className="text-sm font-medium">Extra footer line (optional)</label>
              <input id={`${idBase}-extra`} className={inputClass} value={draft.footerExtra} maxLength={FOOTER_EXTRA_LIMIT} onChange={(event) => update({ footerExtra: event.target.value })} aria-describedby={`${idBase}-extra-help`} />
              <p id={`${idBase}-extra-help`} className="text-xs text-[hsl(var(--e-muted-foreground))]">{FOOTER_EXTRA_LIMIT} characters · {draft.footerExtra.length} used. The why-line and the Email preferences link are added by the system and can't be removed.</p>
            </div>
          </fieldset>
          {problems.length ? <div className="mt-3"><EAlert tone="warning" title="Fix before saving"><ul className="list-disc pl-4">{problems.map((problem) => <li key={problem.field}>{problem.message}</li>)}</ul></EAlert></div> : null}
          <div className="mt-4 flex flex-col gap-2 border-t border-[hsl(var(--e-border))] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Saving keeps a draft. Publishing changes every email and asks for your PIN.</p>
            <div className="flex flex-wrap gap-2 max-sm:hidden">
              <EButton variant="ghost" className="min-h-[44px]" disabled={disabled || !hasDraft} onClick={() => void discard()}>Discard draft</EButton>
              <EButton variant="outline" className="min-h-[44px]" disabled={disabled || problems.length > 0} onClick={() => void sendTest()}>{saving === "test" ? "Sending…" : "Send test to me"}</EButton>
              <EButton variant="outline" className="min-h-[44px]" disabled={disabled || !dirty || problems.length > 0} onClick={() => void saveDraft()}>{saving === "save" ? "Saving…" : "Save draft"}</EButton>
              <EButton className="min-h-[44px]" disabled={!view.canPublish || saving !== null || dirty || !view.row.draft} onClick={() => { setPublishError(null); setPublishOpen(true); }}>Publish…</EButton>
            </div>
          </div>
          {!view.canPublish && view.canEdit && view.publishReason ? <p className="mt-2 text-xs">{view.publishReason}</p> : null}
          {dirty ? <p className="mt-2 text-xs">Save the draft before publishing.</p> : null}
        </ECard>

        <aside aria-label="Live preview" className="flex min-w-0 flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 lg:w-[min(46%,690px)] lg:flex-none">
          <h2 className="text-sm font-semibold">Live preview · {dirty || view.row.draft ? "draft" : "published"}</h2>
          <EmailPreview definition={preview} doc={preview.defaults} theme={draft} business={view.business} appUrl={view.appUrl} label="Email look preview" />
          <section aria-label="Contrast checks" className="border-t border-[hsl(var(--e-border))] pt-3">
            <h3 className="text-sm font-semibold">Checked on every publish</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {contrast.map((item) => (
                <li key={item.label} className="flex flex-wrap justify-between gap-2"><span>{item.label}</span><span className={item.ok ? "text-[hsl(var(--e-band-good-fg))]" : "text-[hsl(var(--e-band-problem-fg))]"}>{formatRatio(item.light)} light · {formatRatio(item.dark)} dark{item.ok ? "" : " · too low"}</span></li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <EPhoneActionBar
        label="Email look actions"
        secondary={<EButton variant="outline" className="min-h-[44px]" disabled={disabled || !dirty || problems.length > 0} onClick={() => void saveDraft()}>Save draft</EButton>}
        primary={<EButton className="min-h-[44px]" disabled={!view.canPublish || saving !== null || dirty || !view.row.draft} onClick={() => { setPublishError(null); setPublishOpen(true); }}>Publish…</EButton>}
      />
      <EConfirmDialog
        open={publishOpen}
        onClose={() => { if (saving !== "publish") setPublishOpen(false); }}
        tier="sensitive"
        title="Publish the Email look?"
        description="Every email uses this look from the next send. Emails already sent don't change."
        confirmLabel="Publish"
        busy={saving === "publish"}
        error={publishError}
        onConfirm={publish}
      />
    </div>
  );
}
