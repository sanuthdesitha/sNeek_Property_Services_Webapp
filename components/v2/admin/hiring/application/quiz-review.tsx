"use client";

/**
 * ESTATE-native per-question quiz review — the candidate's selected answer vs the
 * correct one (auto-scored questions), free-text answers, and "explain your
 * answer" notes. Ported from components/hiring/quiz-answer-review.tsx to the
 * Estate token scope with no shadcn/ui dependency.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Check, X, FileText } from "lucide-react";
import { EBadge } from "@/components/v2/ui/primitives";

type Option = { id: string; label: string };
type Question = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  options?: Option[];
  correct?: string | string[];
  explanation?: string;
};

type Assignment = {
  id: string;
  status: string;
  score: number | null;
  answers: Record<string, unknown> | null;
  result: any;
  schema?: any;
  quizTemplate?: { name?: string; schema?: any } | null;
};

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

export function QuizReview({ assignment }: { assignment: Assignment }) {
  const [open, setOpen] = useState(false);
  const questions: Question[] = useMemo(() => {
    const schema = assignment.schema ?? assignment.quizTemplate?.schema;
    return Array.isArray(schema?.questions) ? schema.questions : [];
  }, [assignment]);
  const answers = (assignment.answers ?? {}) as Record<string, unknown>;
  const band: string | undefined = assignment.result?.band;

  if (assignment.status !== "COMPLETED" || questions.length === 0) return null;

  return (
    <div className="mt-2 border-t border-[hsl(var(--e-border))] pt-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))] transition-colors hover:text-[hsl(var(--e-foreground))]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          View answers ({questions.length})
        </span>
        {band ? <span className="font-normal italic">{band}</span> : null}
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          {questions.map((q, i) => {
            const ans = answers[q.id];
            const explain = answers[`${q.id}__explain`];
            const correctIds = asArray(q.correct);

            if (q.type === "short") {
              const text = typeof ans === "string" ? ans.trim() : "";
              return (
                <div key={q.id} className="space-y-1">
                  <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))]">
                    <span className="text-[hsl(var(--e-muted-foreground))]">{i + 1}.</span> {q.prompt}
                    <EBadge tone="neutral" soft className="ml-2 align-middle text-[0.625rem]">Free text · review</EBadge>
                  </p>
                  <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] px-2.5 py-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                    {text || <span className="italic text-[hsl(var(--e-text-faint))]">No answer</span>}
                  </p>
                  {typeof explain === "string" && explain.trim() ? (
                    <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"><FileText className="mr-1 inline h-3 w-3" />{explain.trim()}</p>
                  ) : null}
                </div>
              );
            }

            const selected = asArray(ans);
            const isFullyCorrect =
              correctIds.length > 0 &&
              selected.length === correctIds.length &&
              selected.every((s) => correctIds.includes(s));
            return (
              <div key={q.id} className="space-y-1">
                <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))]">
                  <span className="text-[hsl(var(--e-muted-foreground))]">{i + 1}.</span> {q.prompt}
                  {correctIds.length > 0 ? (
                    <EBadge tone={isFullyCorrect ? "success" : "danger"} soft className="ml-2 align-middle text-[0.625rem]">
                      {isFullyCorrect ? "Correct" : "Incorrect"}
                    </EBadge>
                  ) : null}
                </p>
                <div className="space-y-1">
                  {(q.options ?? []).map((opt) => {
                    const picked = selected.includes(opt.id);
                    const correct = correctIds.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        className="flex items-center gap-2 rounded-[var(--e-radius-sm)] border px-2.5 py-1.5 text-[0.75rem]"
                        style={{
                          borderColor: correct
                            ? "hsl(var(--e-success)/0.45)"
                            : picked
                              ? "hsl(var(--e-danger)/0.45)"
                              : "hsl(var(--e-border))",
                          backgroundColor: correct
                            ? "hsl(var(--e-success)/0.08)"
                            : picked
                              ? "hsl(var(--e-danger)/0.08)"
                              : "transparent",
                        }}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {correct ? (
                            <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--e-success))" }} />
                          ) : picked ? (
                            <X className="h-3.5 w-3.5" style={{ color: "hsl(var(--e-danger))" }} />
                          ) : null}
                        </span>
                        <span className={picked ? "font-[550] text-[hsl(var(--e-foreground))]" : "text-[hsl(var(--e-text-secondary))]"}>{opt.label}</span>
                        {picked ? <span className="ml-auto text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">their pick</span> : null}
                      </div>
                    );
                  })}
                  {selected.length === 0 ? <p className="text-[0.6875rem] italic text-[hsl(var(--e-text-faint))]">No answer selected</p> : null}
                </div>
                {q.explanation ? (
                  <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Why: {q.explanation}</p>
                ) : null}
                {typeof explain === "string" && explain.trim() ? (
                  <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"><FileText className="mr-1 inline h-3 w-3" />Candidate note: {explain.trim()}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
