"use client";

/**
 * ESTATE-native candidate detail — profile & answers, knowledge-test breakdown,
 * stage change / interview / offer / rejection, assign-quiz (single or combined),
 * per-quiz answer review, email preview→send, manual reply logging, and an
 * activity timeline. Same endpoints as the v1 candidate-detail; brand-new
 * Estate UI (no components/{ui,hiring,admin,shared} imports).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Mail, MailOpen, FileText, StickyNote, UserPlus,
  ClipboardCheck, Reply, Loader2, Save, Send, ExternalLink, Phone, MapPin, Copy,
  ClipboardList, X, CheckCircle2,
} from "lucide-react";
import { EButton, EBadge, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EInput, ETextarea, ESelect, EField } from "@/components/v2/admin/estate-kit";
import { EmailPreviewModal } from "@/components/v2/admin/hiring/application/email-preview-modal";
import { QuizReview } from "@/components/v2/admin/hiring/application/quiz-review";

const STATUSES = ["NEW", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"] as const;

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

const STATUS_TONE: Record<string, Tone> = {
  NEW: "neutral", SCREENING: "info", INTERVIEW: "warning",
  OFFER: "aubergine", HIRED: "success", REJECTED: "danger", WITHDRAWN: "neutral",
};

const EVENT_ICON: Record<string, typeof Mail> = {
  CREATED: UserPlus, STATUS_CHANGE: ArrowRight, EMAIL_SENT: Mail,
  EMAIL_REPLY: Reply, NOTE: StickyNote, ASSESSMENT: ClipboardCheck,
};

function templateForStatus(status: string): string {
  if (status === "INTERVIEW") return "interview";
  if (status === "OFFER") return "offer";
  if (status === "HIRED") return "welcome";
  return "thank_you";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

const HIDDEN_ANSWER_KEYS = new Set(["fullName", "email", "phone", "resumeUrl"]);

type Toast = { id: number; title: string; tone: "success" | "danger" };

export function CandidateWorkspace({ application }: { application: any }) {
  const router = useRouter();
  const answers: Record<string, any> = application.answers ?? {};
  const evaluation: Record<string, any> = application.evaluation ?? {};
  const assessment = evaluation.assessment ?? null;
  const offer: Record<string, any> = application.offerDetails ?? {};
  const events: any[] = application.events ?? [];
  const quizAssignments: any[] = application.quizAssignments ?? [];

  const [status, setStatus] = useState<string>(application.status ?? "NEW");
  const [notes, setNotes] = useState<string>(evaluation.adminNotes ?? "");
  const [interviewDate, setInterviewDate] = useState<string>(
    application.interviewDate ? new Date(application.interviewDate).toISOString().slice(0, 16) : "",
  );
  const [interviewNotes, setInterviewNotes] = useState<string>(application.interviewNotes ?? "");
  const [offerRole, setOfferRole] = useState<string>(offer.roleTitle ?? "");
  const [offerRate, setOfferRate] = useState<string>(offer.rate ?? "");
  const [offerStart, setOfferStart] = useState<string>(offer.startDate ?? "");
  const [rejectionReason, setRejectionReason] = useState<string>(application.rejectionReason ?? "");
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [loggingReply, setLoggingReply] = useState(false);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]);
  const [assigningQuiz, setAssigningQuiz] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function toast(title: string, tone: "success" | "danger" = "success") {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, title, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  useEffect(() => {
    fetch("/api/admin/workforce/hiring/quizzes")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setQuizzes(data))
      .catch(() => {});
  }, []);

  function toggleQuiz(id: string) {
    setSelectedQuizzes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function assignQuiz() {
    if (selectedQuizzes.length === 0) return;
    setAssigningQuiz(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${application.id}/assign-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizTemplateIds: selectedQuizzes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast(body.error ?? "Could not assign quiz.", "danger"); return; }
      toast(selectedQuizzes.length > 1 ? `${selectedQuizzes.length} quizzes sent as one assessment` : "Quiz assigned & emailed");
      setSelectedQuizzes([]);
      router.refresh();
    } finally {
      setAssigningQuiz(false);
    }
  }

  function copyQuizLink(token: string) {
    const url = `${window.location.origin}/quiz/${token}`;
    navigator.clipboard.writeText(url).then(() => toast("Quiz link copied"), () => toast("Quiz link copied"));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          notes,
          interviewNotes,
          interviewDate: interviewDate ? new Date(interviewDate).toISOString() : null,
          offerDetails: { roleTitle: offerRole, rate: offerRate, startDate: offerStart },
          rejectionReason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast(body.error ?? "Save failed.", "danger"); return; }
      toast("Saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function logReply() {
    if (!replyText.trim()) return;
    setLoggingReply(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${application.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyText }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast(e.error ?? "Could not log reply.", "danger");
        return;
      }
      setReplyText("");
      toast("Reply logged");
      router.refresh();
    } finally {
      setLoggingReply(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-[var(--e-radius)] border px-4 py-2.5 text-[0.8125rem] shadow-[var(--e-elevation-2)]"
            style={{
              backgroundColor: "hsl(var(--e-surface))",
              borderColor: t.tone === "danger" ? "hsl(var(--e-danger)/0.5)" : "hsl(var(--e-success)/0.5)",
              color: "hsl(var(--e-foreground))",
            }}
          >
            {t.tone === "danger" ? <X className="h-4 w-4" style={{ color: "hsl(var(--e-danger))" }} /> : <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(var(--e-success))" }} />}
            {t.title}
          </div>
        ))}
      </div>

      <EPageHeader
        eyebrow={
          <Link href="/v2/admin/hiring" className="inline-flex items-center gap-1 hover:text-[hsl(var(--e-gold-ink))]">
            <ArrowLeft className="h-3 w-3" /> Hiring · {application.position?.title ?? "Candidate"}
          </Link>
        }
        title={application.fullName}
        description={application.email}
        actions={<EBadge tone={STATUS_TONE[status]} soft>{status}</EBadge>}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Knowledge score" value={typeof application.screeningScore === "number" ? `${Math.round(application.screeningScore)}%` : "—"} />
        <StatTile label="Emails sent" value={String(application.emailsSent ?? 0)} sub={application.lastEmailedAt ? `last ${timeAgo(application.lastEmailedAt)}` : undefined} />
        <StatTile label="Replies" value={String(application.repliesReceived ?? 0)} sub={application.lastReplyAt ? `last ${timeAgo(application.lastReplyAt)}` : undefined} />
        <StatTile label="Applied" value={new Date(application.createdAt).toLocaleDateString()} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Main column */}
        <div className="space-y-5">
          <ECard>
            <div className="border-b border-[hsl(var(--e-border))] px-6 py-4">
              <h3 className="e-display-sm">Contact & application</h3>
            </div>
            <div className="space-y-3 p-6">
              <div className="flex flex-wrap gap-4 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" /> {application.email}</span>
                {application.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" /> {application.phone}</span> : null}
                {answers.suburb ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" /> {answers.suburb}</span> : null}
              </div>
              {application.resumeUrl ? (
                <EButton variant="outline" size="sm" asChild>
                  <a href={application.resumeUrl} target="_blank" rel="noreferrer">
                    <FileText className="h-4 w-4" /> View resume <ExternalLink className="h-3 w-3" />
                  </a>
                </EButton>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(answers)
                  .filter(([k, v]) => !HIDDEN_ANSWER_KEYS.has(k) && v != null && String(v).length > 0)
                  .map(([k, v]) => (
                    <div key={k} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
                      <p className="e-eyebrow text-[0.625rem]">{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</p>
                      <p className="mt-0.5 text-[0.875rem] text-[hsl(var(--e-foreground))]">{Array.isArray(v) ? v.join(", ") : String(v)}</p>
                    </div>
                  ))}
              </div>
              {application.coverLetter ? (
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                  <p className="e-eyebrow mb-1 text-[0.625rem]">Cover letter</p>
                  <p className="whitespace-pre-line text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{application.coverLetter}</p>
                </div>
              ) : null}
            </div>
          </ECard>

          {assessment ? (
            <ECard>
              <div className="flex items-center justify-between border-b border-[hsl(var(--e-border))] px-6 py-4">
                <h3 className="e-display-sm">Knowledge test</h3>
                <EBadge tone={assessment.passed ? "success" : "neutral"} soft className="e-tnum">
                  {Math.round(assessment.score ?? 0)}% · {assessment.band ?? ""}
                </EBadge>
              </div>
              <div className="space-y-3 p-6">
                {Array.isArray(assessment.categoryScores) && assessment.categoryScores.length > 0 ? (
                  <div className="space-y-1.5">
                    {assessment.categoryScores.map((c: any) => (
                      <div key={c.category} className="flex items-center gap-2 text-[0.75rem]">
                        <span className="w-28 shrink-0 truncate text-[hsl(var(--e-muted-foreground))]">{c.label ?? c.category}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]">
                          <div className="h-full rounded-full bg-[hsl(var(--e-gold))]" style={{ width: `${Math.max(0, Math.min(100, c.score ?? 0))}%` }} />
                        </div>
                        <span className="e-tnum w-9 shrink-0 text-right text-[hsl(var(--e-text-secondary))]">{Math.round(c.score ?? 0)}%</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(assessment.flagged) && assessment.flagged.length > 0 ? (
                  <div className="space-y-2">
                    <p className="e-eyebrow text-[0.625rem]">Free-text answers (review)</p>
                    {assessment.flagged.map((f: any) => (
                      <div key={f.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
                        <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))]">{f.prompt}</p>
                        <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{f.answer || "—"}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </ECard>
          ) : null}
        </div>

        {/* Side column: actions + timeline */}
        <div className="space-y-5">
          <ECard>
            <div className="border-b border-[hsl(var(--e-border))] px-6 py-4">
              <h3 className="e-display-sm">Assess & decide</h3>
            </div>
            <div className="space-y-3 p-6">
              <EField label="Status">
                <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </ESelect>
              </EField>
              <EField label="Admin notes">
                <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </EField>
              {status === "INTERVIEW" ? (
                <div className="space-y-2">
                  <EField label="Interview date">
                    <EInput type="datetime-local" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
                  </EField>
                  <ETextarea value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} rows={2} placeholder="Interview notes" />
                </div>
              ) : null}
              {status === "OFFER" || status === "HIRED" ? (
                <div className="grid grid-cols-3 gap-2">
                  <EInput value={offerRole} onChange={(e) => setOfferRole(e.target.value)} placeholder="Role" />
                  <EInput value={offerRate} onChange={(e) => setOfferRate(e.target.value)} placeholder="$/hr" />
                  <EInput value={offerStart} onChange={(e) => setOfferStart(e.target.value)} placeholder="Start" />
                </div>
              ) : null}
              {status === "REJECTED" ? (
                <EField label="Rejection reason">
                  <EInput value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
                </EField>
              ) : null}
              <div className="flex gap-2">
                <EButton onClick={save} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </EButton>
                <EButton variant="outline" onClick={() => setEmailOpen(true)}>
                  <Send className="h-4 w-4" /> Email
                </EButton>
              </div>
            </div>
          </ECard>

          <ECard>
            <div className="border-b border-[hsl(var(--e-border))] px-6 py-4">
              <h3 className="e-display-sm">Log a reply</h3>
            </div>
            <div className="space-y-2 p-6">
              <ETextarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder="Paste what the candidate replied…" />
              <EButton size="sm" variant="outline" onClick={logReply} disabled={loggingReply || !replyText.trim()}>
                {loggingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Reply className="h-4 w-4" />} Log reply
              </EButton>
            </div>
          </ECard>

          <ECard>
            <div className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] px-6 py-4">
              <ClipboardList className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
              <h3 className="e-display-sm">Knowledge tests</h3>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Tick one or more quizzes — selecting several sends them as a single combined assessment (one link).
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-1">
                {quizzes.length === 0 ? (
                  <p className="px-2 py-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No quizzes in the library yet.</p>
                ) : (
                  quizzes.map((q) => {
                    const checked = selectedQuizzes.includes(q.id);
                    return (
                      <label
                        key={q.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] px-2 py-1.5 text-[0.875rem] transition-colors hover:bg-[hsl(var(--e-muted))] ${checked ? "bg-[hsl(var(--e-gold-soft))]" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleQuiz(q.id)}
                          className="h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]"
                        />
                        <span className="flex-1 truncate text-[hsl(var(--e-foreground))]">{q.name}</span>
                        <span className="e-tnum shrink-0 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{q.questionCount} Q</span>
                      </label>
                    );
                  })
                )}
              </div>
              <EButton size="sm" className="w-full" onClick={assignQuiz} disabled={assigningQuiz || selectedQuizzes.length === 0}>
                {assigningQuiz ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {selectedQuizzes.length > 1 ? `Assign & email ${selectedQuizzes.length} combined` : "Assign & email"}
              </EButton>

              {quizAssignments.length === 0 ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No quizzes assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {quizAssignments.map((qa) => (
                    <div key={qa.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{qa.quizTemplate?.name}</p>
                          <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                            {qa.status === "COMPLETED" ? `Completed · ${Math.round(qa.score ?? 0)}%` : "Sent · awaiting completion"}
                          </p>
                        </div>
                        {qa.status === "COMPLETED" ? (
                          <EBadge tone={(qa.score ?? 0) >= 70 ? "success" : "neutral"} soft className="e-tnum shrink-0">{Math.round(qa.score ?? 0)}%</EBadge>
                        ) : (
                          <button
                            type="button"
                            onClick={() => copyQuizLink(qa.token)}
                            title="Copy quiz link"
                            className="flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] text-[hsl(var(--e-muted-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <QuizReview assignment={qa} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ECard>

          <ECard>
            <div className="border-b border-[hsl(var(--e-border))] px-6 py-4">
              <h3 className="e-display-sm">Activity</h3>
            </div>
            <div className="p-6">
              <ol className="space-y-3">
                {events.length === 0 ? <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No activity yet.</p> : null}
                {events.map((ev) => {
                  const Icon = EVENT_ICON[ev.type] ?? MailOpen;
                  return (
                    <li key={ev.id} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{ev.summary}</p>
                        {ev.type === "EMAIL_REPLY" && ev.data?.body ? (
                          <p className="mt-0.5 whitespace-pre-line rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] p-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{ev.data.body}</p>
                        ) : null}
                        <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {timeAgo(ev.createdAt)}{ev.actor?.name ? ` · ${ev.actor.name}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </ECard>
        </div>
      </div>

      <EmailPreviewModal
        applicationId={application.id}
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        defaultTemplate={templateForStatus(status)}
        recipientName={application.fullName}
        onSent={() => router.refresh()}
        onToast={(m) => toast(m.title, m.tone)}
      />
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <ECard className="p-4">
      <p className="e-eyebrow text-[0.625rem]">{label}</p>
      <p className="e-numeral mt-1 text-[1.5rem] leading-none">{value}</p>
      {sub ? <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{sub}</p> : null}
    </ECard>
  );
}
