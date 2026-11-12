"use client";

import { EPill } from "@/components/v2/ui/pill";
import type { WordingFields } from "@/lib/notifications/wording/types";
import type { WordingPartView } from "@/lib/notifications/wording/view-types";
import { previewPart, problemsFor } from "./wording-model";

/** Required-variable check, problems and the SMS length, for a draft (or a proposal). */
export function WordingChecks({ part, fields, id, compareTo }: { part: WordingPartView; fields: WordingFields; id?: string; compareTo?: WordingFields }) {
  const problems = problemsFor(part, fields);
  const preview = previewPart(part, fields);
  const dropped = compareTo
    ? part.variables.map((variable) => variable.name).filter((name) => Object.values(compareTo).some((text) => text?.includes(`{{${name}}}`)) && !Object.values(fields).some((text) => text?.includes(`{{${name}}}`)))
    : [];
  return (
    <div id={id} className="flex flex-wrap items-center gap-1.5" aria-live="polite">
      {problems.length === 0 ? (
        <EPill tone="ok">{part.required.length ? `Required variables present: ${part.required.join(", ")}` : "No required variables"}</EPill>
      ) : (
        problems.map((problem, index) => <EPill key={`${problem.code}-${index}`} tone="bad">{problem.message}</EPill>)
      )}
      {preview.sms ? (
        <>
          <EPill>{`${preview.sms.characters} characters · ${preview.sms.segments} SMS (${preview.sms.perSegment} max)`}</EPill>
          <span className="text-xs text-[hsl(var(--e-muted-foreground))]">{preview.sms.unicode ? "An emoji or curly quote is in use: the limit is 70." : "An emoji or curly quote drops the limit to 70."} Counted on the sample data.</span>
        </>
      ) : null}
      {dropped.map((name) => <EPill key={name} tone="warn">{`Drops {{${name}}}`}</EPill>)}
    </div>
  );
}
