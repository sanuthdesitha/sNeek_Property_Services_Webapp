"use client";

/**
 * Step 2 of the social post generator (2026-11-17): format. The server
 * renders every format from the chosen photos (no editing in place); words
 * drawn on an image are also in the caption and the alt text.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { SOCIAL_FORMATS, SOCIAL_RATIOS, type SocialFormat, type SocialRatio, type SplitLayout } from "@/lib/marketing/social/networks";
import type { GroupView } from "@/lib/marketing/social/view-types";
import { SOCIAL_API } from "./social-api";
import { cn } from "@/lib/utils";

export type FormatChange = { format?: SocialFormat; ratio?: SocialRatio; splitLayout?: SplitLayout; frameText?: string | null; beforeChecked?: string[] };

const FORMAT_NOTE: Record<SocialFormat, string> = {
  SINGLE: "The best photo, cropped to the shape below. IG · FB · GB · in · TT",
  CAROUSEL: "2 to 6 photos, all cropped to one shape (Instagram does this anyway). Google gets the first photo only.",
  BEFORE_AFTER: "Same job. The before photo needs your \"no guest belongings\" tick. Labels are drawn by the server.",
  FRAME: "Estate green band with the company name and one line of text.",
};

export type CopiesState = { state: "idle" } | { state: "making" } | { state: "failed"; message: string; problems: string[] } | { state: "ready" };

export function GeneratorFormat({ group, onChange, copies, onMakeCopies, frozen }: {
  group: GroupView;
  onChange: (change: FormatChange) => void;
  copies: CopiesState;
  onMakeCopies: () => void;
  frozen: boolean;
}) {
  const photoCount = group.photos.length;
  const before = group.photos.find((photo) => photo.role === "BEFORE") ?? null;
  const [frameText, setFrameText] = React.useState(group.frameText ?? "Guest-ready by 3 pm");
  React.useEffect(() => setFrameText(group.frameText ?? "Guest-ready by 3 pm"), [group.id, group.frameText]);
  const possible = (format: SocialFormat) => {
    const rule = SOCIAL_FORMATS.find((item) => item.key === format)!;
    if (photoCount < rule.minPhotos || photoCount > rule.maxPhotos) return false;
    const befores = group.photos.filter((photo) => photo.fieldKind === "BEFORE").length;
    return format === "BEFORE_AFTER" ? befores === 1 : befores === 0;
  };

  return (
    <fieldset disabled={frozen} className="min-w-0 space-y-4">
      <legend className="sr-only">Format</legend>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SOCIAL_FORMATS.map((format) => {
          const on = group.format === format.key;
          const allowed = possible(format.key);
          return (
            <li key={format.key}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!allowed}
                onClick={() => onChange({ format: format.key, ...(format.key === "FRAME" ? { frameText } : {}) })}
                className={cn("h-full w-full rounded-[var(--e-radius-lg)] border p-3 text-left", on ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]", !allowed && "opacity-60")}
              >
                <span className="block text-[0.875rem] font-[600]">{format.label}{on ? " · chosen" : ""}</span>
                <span className="mt-1 block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{FORMAT_NOTE[format.key]}</span>
                {!allowed ? <span className="mt-1 block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{format.minPhotos === format.maxPhotos ? `Needs ${format.minPhotos} photo${format.minPhotos === 1 ? "" : "s"}` : `Needs ${format.minPhotos} to ${format.maxPhotos} photos`}{format.key === "BEFORE_AFTER" ? ", one of them a before photo" : ""}.</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div role="group" aria-label="Shape" className="flex flex-wrap items-center gap-1.5">
        <span className="text-[0.8125rem] font-[550]">Shape</span>
        {SOCIAL_RATIOS.map((ratio) => (
          <button key={ratio} type="button" className={cn(E_CHIP_CLASS, group.ratio === ratio && E_CHIP_ON_CLASS)} aria-pressed={group.ratio === ratio} onClick={() => onChange({ ratio })}>{ratio}</button>
        ))}
      </div>

      {group.format === "BEFORE_AFTER" ? (
        <ECard className="space-y-3 p-4">
          <h3 className="text-[0.875rem] font-[600]">Before and after builder</h3>
          <div role="group" aria-label="Layout" className="flex flex-wrap gap-1.5">
            {([["SIDE", "Side by side"], ["STACK", "Top and bottom"], ["SLIDES", "Two slides"]] as const).map(([key, label]) => (
              <button key={key} type="button" className={cn(E_CHIP_CLASS, (group.splitLayout ?? "SIDE") === key && E_CHIP_ON_CLASS)} aria-pressed={(group.splitLayout ?? "SIDE") === key} onClick={() => onChange({ splitLayout: key })}>{label}</button>
            ))}
          </div>
          {before ? (
            <label className="flex min-h-11 items-start gap-2 text-[0.8125rem]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(before.beforeCheckedAt)} onChange={(event) => onChange({ beforeChecked: event.target.checked ? [before.photoId] : [] })} />
              <span>I checked the before photo: no guest belongings, faces, mail, screens or plates.</span>
            </label>
          ) : null}
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Labels &quot;Before&quot; and &quot;After&quot; are drawn by the server and repeated in the alt text. Pairs come only from the same job.</p>
        </ECard>
      ) : null}

      {group.format === "FRAME" ? (
        <ECard className="space-y-2 p-4">
          <label className="block text-[0.8125rem] font-[550]" htmlFor="social-frame-text">Line on the frame (up to 32 characters)</label>
          <div className="flex flex-wrap gap-2">
            <input id="social-frame-text" maxLength={32} value={frameText} onChange={(event) => setFrameText(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 max-sm:text-[1rem]" />
            <EButton size="sm" variant="outline" onClick={() => onChange({ frameText })} disabled={(group.frameText ?? "") === frameText}>Use this line</EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The words are checked for addresses and names like the caption. Put the same words in the caption too.</p>
        </ECard>
      ) : null}

      <ECard className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[0.875rem] font-[600]">Cleaned copies</h3>
          <EButton size="sm" variant="outline" onClick={onMakeCopies} disabled={copies.state === "making"}>{copies.state === "making" ? "Making copies…" : group.derivatives.length ? "Make them again" : "Make the copies"}</EButton>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Stamp band and top strip cut off, camera and location data removed, saved as new files in Images and linked to the photo and job. The original evidence photos are unchanged.</p>
        {copies.state === "failed" ? (
          <EToneNotice tone="problem" role="alert" title={copies.message}>{copies.problems.length ? <ul className="list-disc pl-4">{copies.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}</EToneNotice>
        ) : null}
        {group.derivatives.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {group.derivatives.map((copy, index) => (
              <li key={copy.assetId} className="min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${SOCIAL_API}/derivatives/${copy.assetId}`} alt={`Cleaned copy ${index + 1}`} className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover" />
                <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{copy.width} × {copy.height} · no metadata</p>
              </li>
            ))}
          </ul>
        ) : copies.state !== "making" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not made yet. They are made before posting either way.</p> : <p role="status" className="text-[0.75rem]">Making the cleaned copies…</p>}
      </ECard>
    </fieldset>
  );
}
