"use client";

/**
 * The one-time display of new two-step backup codes (2026-11-17). Shown
 * straight after two-step is turned on, or after "Make new backup codes",
 * from the codes the server returned in that one response. The server keeps
 * only hashes, so once this closes the codes cannot be shown again.
 *
 * Copy (clipboard), Download as a .txt file and Print (the same plain text in
 * a hidden frame, built with DOM text nodes, no HTML strings). The codes are
 * never written to storage, the URL or the console. While they are on screen
 * the section is marked busy, so no tour or welcome opens over them.
 */
import * as React from "react";
import { Copy, Download, Printer } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { backupCodesText } from "@/lib/auth/backup-code-format";

export type BackupCodesDisplayProps = {
  codes: readonly string[];
  /** Organisation-time label of when they were made ("Tue 17 Nov 2026, 9:42 am"). */
  createdLabel: string;
  accountEmail: string | null;
  /** Called when the person says they have saved them; the caller forgets the codes. */
  onDone: () => void;
  doneLabel?: string;
};

type ActionNote = { tone: "ok" | "error"; text: string } | null;

function printText(text: string): boolean {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    return false;
  }
  const pre = frameDocument.createElement("pre");
  pre.style.font = "14px/1.6 ui-monospace, monospace";
  pre.textContent = text;
  frameDocument.body.appendChild(pre);
  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(() => frame.remove(), 1000);
  return true;
}

export function BackupCodesDisplay({ codes, createdLabel, accountEmail, onDone, doneLabel = "I've saved them" }: BackupCodesDisplayProps) {
  const headingId = React.useId();
  const [note, setNote] = React.useState<ActionNote>(null);
  const text = React.useMemo(() => backupCodesText({ codes, accountEmail, createdLabel }), [codes, accountEmail, createdLabel]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ tone: "ok", text: "Copied. Paste them somewhere safe, like a password manager." });
    } catch {
      setNote({ tone: "error", text: "Copy did not work in this browser. Download or print them instead." });
    }
  }

  function download() {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sneek-backup-codes.txt";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote({ tone: "ok", text: "Downloaded sneek-backup-codes.txt." });
    } catch {
      setNote({ tone: "error", text: "The download did not start. Copy or print them instead." });
    }
  }

  function print() {
    if (!printText(text)) setNote({ tone: "error", text: "Printing did not start. Copy or download them instead." });
  }

  return (
    // data-tour-busy: no tour or welcome may cover the codes while they are on screen.
    <section aria-labelledby={headingId} data-tour-busy="backup-codes" className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-4">
      <div>
        <h3 id={headingId} className="text-[0.9375rem] font-[600]">Your backup codes</h3>
        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Made {createdLabel}</p>
      </div>
      <EToneNotice tone="attention" title="Save them now">
        Each code works once, if you cannot use your usual second step. They will not be shown again.
      </EToneNotice>
      <ol aria-label="Backup codes" className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[0.9375rem] tracking-[0.04em] max-[359px]:grid-cols-1">
        {codes.map((code) => (
          <li key={code} className="e-tnum select-all">{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <EButton type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden className="h-4 w-4" /> Copy
        </EButton>
        <EButton type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden className="h-4 w-4" /> Download .txt
        </EButton>
        <EButton type="button" variant="outline" size="sm" onClick={print}>
          <Printer aria-hidden className="h-4 w-4" /> Print
        </EButton>
      </div>
      {note ? (
        <p role={note.tone === "error" ? "alert" : "status"} className={note.tone === "error" ? "text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]"}>
          {note.text}
        </p>
      ) : null}
      <div className="border-t border-[hsl(var(--e-border))] pt-3">
        <EButton type="button" size="sm" onClick={onDone}>{doneLabel}</EButton>
        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">After this they are gone from the screen. Making new codes cancels these.</p>
      </div>
    </section>
  );
}
