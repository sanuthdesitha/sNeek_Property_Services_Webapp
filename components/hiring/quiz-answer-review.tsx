"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Check, X, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Option = { id: string; label: string };
type Question = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  category?: string;
  categoryLabel?: string;
  options?: Option[];
  correct?: string | string[];
  explanation?: string;
};

type Assignment = {
  id: string;
  status: string;
  score: number | null;
  completedAt: string | null;
  answers: Record<string, unknown> | null;
  result: any;
  // For combined sends, the merged schema is snapshotted on the assignment.
  schema?: any;
  title?: string | null;
  quizTemplate?: { name?: string; schema?: any } | null;
};

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

/**
 * Per-question review of a candidate's completed quiz: their selected answer vs
 * the correct one (auto-scored questions), free-text answers, and any
 * "explain your answer" notes — so reviewers see exactly how they think, not
 * just the final %.
 */
export function QuizAnswerReview({ assignment }: { assignment: Assignment }) {
  const [open, setOpen] = useState(false);
  const questions: Question[] = useMemo(() => {
    const schema = assignment.schema ?? assignment.quizTemplate?.schema;
    return Array.isArray(schema?.questions) ? schema.questions : [];
  }, [assignment]);
  const answers = (assignment.answers ?? {}) as Record<string, unknown>;
  const band: string | undefined = assignment.result?.band;

  if (assignment.status !== "COMPLETED" || questions.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
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
                  <p className="text-xs font-medium">
                    <span className="text-muted-foreground">{i + 1}.</span> {q.prompt}
                    <Badge variant="outline" className="ml-2 align-middle text-[10px]">Free text · review</Badge>
                  </p>
                  <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs">
                    {text || <span className="italic text-muted-foreground">No answer</span>}
                  </p>
                  {typeof explain === "string" && explain.trim() ? (
                    <p className="text-[11px] text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" />{explain.trim()}</p>
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
                <p className="text-xs font-medium">
                  <span className="text-muted-foreground">{i + 1}.</span> {q.prompt}
                  {correctIds.length > 0 ? (
                    <Badge variant={isFullyCorrect ? "success" : "destructive"} className="ml-2 align-middle text-[10px]">
                      {isFullyCorrect ? "Correct" : "Incorrect"}
                    </Badge>
                  ) : null}
                </p>
                <div className="space-y-1">
                  {(q.options ?? []).map((opt) => {
                    const picked = selected.includes(opt.id);
                    const correct = correctIds.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                          correct
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : picked
                              ? "border-destructive/40 bg-destructive/5"
                              : "border-border"
                        }`}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {correct ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : picked ? (
                            <X className="h-3.5 w-3.5 text-destructive" />
                          ) : null}
                        </span>
                        <span className={picked ? "font-medium" : ""}>{opt.label}</span>
                        {picked ? <span className="ml-auto text-[10px] text-muted-foreground">their pick</span> : null}
                      </div>
                    );
                  })}
                  {selected.length === 0 ? <p className="text-[11px] italic text-muted-foreground">No answer selected</p> : null}
                </div>
                {q.explanation ? (
                  <p className="text-[11px] text-muted-foreground">Why: {q.explanation}</p>
                ) : null}
                {typeof explain === "string" && explain.trim() ? (
                  <p className="text-[11px] text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" />Candidate note: {explain.trim()}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
