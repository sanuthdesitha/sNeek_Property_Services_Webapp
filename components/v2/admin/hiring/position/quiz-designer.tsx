"use client";

/** Screening / knowledge-test designer.
 *  Save test → PATCH .../[id]/screening-schema  { requireKnowledgeTest, passThreshold, title, intro, questions }
 *  Save as reusable quiz → POST .../[id]/save-as-quiz  { name, passThreshold, title, intro, questions }
 *  Identical payloads and question shape to v1. */
import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, Save, Loader2, Copy, Check } from "lucide-react";
import { EButton, ECard, ECardBody, EAlert, EBadge } from "@/components/v2/ui/primitives";
import { EInput, ETextarea, ESelect, EField } from "@/components/v2/admin/estate-kit";
import { EModal } from "@/components/v2/admin/estate-kit";
import { Q_TYPES, uid, type QuizQuestion, type PositionShape } from "./types";

export function QuizDesigner({
  positionId,
  position,
}: {
  positionId: string;
  position: PositionShape;
}) {
  const screening = position?.screening ?? null;
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => screening?.questions ?? []);
  const [passThreshold, setPassThreshold] = useState<number>(screening?.passThreshold ?? 65);
  const [title, setTitle] = useState<string>(screening?.title ?? "");
  const [intro, setIntro] = useState<string>(screening?.intro ?? "");
  const [saving, setSaving] = useState(false);
  const [savingAsQuiz, setSavingAsQuiz] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [quizName, setQuizName] = useState("");

  const setQ = (i: number, patch: Partial<QuizQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const addQ = () =>
    setQuestions((qs) => [
      ...qs,
      {
        id: uid("q"),
        prompt: "New question",
        type: "single",
        category: "judgement",
        weight: 1,
        options: [{ id: uid("o"), label: "Option 1" }],
        correct: "",
      },
    ]);
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const moveQ = (i: number, dir: -1 | 1) =>
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const n = [...qs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const setOption = (qi: number, oi: number, label: string) =>
    setQuestions((qs) =>
      qs.map((q, idx) =>
        idx !== qi ? q : { ...q, options: (q.options ?? []).map((o, j) => (j === oi ? { ...o, label } : o)) },
      ),
    );
  const addOption = (qi: number) =>
    setQuestions((qs) =>
      qs.map((q, idx) => (idx !== qi ? q : { ...q, options: [...(q.options ?? []), { id: uid("o"), label: "New option" }] })),
    );
  const removeOption = (qi: number, oi: number) =>
    setQuestions((qs) =>
      qs.map((q, idx) => (idx !== qi ? q : { ...q, options: (q.options ?? []).filter((_, j) => j !== oi) })),
    );

  function toggleCorrect(qi: number, optId: string, type: string) {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== qi) return q;
        if (type === "single") return { ...q, correct: optId };
        const arr: string[] = Array.isArray(q.correct) ? q.correct : [];
        return { ...q, correct: arr.includes(optId) ? arr.filter((x) => x !== optId) : [...arr, optId] };
      }),
    );
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${positionId}/screening-schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireKnowledgeTest: true, passThreshold, title, intro, questions }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "danger", text: body.error ?? "Save failed." });
        return;
      }
      setMsg({ tone: "success", text: "Knowledge test saved." });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message ?? "Network error." });
    } finally {
      setSaving(false);
    }
  }

  function openQuizModal() {
    const dflt = (title?.trim() || `${position?.title ?? "Role"} — Knowledge test`).slice(0, 120);
    setQuizName(dflt);
    setQuizModalOpen(true);
  }

  async function saveAsReusableQuiz() {
    const name = quizName.trim() || `${position?.title ?? "Role"} — Knowledge test`;
    setSavingAsQuiz(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${positionId}/save-as-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, passThreshold, title, intro, questions }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "danger", text: body.error ?? "Could not save as quiz." });
        return;
      }
      setQuizModalOpen(false);
      setMsg({
        tone: "success",
        text: `Saved to quiz library — "${body.name}" can now be assigned & emailed to any candidate.`,
      });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message ?? "Network error." });
    } finally {
      setSavingAsQuiz(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          {questions.length} question(s). Short-answer questions are reviewed by a human; multiple-choice is auto-scored.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Pass %</span>
          <EInput
            type="number"
            min={0}
            max={100}
            className="w-20"
            value={passThreshold}
            onChange={(e) => setPassThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
          <EButton
            variant="outline-gold"
            onClick={openQuizModal}
            disabled={questions.length === 0}
            title="Save this knowledge test to the quiz library so it can be assigned & emailed to other applications"
          >
            <Copy className="h-4 w-4" />
            Save as reusable quiz
          </EButton>
          <EButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save test
          </EButton>
        </div>
      </div>

      {msg ? <EAlert tone={msg.tone === "success" ? "success" : "danger"} title={msg.text} /> : null}

      <ECard>
        <ECardBody className="grid gap-3 pt-6 sm:grid-cols-2">
          <EField label="Test title">
            <EInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Knowledge check" />
          </EField>
          <EField label="Intro">
            <EInput value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Shown above the questions" />
          </EField>
        </ECardBody>
      </ECard>

      {questions.map((q, qi) => (
        <ECard key={q.id ?? qi}>
          <ECardBody className="space-y-3 pt-6">
            <div className="flex items-start gap-2">
              <span className="e-numeral mt-2 text-[0.9375rem] text-[hsl(var(--e-gold-ink))]">{qi + 1}.</span>
              <ETextarea
                className="flex-1"
                rows={2}
                value={q.prompt ?? ""}
                onChange={(e) => setQ(qi, { prompt: e.target.value })}
                placeholder="Question prompt"
              />
              <div className="flex flex-col gap-1">
                <EButton variant="ghost" size="icon" onClick={() => moveQ(qi, -1)} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </EButton>
                <EButton variant="ghost" size="icon" onClick={() => moveQ(qi, 1)} aria-label="Move down">
                  <ArrowDown className="h-4 w-4" />
                </EButton>
                <EButton variant="ghost" size="icon" onClick={() => removeQ(qi)} aria-label="Delete question">
                  <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                </EButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ESelect className="w-32" value={q.type ?? "single"} onChange={(e) => setQ(qi, { type: e.target.value })}>
                {Q_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </ESelect>
              <EInput
                className="w-40"
                value={q.category ?? ""}
                onChange={(e) => setQ(qi, { category: e.target.value })}
                placeholder="Category"
              />
              <div className="flex items-center gap-1.5">
                <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Weight</span>
                <EInput
                  type="number"
                  min={1}
                  max={5}
                  className="w-16"
                  value={q.weight ?? 1}
                  onChange={(e) => setQ(qi, { weight: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
            </div>

            {q.type !== "short" ? (
              <div className="space-y-1.5">
                {(q.options ?? []).map((o, oi) => {
                  const isCorrect =
                    q.type === "single" ? q.correct === o.id : Array.isArray(q.correct) && q.correct.includes(o.id);
                  return (
                    <div key={o.id ?? oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCorrect(qi, o.id, q.type)}
                        className={
                          "inline-flex shrink-0 items-center gap-1 rounded-[var(--e-radius-sm)] border px-2 py-1 text-[0.6875rem] font-[550] transition-colors " +
                          (isCorrect
                            ? "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]"
                            : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:border-[hsl(var(--e-gold))]")
                        }
                      >
                        {isCorrect ? <Check className="h-3 w-3" /> : null}
                        {isCorrect ? "correct" : "mark correct"}
                      </button>
                      <EInput value={o.label ?? ""} onChange={(e) => setOption(qi, oi, e.target.value)} />
                      <EButton variant="ghost" size="icon" onClick={() => removeOption(qi, oi)} aria-label="Delete option">
                        <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                      </EButton>
                    </div>
                  );
                })}
                <EButton variant="outline" size="sm" onClick={() => addOption(qi)}>
                  <Plus className="h-4 w-4" />
                  Add option
                </EButton>
              </div>
            ) : (
              <EBadge tone="neutral" soft>
                Free-text — human reviewed
              </EBadge>
            )}
          </ECardBody>
        </ECard>
      ))}

      <EButton variant="outline" onClick={addQ}>
        <Plus className="h-4 w-4" />
        Add question
      </EButton>

      <EModal
        open={quizModalOpen}
        onClose={() => setQuizModalOpen(false)}
        title="Save to quiz library"
        eyebrow="Reusable quiz"
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Save the current questions as a reusable quiz that can be assigned & emailed to any candidate.
          </p>
          <EField label="Quiz name">
            <EInput
              value={quizName}
              onChange={(e) => setQuizName(e.target.value)}
              placeholder="Knowledge test"
              autoFocus
            />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setQuizModalOpen(false)} disabled={savingAsQuiz}>
              Cancel
            </EButton>
            <EButton size="sm" onClick={saveAsReusableQuiz} disabled={savingAsQuiz || !quizName.trim()}>
              {savingAsQuiz ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Save quiz
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
