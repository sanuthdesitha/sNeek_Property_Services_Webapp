"use client";

/**
 * Native Estate LEARNING panel for the v2 cleaner team hub.
 *
 * Wires the SAME endpoints the v1 `staff-workforce-hub` learning tab uses:
 *   - Assignments:  `GET /api/me/workforce` → `data.assignments` (passed in as prop)
 *   - Start:        `POST /api/me/workforce` { action: "START_LEARNING", assignmentId }
 *   - Save draft:   `POST /api/me/workforce` { action: "SAVE_LEARNING_PROGRESS", assignmentId, answers }
 *   - Submit:       `POST /api/me/workforce` { action: "SUBMIT_LEARNING", assignmentId, answers }
 *   - Retake:       `POST /api/me/workforce` { action: "RESTART_LEARNING", assignmentId }
 *   - Certificate:  `GET /api/me/workforce/assignments/[id]/certificate`  (PDF blob)
 *
 * Question grading, module `__meta` progress tracking (completedModules/currentModuleId),
 * and the START→SUBMIT sequence on first submit all mirror v1 exactly.
 * All UI is native Estate. No v1 UI imports.
 */
import * as React from "react";
import {
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Save,
  RotateCcw,
  Download,
  GraduationCap,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EAlert } from "@/components/v2/ui/primitives";
import { ETextarea, ECheckbox } from "@/components/v2/cleaner/fields";

type Answers = Record<string, any>;

interface Assignment {
  id: string;
  status: string;
  score?: number | null;
  starRating?: number | null;
  answers?: unknown;
  evaluation?: any;
  path?: { title?: string; description?: string | null; type?: string; schema?: { modules?: any[] } | null } | null;
}

/** Runs a `POST /api/me/workforce` action and returns the JSON body. */
export type WorkforceAction = (payload: Record<string, unknown>) => Promise<any>;

function isAnswered(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}
function normalizeAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Answers) };
}
function getMeta(answers: Answers) {
  const raw = answers.__meta;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { completedModules: [] as string[], currentModuleId: "" };
  return {
    completedModules: Array.isArray(raw.completedModules) ? raw.completedModules.map(String) : [],
    currentModuleId: typeof raw.currentModuleId === "string" ? raw.currentModuleId : "",
  };
}
function applyMeta(answers: Answers, patch: Partial<{ completedModules: string[]; currentModuleId: string }>) {
  const current = getMeta(answers);
  return {
    ...answers,
    __meta: {
      ...current,
      ...patch,
      completedModules: patch.completedModules ?? current.completedModules,
      currentModuleId: patch.currentModuleId ?? current.currentModuleId,
    },
  };
}
function questionCount(module: any) {
  return Array.isArray(module?.questions) ? module.questions.length : 0;
}
function answeredCount(module: any, answers: Answers) {
  return Array.isArray(module?.questions)
    ? module.questions.filter((q: any) => isAnswered(answers[q.id])).length
    : 0;
}
function isModuleComplete(module: any, answers: Answers) {
  const meta = getMeta(answers);
  if (module?.kind === "lesson") return meta.completedModules.includes(module.id);
  const total = questionCount(module);
  if (!total) return true;
  return answeredCount(module, answers) >= total;
}

export function LearningPanel({
  assignments,
  runAction,
  reload,
}: {
  assignments: Assignment[];
  runAction: WorkforceAction;
  reload: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = React.useState<string>(assignments[0]?.id ?? "");
  const [answersById, setAnswersById] = React.useState<Record<string, Answers>>({});
  const [moduleById, setModuleById] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Seed local answers + current module from server payload (re-seed on completion).
  React.useEffect(() => {
    if (!assignments.length) return;
    setAnswersById((cur) => {
      const next = { ...cur };
      for (const a of assignments) {
        if (!next[a.id] || Object.keys(next[a.id]).length === 0 || a.status === "COMPLETED") {
          next[a.id] = normalizeAnswers(a.answers);
        }
      }
      return next;
    });
    setModuleById((cur) => {
      const next = { ...cur };
      for (const a of assignments) {
        const modules = a.path?.schema?.modules ?? [];
        if (!modules.length) continue;
        const meta = getMeta(normalizeAnswers(a.answers));
        const preferred =
          meta.currentModuleId && modules.some((m: any) => m.id === meta.currentModuleId)
            ? meta.currentModuleId
            : modules[0].id;
        if (!next[a.id] || !modules.some((m: any) => m.id === next[a.id])) next[a.id] = preferred;
      }
      return next;
    });
    if (!selectedId && assignments[0]?.id) setSelectedId(assignments[0].id);
  }, [assignments, selectedId]);

  const current = assignments.find((a) => a.id === selectedId) ?? null;
  const answers = answersById[selectedId] ?? {};
  const modules: any[] = current?.path?.schema?.modules ?? [];
  const currentModuleId = moduleById[selectedId] || modules[0]?.id || "";
  const module = modules.find((m) => m.id === currentModuleId) ?? modules[0] ?? null;
  const moduleIndex = module ? modules.findIndex((m) => m.id === module.id) : -1;
  const completedCount = modules.filter((m) => isModuleComplete(m, answers)).length;
  const progressPercent = modules.length > 0 ? Math.round((completedCount / modules.length) * 100) : 0;

  function updateAnswers(mutator: (cur: Answers) => Answers) {
    if (!selectedId) return;
    setAnswersById((cur) => ({ ...cur, [selectedId]: mutator(cur[selectedId] ?? {}) }));
  }
  function setModule(id: string) {
    if (!selectedId) return;
    setModuleById((cur) => ({ ...cur, [selectedId]: id }));
    updateAnswers((cur) => applyMeta(cur, { currentModuleId: id }));
  }
  function markLessonComplete(id: string) {
    updateAnswers((cur) => {
      const meta = getMeta(cur);
      return applyMeta(cur, { completedModules: Array.from(new Set([...meta.completedModules, id])), currentModuleId: id });
    });
  }
  function goAdjacent(dir: -1 | 1) {
    if (!module || moduleIndex < 0) return;
    if (module.kind === "lesson") markLessonComplete(module.id);
    const next = modules[moduleIndex + dir];
    if (next) setModule(next.id);
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!current) return;
    await withBusy(async () => {
      await runAction({ action: "SAVE_LEARNING_PROGRESS", assignmentId: current.id, answers });
      setNotice("Draft saved.");
      await reload();
    });
  }
  async function submit() {
    if (!current) return;
    await withBusy(async () => {
      if (current.status !== "COMPLETED") {
        await runAction({ action: "START_LEARNING", assignmentId: current.id });
      }
      await runAction({ action: "SUBMIT_LEARNING", assignmentId: current.id, answers });
      setNotice(current.status === "COMPLETED" ? "Answers resubmitted." : "Learning submitted.");
      await reload();
    });
  }
  async function retake() {
    if (!current) return;
    await withBusy(async () => {
      await runAction({ action: "RESTART_LEARNING", assignmentId: current.id });
      setAnswersById((cur) => ({ ...cur, [current.id]: {} }));
      if (modules[0]?.id) setModuleById((cur) => ({ ...cur, [current.id]: modules[0].id }));
      setNotice("Retake started.");
      await reload();
    });
  }
  async function downloadCertificate() {
    if (!current) return;
    try {
      const res = await fetch(`/api/me/workforce/assignments/${current.id}/certificate`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Could not download certificate.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `learning-certificate-${current.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Could not download certificate.");
    }
  }

  if (assignments.length === 0) {
    return <EEmptyState eyebrow="Learning" title="No assignments yet" description="Assigned courses and assessments will appear here." />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
      {/* Assignment list */}
      <ECard className="h-fit">
        <ECardBody className="space-y-2 pt-6">
          <p className="e-eyebrow mb-1">Your learning</p>
          {assignments.map((a) => {
            const active = a.id === selectedId;
            const done = a.status === "COMPLETED";
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={`w-full rounded-[var(--e-radius)] border px-3 py-2.5 text-left transition-colors duration-[160ms] ${
                  active
                    ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                    : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:bg-[hsl(var(--e-muted))]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[0.875rem] font-[550]">{a.path?.title || "Assignment"}</p>
                  <EBadge tone={done ? "success" : "info"} soft>{a.status.replace(/_/g, " ")}</EBadge>
                </div>
                <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  {a.path?.type === "ASSESSMENT" ? "Assessment" : "Course"}
                  {typeof a.score === "number" ? ` · ${Math.round(a.score)}%` : ""}
                </p>
              </button>
            );
          })}
        </ECardBody>
      </ECard>

      {/* Assignment detail */}
      <div className="space-y-4">
        {!current ? (
          <EEmptyState eyebrow="Learning" title="Select an assignment" description="Open a course or assessment to begin." />
        ) : (
          <>
            {error ? <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            {notice ? <EAlert tone="success">{notice}</EAlert> : null}

            {/* Header + progress */}
            <ECard variant="ceremony">
              <ECardBody className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
                  <p className="text-[1.0625rem] font-[550]">{current.path?.title}</p>
                  <EBadge tone={current.status === "COMPLETED" ? "success" : "info"} soft>{current.status.replace(/_/g, " ")}</EBadge>
                  <EBadge tone="neutral">{current.path?.type === "ASSESSMENT" ? "Assessment" : "Course"}</EBadge>
                </div>
                {current.path?.description ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{current.path.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <p className="e-eyebrow">Progress</p>
                    <p className="e-numeral text-[1.5rem] leading-none">{progressPercent}%</p>
                  </div>
                  <div>
                    <p className="e-eyebrow">Modules</p>
                    <p className="text-[0.9375rem] font-[550]">{completedCount}/{modules.length}</p>
                  </div>
                  {typeof current.score === "number" ? (
                    <div>
                      <p className="e-eyebrow">Latest score</p>
                      <p className="text-[0.9375rem] font-[550]">{Math.round(current.score)}%</p>
                    </div>
                  ) : null}
                  {typeof current.starRating === "number" ? (
                    <div>
                      <p className="e-eyebrow">Rating</p>
                      <p className="text-[0.9375rem] font-[550]">{current.starRating.toFixed(1)} / 5</p>
                    </div>
                  ) : null}
                </div>
                {/* progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))]">
                  <div className="h-full rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-primary))]" style={{ width: `${progressPercent}%` }} />
                </div>
              </ECardBody>
            </ECard>

            {current.status === "COMPLETED" && current.evaluation ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Readiness band" value={current.evaluation.band || "Completed"} />
                <MiniStat label="Prediction" value={current.evaluation.prediction || "Evaluation ready."} />
                <MiniStat label="Strengths" value={(current.evaluation.strengths ?? []).join(", ") || "Not enough data yet"} />
                <MiniStat label="Focus areas" value={(current.evaluation.lowAreas ?? []).join(", ") || "No critical low areas"} />
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[260px,1fr]">
              {/* Module outline */}
              <ECard className="h-fit">
                <ECardBody className="space-y-2 pt-6">
                  <p className="e-eyebrow mb-1">Course outline</p>
                  {modules.map((m, i) => {
                    const complete = isModuleComplete(m, answers);
                    const answered = answeredCount(m, answers);
                    const total = questionCount(m);
                    const activeM = module?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModule(m.id)}
                        className={`flex w-full items-start gap-3 rounded-[var(--e-radius)] border px-3 py-2.5 text-left transition-colors duration-[160ms] ${
                          activeM
                            ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                            : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:bg-[hsl(var(--e-muted))]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                            complete
                              ? "bg-[hsl(var(--e-success))] text-white"
                              : activeM
                                ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                                : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
                          }`}
                        >
                          {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                        </span>
                        <span className="min-w-0">
                          <p className="text-[0.8125rem] font-[550]">{m.title}</p>
                          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                            {m.kind === "quiz" ? "Knowledge check" : "Lesson"}
                            {total ? ` · ${answered}/${total}` : complete ? " · Complete" : ""}
                          </p>
                        </span>
                      </button>
                    );
                  })}
                </ECardBody>
              </ECard>

              {/* Module content + questions */}
              <div className="space-y-4">
                {module ? (
                  <ECard>
                    <ECardBody className="space-y-4 pt-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <EBadge tone={module.kind === "quiz" ? "warning" : "neutral"} soft>
                          {module.kind === "quiz" ? "Assessment" : "Lesson"}
                        </EBadge>
                        {isModuleComplete(module, answers) ? <EBadge tone="success" soft>Completed</EBadge> : null}
                      </div>
                      <h3 className="text-[1.125rem] font-semibold">{module.title}</h3>
                      {module.summary ? <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{module.summary}</p> : null}
                      {module.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={module.imageUrl} alt={module.title} className="h-48 w-full rounded-[var(--e-radius-lg)] object-cover" />
                      ) : null}

                      {(module.sections ?? []).map((section: any, idx: number) => (
                        <div key={`${module.id}-s${idx}`} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
                          {section.heading ? <h4 className="text-[0.9375rem] font-[550]">{section.heading}</h4> : null}
                          {section.body ? <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{section.body}</p> : null}
                          {section.bullets?.length ? (
                            <ul className="list-disc space-y-1 pl-5 text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                              {section.bullets.map((b: string) => <li key={b}>{b}</li>)}
                            </ul>
                          ) : null}
                          {section.callout ? (
                            <EAlert tone="warning">{section.callout}</EAlert>
                          ) : null}
                        </div>
                      ))}

                      {(module.questions ?? []).map((q: any) => (
                        <div key={q.id} className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[0.875rem] font-[550]">{q.prompt}</p>
                            {isAnswered(answers[q.id]) ? <EBadge tone="success" soft>Answered</EBadge> : <EBadge tone="neutral" soft>Pending</EBadge>}
                          </div>
                          {q.type === "single" ? (
                            <div className="space-y-1.5">
                              {(q.options ?? []).map((opt: any) => {
                                const checked = answers[q.id] === opt.id;
                                return (
                                  <label
                                    key={opt.id}
                                    className={`flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border px-3 py-2 text-[0.875rem] transition-colors ${
                                      checked ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={q.id}
                                      checked={checked}
                                      onChange={() => updateAnswers((cur) => ({ ...cur, [q.id]: opt.id }))}
                                      style={{ accentColor: "hsl(var(--e-primary))" }}
                                    />
                                    <span>{opt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : q.type === "multi" ? (
                            <div className="space-y-1.5">
                              {(q.options ?? []).map((opt: any) => {
                                const values: string[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];
                                const checked = values.includes(opt.id);
                                return (
                                  <label
                                    key={opt.id}
                                    className={`flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border px-3 py-2 text-[0.875rem] transition-colors ${
                                      checked ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]"
                                    }`}
                                  >
                                    <ECheckbox
                                      checked={checked}
                                      onChange={(e) =>
                                        updateAnswers((cur) => {
                                          const existing: string[] = Array.isArray(cur[q.id]) ? cur[q.id] : [];
                                          return {
                                            ...cur,
                                            [q.id]: e.target.checked ? [...existing, opt.id] : existing.filter((v) => v !== opt.id),
                                          };
                                        })
                                      }
                                    />
                                    <span>{opt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <ETextarea
                              value={answers[q.id] || ""}
                              onChange={(e) => updateAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                              placeholder={q.placeholder || "Write your answer"}
                              className="min-h-[96px] bg-[hsl(var(--e-surface))]"
                            />
                          )}
                        </div>
                      ))}
                    </ECardBody>
                  </ECard>
                ) : (
                  <EEmptyState eyebrow="Learning" title="Choose a module" description="Pick a module from the outline to start." />
                )}

                {/* Action bar */}
                <ECard>
                  <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
                    <div className="flex flex-wrap gap-2">
                      <EButton variant="outline" size="sm" disabled={moduleIndex <= 0} onClick={() => goAdjacent(-1)}>
                        <ChevronLeft className="h-4 w-4" /> Previous
                      </EButton>
                      <EButton variant="outline" size="sm" disabled={moduleIndex < 0 || moduleIndex >= modules.length - 1} onClick={() => goAdjacent(1)}>
                        Next <ChevronRight className="h-4 w-4" />
                      </EButton>
                      {module?.kind === "lesson" ? (
                        <EButton variant="outline" size="sm" onClick={() => markLessonComplete(module.id)}>
                          <CheckCircle2 className="h-4 w-4" /> Mark complete
                        </EButton>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <EButton variant="outline" size="sm" disabled={busy} onClick={() => void saveDraft()}>
                        <Save className="h-4 w-4" /> Save draft
                      </EButton>
                      {current.status === "COMPLETED" ? (
                        <EButton variant="outline" size="sm" disabled={busy} onClick={() => void retake()}>
                          <RotateCcw className="h-4 w-4" /> Retake
                        </EButton>
                      ) : null}
                      {current.status === "COMPLETED" ? (
                        <EButton variant="outline-gold" size="sm" onClick={() => void downloadCertificate()}>
                          <Download className="h-4 w-4" /> Certificate
                        </EButton>
                      ) : null}
                      <EButton size="sm" disabled={busy} onClick={() => void submit()}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {current.status === "COMPLETED" ? "Resubmit" : "Submit learning"}
                      </EButton>
                    </div>
                  </ECardBody>
                </ECard>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <ECard>
      <ECardBody className="space-y-1 pt-6">
        <p className="e-eyebrow">{label}</p>
        <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{value}</p>
      </ECardBody>
    </ECard>
  );
}
