"use client";

/**
 * "Before you approve": the server's checks, shown as they came. A check the
 * approve request enforces reads "Blocks approval" when it fails; the others
 * read "Check" and are advice. Nothing here is computed in the browser.
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

function CheckRow({ item }: { item: ApprovalCheck }) {
  const pill = PILL[item.state];
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
          ? "“Blocks approval” items are the ones approval refuses. “Check” items are advice; approval does not refuse them."
          : "Approval checks apply to drafts. These are advice for an invoice already past approval."}
      </p>
    </ECard>
  );
}
