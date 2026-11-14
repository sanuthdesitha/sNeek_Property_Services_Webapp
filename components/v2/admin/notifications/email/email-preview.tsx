"use client";

import * as React from "react";
import { composeDesign } from "@/lib/email-design/compose";
import type { BusinessDetails, EmailDesignDefinition, EmailDocument, EmailTheme } from "@/lib/email-design/types";
import { previewValues } from "./design-model";

export const PREVIEW_MODES = ["desktop", "phone", "dark", "text"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
const MODE_LABEL: Record<PreviewMode, string> = { desktop: "Desktop", phone: "Phone", dark: "Dark", text: "Plain text" };

type Props = {
  definition: EmailDesignDefinition;
  doc: EmailDocument;
  theme: EmailTheme;
  business: BusinessDetails;
  appUrl: string;
  label: string;
};

/**
 * The live preview: the real renderer (the same function the send path
 * uses) in a sandboxed frame, at desktop or phone width, forced dark, or the
 * generated plain-text part. A sample picker and a missing-values switch show
 * rows disappearing and required values marked instead of blanks.
 */
export function EmailPreview({ definition, doc, theme, business, appUrl, label }: Props) {
  const [mode, setMode] = React.useState<PreviewMode>("desktop");
  const [sampleId, setSampleId] = React.useState(definition.samples[0]?.id ?? "typical");
  const [missing, setMissing] = React.useState(false);
  const deferredDoc = React.useDeferredValue(doc);
  const rendered = React.useMemo(
    () => composeDesign(definition, deferredDoc, previewValues(definition, sampleId, missing), { theme, business, appUrl, mode: "preview", scheme: mode === "dark" ? "dark" : "light", settings: { companyName: business.companyName, accountsEmail: business.contactEmail } }),
    [definition, deferredDoc, sampleId, missing, theme, business, appUrl, mode],
  );
  const sampleSelectId = React.useId();
  const missingId = React.useId();
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label="Preview as" className="flex gap-0.5 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] p-1">
        {PREVIEW_MODES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            onClick={() => setMode(item)}
            className={`min-h-[40px] flex-1 rounded-[var(--e-radius-sm)] px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] ${mode === item ? "bg-[hsl(var(--e-surface))] font-semibold shadow-sm" : "text-[hsl(var(--e-muted-foreground))]"}`}
          >
            {MODE_LABEL[item]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={sampleSelectId} className="sr-only">Sample data</label>
        <select
          id={sampleSelectId}
          value={sampleId}
          onChange={(event) => setSampleId(event.target.value)}
          className="min-h-[44px] min-w-0 flex-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm"
        >
          {definition.samples.map((sample) => <option key={sample.id} value={sample.id}>Sample: {sample.label}</option>)}
        </select>
        <label htmlFor={missingId} className="inline-flex min-h-[44px] items-center gap-2 text-sm">
          <input id={missingId} type="checkbox" checked={missing} onChange={(event) => setMissing(event.target.checked)} className="h-5 w-5" />
          Show with missing values
        </label>
      </div>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">
        Subject: <span className="font-medium text-[hsl(var(--e-foreground))]">{rendered.subject || "(empty)"}</span>
        {rendered.preheader ? <> · Preheader: {rendered.preheader}</> : null}
      </p>
      {rendered.missing.length ? (
        <p role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-attention-line))] bg-[hsl(var(--e-band-attention-bg))] px-3 py-2 text-sm">
          Sending would be refused: {rendered.missing.join(", ")} missing. Nothing goes out with a blank.
        </p>
      ) : null}
      {mode === "text" ? (
        <pre aria-label="Plain-text part" className="max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 font-mono text-[0.8125rem] leading-relaxed">{rendered.text}</pre>
      ) : (
        <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))] p-2">
          <iframe
            title={`${label}: ${MODE_LABEL[mode]}`}
            sandbox=""
            srcDoc={rendered.html}
            className="mx-auto block h-[720px] max-w-full border-0 bg-white"
            style={{ width: mode === "phone" ? 360 : 640 }}
          />
        </div>
      )}
    </section>
  );
}
