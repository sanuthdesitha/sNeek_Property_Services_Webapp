"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Mail, MailOpen, FileText, StickyNote, UserPlus,
  ClipboardCheck, Reply, Loader2, Save, Send, ExternalLink, Phone, MapPin, Copy, ClipboardList,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { EmailPreviewDialog } from "@/components/hiring/email-preview-dialog";

const STATUSES = ["NEW", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"] as const;

const STATUS_TONE: Record<string, string> = {
  NEW: "secondary", SCREENING: "outline", INTERVIEW: "warning",
  OFFER: "default", HIRED: "success", REJECTED: "destructive", WITHDRAWN: "secondary",
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
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

const HIDDEN_ANSWER_KEYS = new Set(["fullName", "email", "phone", "resumeUrl"]);

export function CandidateDetail({ application }: { application: any }) {
  const router = useRouter();
  const answers: Record<string, any> = application.answers ?? {};
  const evaluation: Record<string, any> = application.evaluation ?? {};
  const assessment = evaluation.assessment ?? null;
  const offer: Record<string, any> = application.offerDetails ?? {};
  const events: any[] = application.events ?? [];

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
  const [selectedQuiz, setSelectedQuiz] = useState<string>("");
  const [assigningQuiz, setAssigningQuiz] = useState(false);
  const quizAssignments: any[] = application.quizAssignments ?? [];

  useEffect(() => {
    fetch("/api/admin/workforce/hiring/quizzes")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setQuizzes(data))
      .catch(() => {});
  }, []);

  async function assignQuiz() {
    if (!selectedQuiz) return;
    setAssigningQuiz(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/applications/${application.id}/assign-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizTemplateId: selectedQuiz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: "Could not assign quiz", description: body.error, variant: "destructive" }); return; }
      toast({ title: "Quiz assigned & emailed" });
      setSelectedQuiz("");
      router.refresh();
    } finally {
      setAssigningQuiz(false);
    }
  }

  function copyQuizLink(token: string) {
    const url = `${window.location.origin}/quiz/${token}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: "Quiz link copied", description: url }), () => toast({ title: url }));
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
      if (!res.ok) {
        toast({ title: "Save failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Saved" });
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
        toast({ title: "Could not log reply", description: e.error, variant: "destructive" });
        return;
      }
      setReplyText("");
      toast({ title: "Reply logged" });
      router.refresh();
    } finally {
      setLoggingReply(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/admin/hiring"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Candidate</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{application.fullName}</h1>
          <p className="truncate text-sm text-muted-foreground">{application.position?.title}</p>
        </div>
        <Badge variant={STATUS_TONE[status] as any} className="shrink-0">{status}</Badge>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Knowledge score" value={typeof application.screeningScore === "number" ? `${Math.round(application.screeningScore)}%` : "—"} />
        <StatCard label="Emails sent" value={String(application.emailsSent ?? 0)} sub={application.lastEmailedAt ? `last ${timeAgo(application.lastEmailedAt)}` : undefined} />
        <StatCard label="Replies" value={String(application.repliesReceived ?? 0)} sub={application.lastReplyAt ? `last ${timeAgo(application.lastReplyAt)}` : undefined} />
        <StatCard label="Applied" value={new Date(application.createdAt).toLocaleDateString()} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Main column */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact & application</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-muted-foreground" /> {application.email}</span>
                {application.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-muted-foreground" /> {application.phone}</span> : null}
                {answers.suburb ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-muted-foreground" /> {answers.suburb}</span> : null}
              </div>
              {application.resumeUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={application.resumeUrl} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-4 w-4" /> View resume <ExternalLink className="ml-1 h-3 w-3" /></a>
                </Button>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(answers)
                  .filter(([k, v]) => !HIDDEN_ANSWER_KEYS.has(k) && v != null && String(v).length > 0)
                  .map(([k, v]) => (
                    <div key={k} className="rounded-lg border bg-surface p-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</p>
                      <p className="text-sm">{Array.isArray(v) ? v.join(", ") : String(v)}</p>
                    </div>
                  ))}
              </div>
              {application.coverLetter ? (
                <div className="rounded-lg border bg-surface p-3">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Cover letter</p>
                  <p className="whitespace-pre-line text-sm">{application.coverLetter}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {assessment ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>Knowledge test</span>
                  <Badge variant={assessment.passed ? "success" : "secondary"}>
                    {Math.round(assessment.score ?? 0)}% · {assessment.band ?? ""}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.isArray(assessment.categoryScores) && assessment.categoryScores.length > 0 ? (
                  <div className="space-y-1.5">
                    {assessment.categoryScores.map((c: any) => (
                      <div key={c.category} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0 truncate text-muted-foreground">{c.label ?? c.category}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, c.score ?? 0))}%` }} />
                        </div>
                        <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(c.score ?? 0)}%</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(assessment.flagged) && assessment.flagged.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Free-text answers (review)</p>
                    {assessment.flagged.map((f: any) => (
                      <div key={f.id} className="rounded-lg border bg-surface p-2.5">
                        <p className="text-xs font-medium">{f.prompt}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{f.answer || "—"}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Side column: actions + timeline */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Assess & decide</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Admin notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              {(status === "INTERVIEW") && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Interview date</Label>
                  <Input type="datetime-local" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
                  <Textarea value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} rows={2} placeholder="Interview notes" />
                </div>
              )}
              {(status === "OFFER" || status === "HIRED") && (
                <div className="grid grid-cols-3 gap-2">
                  <Input value={offerRole} onChange={(e) => setOfferRole(e.target.value)} placeholder="Role" />
                  <Input value={offerRate} onChange={(e) => setOfferRate(e.target.value)} placeholder="$/hr" />
                  <Input value={offerStart} onChange={(e) => setOfferStart(e.target.value)} placeholder="Start" />
                </div>
              )}
              {status === "REJECTED" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Rejection reason</Label>
                  <Input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save
                </Button>
                <Button variant="outline" onClick={() => setEmailOpen(true)}>
                  <Send className="mr-1 h-4 w-4" /> Email
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Log a reply</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder="Paste what the candidate replied…" />
              <Button size="sm" variant="outline" onClick={logReply} disabled={loggingReply || !replyText.trim()}>
                <Reply className="mr-1 h-4 w-4" /> Log reply
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Knowledge tests</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={selectedQuiz} onValueChange={setSelectedQuiz}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Choose a quiz…" /></SelectTrigger>
                  <SelectContent>
                    {quizzes.map((q) => <SelectItem key={q.id} value={q.id}>{q.name} ({q.questionCount})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={assignQuiz} disabled={assigningQuiz || !selectedQuiz}>
                  {assigningQuiz ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Assign & email
                </Button>
              </div>
              {quizAssignments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No quizzes assigned yet.</p>
              ) : (
                <div className="space-y-2">
                  {quizAssignments.map((qa) => (
                    <div key={qa.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{qa.quizTemplate?.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {qa.status === "COMPLETED" ? `Completed · ${Math.round(qa.score ?? 0)}%` : "Sent · awaiting completion"}
                        </p>
                      </div>
                      {qa.status === "COMPLETED" ? (
                        <Badge variant={(qa.score ?? 0) >= 70 ? "success" : "secondary"} className="shrink-0 tabular-nums">{Math.round(qa.score ?? 0)}%</Badge>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={() => copyQuizLink(qa.token)} title="Copy quiz link"><Copy className="h-4 w-4" /></Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {events.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}
                {events.map((ev) => {
                  const Icon = EVENT_ICON[ev.type] ?? MailOpen;
                  return (
                    <li key={ev.id} className="flex gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{ev.summary}</p>
                        {ev.type === "EMAIL_REPLY" && ev.data?.body ? (
                          <p className="mt-0.5 whitespace-pre-line rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{ev.data.body}</p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {timeAgo(ev.createdAt)}{ev.actor?.name ? ` · ${ev.actor.name}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <EmailPreviewDialog
        applicationId={application.id}
        open={emailOpen}
        onOpenChange={setEmailOpen}
        defaultTemplate={templateForStatus(status)}
        recipientName={application.fullName}
        onSent={() => router.refresh()}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
