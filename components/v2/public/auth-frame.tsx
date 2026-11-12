/**
 * The Estate frame for screens a person sees before they have a portal:
 * invitation links and password reset (board "Public and sign in", 2026-11).
 * Layout only — the wordmark, one card, one h1, one main landmark. Pages
 * outside /v2 load `app/v2/estate.css` themselves; the tokens are scoped by
 * `data-skin="estate"`, so nothing else on the page changes.
 *
 * No "use client": server and client pages both render it.
 */
import * as React from "react";
import { EEyebrow } from "@/components/v2/ui/primitives";

export function AuthFrame({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-skin="estate" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <p className="e-serif mb-4 text-center text-[1.25rem] font-[520]">sNeek</p>
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 shadow-[var(--e-elevation-1)]">
          {eyebrow ? <EEyebrow>{eyebrow}</EEyebrow> : null}
          <h1 className="e-display-sm mt-1">{title}</h1>
          {intro ? <div className="mt-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{intro}</div> : null}
          <div className="mt-5">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Estate input styling for native inputs on these screens. */
export const AUTH_INPUT_CLASS =
  "h-12 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] " +
  "px-3 text-base text-[hsl(var(--e-foreground))] focus:outline-none focus:border-[hsl(var(--e-gold))] " +
  "focus:ring-2 focus:ring-[hsl(var(--e-ring))] disabled:opacity-50";

export const AUTH_LABEL_CLASS = "block text-[0.8125rem] font-[550] text-[hsl(var(--e-text-secondary))]";
