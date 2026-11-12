"use client";

/**
 * "Before you approve": the server's checks, shown as they came. On a draft
 * every check is enforced (Wave D) and reads OK or "Blocks approval" with the
 * server's exact text and a link to fix it; past approval the same checks are
 * advice ("Check"). Nothing here is computed in the browser.
 */
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { ApprovalCheck, ApprovalChecks } from "@/lib/billing/client-invoice-editor-types";

const PILL: Record<ApprovalCheck["state"], { tone: EPillTone; text: string }> = {
  ok: { tone: "ok", text: "OK" },
  refused: { tone: "bad", text: "Blocks approval" },
  check: { tone: "warn", text: "Check" },
  unknown: { tone: "neutral", text: "Unknown" },
};

/** An enforced check that could not be read blocks approval too. */
const ENFORCED_UNKNOWN = { tone: "bad" as EPillTone, text: "Unknown · blocks approval" };

function CheckRow({ item }: { item: ApprovalCheck }) {
  const pill = item.enforced && item.state === "unknown" ? ENFORCED_UNKNOWN : PILL[item.state];
  return (
    <li className="flex items-start gap-2.5">
      <EPill tone={pill.tone} className="mt-px shrink-0">
        {pill.text}
      </EPill>
      <div className="min-w-0 text-[0.8125rem]">
        <span className="break-words">{item.label}</span>
        {item.key === "started-work" && item.state === "refused" ? (
          <>
            {" "}
            <a href="#started-work-review" className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
              Review
            </a>
          </>
        ) : null}
        {item.state !== "ok" && item.fixHref && item.fixLabel ? (
          <>
            {" "}
            <a href={item.fixHref} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
              {item.fixLabel}
            </a>
          </>
        ) : null}
        {item.detail ? (
          <span className="mt-0.5 block break-words text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.detail}</span>
        ) : null}
      </div>
    </li>
  );
}

export function EditorChecks({ checks }: { checks: ApprovalChecks }) {
  return (
    <ECard className="space-y-2.5 px-4 py-3.5">
      <EEyebrow>{checks.appliesTo === "approve" ? "Before you approve" : "Checks"}</EEyebrow>
      <ul className="space-y-2.5">
        {checks.items.map((item) => (
          <CheckRow key={item.key} item={item} />
        ))}
      </ul>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        {checks.appliesTo === "approve"
          ? "Approval, sending a draft and marking a draft paid are refused while any item blocks. The server runs the same checks."
          : "Approval checks apply to drafts. These are advice for an invoice already past approval."}
      </p>
    </ECard>
  );
}
