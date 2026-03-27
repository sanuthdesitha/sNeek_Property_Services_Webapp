"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, ChevronLeft, ChevronRight, FileCheck2, GraduationCap, MessageCircle, RotateCcw, Save, Sparkles, Users } from "lucide-react";
import { WorkforcePostCard } from "@/components/workforce/workforce-post-card";

async function uploadPrivateFile(file: File, folder: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body.error ?? "Upload failed.");
  return body;
}

function isAnswered(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}

function normalizeLearningAnswers(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, any>) };
}

function getLearningMeta(answers: Record<string, any>) {
  const raw = answers.__meta;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { completedModules: [] as string[], currentModuleId: "" };
  }
  return {
    completedModules: Array.isArray(raw.completedModules) ? raw.completedModules.map(String) : [],
    currentModuleId: typeof raw.currentModuleId === "string" ? raw.currentModuleId : "",
  };
}

function applyLearningMeta(
  answers: Record<string, any>,
  patch: Partial<{ completedModules: string[]; currentModuleId: string }>
) {
  const current = getLearningMeta(answers);
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

function moduleQuestionCount(module: any) {
  return Array.isArray(module?.questions) ? module.questions.length : 0;
}

function moduleAnsweredCount(module: any, answers: Record<string, any>) {
  return Array.isArray(module?.questions)
    ? module.questions.filter((question: any) => isAnswered(answers[question.id])).length
    : 0;
}

function isModuleComplete(module: any, answers: Record<string, any>) {
  const meta = getLearningMeta(answers);
  if (module?.kind === "lesson") {
    return meta.completedModules.includes(module.id);
  }
  const total = moduleQuestionCount(module);
  if (!total) return true;
  return moduleAnsweredCount(module, answers) >= total;
}

export function StaffWorkforceHub({ title = "Team Hub" }: { title?: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("feed");
  const [learningBusy, setLearningBusy] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedModuleByAssignment, setSelectedModuleByAssignment] = useState<Record<string, string>>({});
  const [answersByAssignment, setAnswersByAssignment] = useState<Record<string, Record<string, any>>>({});
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({ category: "POLICE_CHECK", title: "", notes: "", expiresAt: "" });
  const [directChatUserId, setDirectChatUserId] = useState("");

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent || !data) {
      setLoading(true);
    }
    try {
      const res = await fetch("/api/me/workforce");
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load team hub.");
      setData(body);
      if (!selectedChannelId && body?.channels?.[0]?.id) setSelectedChannelId(body.channels[0].id);
      if (!selectedAssignmentId && body?.assignments?.[0]?.id) setSelectedAssignmentId(body.assignments[0].id);
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message ?? "Could not load team hub.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function runAction(payload: Record<string, unknown>, successTitle?: string) {
    const res = await fetch("/api/me/workforce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Action failed.");
    if (successTitle) toast({ title: successTitle });
    await load({ silent: true });
    return body;
  }

  async function loadMessages(channelId: string) {
    if (!channelId) return setMessages([]);
    const res = await fetch(`/api/workforce/channels/${channelId}`);
    const body = await res.json().catch(() => []);
    if (!res.ok) throw new Error(body.error ?? "Could not load channel.");
    setMessages(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const assignments = data?.assignments ?? [];
    if (!assignments.length) return;

    setAnswersByAssignment((current) => {
      const next = { ...current };
      for (const assignment of assignments) {
        if (!next[assignment.id] || Object.keys(next[assignment.id]).length === 0 || assignment.status === "COMPLETED") {
          next[assignment.id] = normalizeLearningAnswers(assignment.answers);
        }
      }
      return next;
    });

    setSelectedModuleByAssignment((current) => {
      const next = { ...current };
      for (const assignment of assignments) {
        const modules = assignment.path?.schema?.modules ?? [];
        if (!modules.length) continue;
        const savedMeta = getLearningMeta(normalizeLearningAnswers(assignment.answers));
        const preferred = savedMeta.currentModuleId && modules.some((module: any) => module.id === savedMeta.currentModuleId)
          ? savedMeta.currentModuleId
          : modules[0].id;
        if (!next[assignment.id] || !modules.some((module: any) => module.id === next[assignment.id])) {
          next[assignment.id] = preferred;
        }
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!selectedChannelId) return;
    void loadMessages(selectedChannelId);
    const timer = window.setInterval(() => void loadMessages(selectedChannelId), 8000);
    return () => window.clearInterval(timer);
  }, [selectedChannelId]);

  const currentAssignment = useMemo(
    () => (data?.assignments ?? []).find((assignment: any) => assignment.id === selectedAssignmentId) ?? null,
    [data, selectedAssignmentId]
  );
  const assignmentAnswers = answersByAssignment[selectedAssignmentId] ?? {};
  const assignmentModules = currentAssignment?.path?.schema?.modules ?? [];
  const selectedModuleId = selectedModuleByAssignment[selectedAssignmentId] || assignmentModules[0]?.id || "";
  const selectedModule = assignmentModules.find((module: any) => module.id === selectedModuleId) ?? assignmentModules[0] ?? null;
  const selectedModuleIndex = selectedModule ? assignmentModules.findIndex((module: any) => module.id === selectedModule.id) : -1;
  const completedModuleCount = assignmentModules.filter((module: any) => isModuleComplete(module, assignmentAnswers)).length;
  const learningProgressPercent = assignmentModules.length > 0 ? Math.round((completedModuleCount / assignmentModules.length) * 100) : 0;

  function updateAssignmentAnswers(mutator: (current: Record<string, any>) => Record<string, any>) {
    if (!selectedAssignmentId) return;
    setAnswersByAssignment((current) => ({
      ...current,
      [selectedAssignmentId]: mutator(current[selectedAssignmentId] ?? {}),
    }));
  }

  function setCurrentModule(moduleId: string) {
    if (!selectedAssignmentId) return;
    setSelectedModuleByAssignment((current) => ({ ...current, [selectedAssignmentId]: moduleId }));
    updateAssignmentAnswers((current) => applyLearningMeta(current, { currentModuleId: moduleId }));
  }

  function markLessonModuleComplete(moduleId: string) {
    updateAssignmentAnswers((current) => {
      const meta = getLearningMeta(current);
      const completed = Array.from(new Set([...meta.completedModules, moduleId]));
      return applyLearningMeta(current, { completedModules: completed, currentModuleId: moduleId });
    });
  }

  function goToAdjacentModule(direction: -1 | 1) {
    if (!selectedModule || selectedModuleIndex < 0) return;
    if (selectedModule.kind === "lesson") {
      markLessonModuleComplete(selectedModule.id);
    }
    const nextModule = assignmentModules[selectedModuleIndex + direction];
    if (nextModule) setCurrentModule(nextModule.id);
  }

  if (loading && !data) return <div className="py-10 text-sm text-muted-foreground">Loading team hub...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">Internal updates, chat, learning, and compliance docs.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <InfoCard icon={Users} label="Your groups" value={String(data?.groups?.length ?? 0)} />
        <InfoCard icon={GraduationCap} label="Assignments" value={String(data?.assignments?.length ?? 0)} />
        <InfoCard icon={FileCheck2} label="Documents" value={String(data?.documents?.length ?? 0)} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="recognition">Recognition</TabsTrigger>
        </TabsList>
        <TabsContent value="feed" className="space-y-4">
          {(data?.posts ?? []).map((post: any) => (
            <WorkforcePostCard key={post.id} post={post} />
          ))}
        </TabsContent>

        <TabsContent value="chat" className="grid gap-4 xl:grid-cols-[320px,1fr]">
          <Card>
            <CardHeader><CardTitle>Chats</CardTitle><CardDescription>Message your groups or open a direct chat.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Direct chat</Label>
                    <Select value={directChatUserId} onValueChange={setDirectChatUserId}>
                      <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                      <SelectContent>
                    {(data?.directory ?? [])
                      .filter((member: any) => member.id !== data?.me?.id)
                      .map((member: any) => (
                        <SelectItem key={member.id} value={member.id}>{member.name || member.email}</SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                <Button disabled={!directChatUserId} onClick={async () => {
                  try {
                    const result = await runAction({ action: "OPEN_DIRECT_CHAT", otherUserId: directChatUserId }, "Direct chat ready");
                    if (result?.result?.id) setSelectedChannelId(result.result.id);
                  } catch (err: any) {
                    toast({ title: "Chat failed", description: err.message ?? "Could not open chat.", variant: "destructive" });
                  }
                }}>Open direct chat</Button>
              </div>
              {(data?.channels ?? []).map((channel: any) => (
                <button key={channel.id} type="button" className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedChannelId === channel.id ? "border-primary bg-primary/5" : "bg-white/80"}`} onClick={() => setSelectedChannelId(channel.id)}>
                  <p className="text-sm font-semibold">{channel.name}</p>
                  <p className="text-xs text-muted-foreground">{channel.description || channel.kind}</p>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Conversation</CardTitle><CardDescription>Messages sync across team members working from the same hub.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <ScrollArea className="h-[420px] rounded-2xl border bg-white/80 p-4">
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className="rounded-2xl border bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{message.sender?.name || message.sender?.role || "Team"}</span>
                        <span>{new Date(message.createdAt).toLocaleString("en-AU")}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <Textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Write a message" />
              <Button disabled={!selectedChannelId || !messageBody.trim()} onClick={async () => {
                const res = await fetch(`/api/workforce/channels/${selectedChannelId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: messageBody }) });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                  toast({ title: "Message failed", description: body.error ?? "Could not send message.", variant: "destructive" });
                  return;
                }
                setMessageBody("");
                await loadMessages(selectedChannelId);
              }}><MessageCircle className="mr-2 h-4 w-4" />Send</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="learning" className="grid gap-4 xl:grid-cols-[320px,1fr]">
          <Card>
            <CardHeader><CardTitle>Your Learning</CardTitle><CardDescription>Structured learning with progress, review, and retake controls.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {(data?.assignments ?? []).map((assignment: any) => (
                <button key={assignment.id} type="button" onClick={() => setSelectedAssignmentId(assignment.id)} className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedAssignmentId === assignment.id ? "border-primary bg-primary/5" : "bg-white/80"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{assignment.path?.title}</p>
                    <Badge variant={assignment.status === "COMPLETED" ? "success" : "secondary"}>{assignment.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {assignment.path?.type === "ASSESSMENT" ? "Assessment" : "Course"}
                    {typeof assignment.score === "number" ? ` · Score ${Math.round(assignment.score)}%` : ""}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{currentAssignment?.path?.title || "Select an assignment"}</CardTitle>
              <CardDescription>{currentAssignment?.path?.description || "Open an assigned course or assessment."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {currentAssignment ? (
                <>
                  <div className="rounded-3xl border bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_28%),white] p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={currentAssignment.status === "COMPLETED" ? "success" : "secondary"}>{currentAssignment.status.replace(/_/g, " ")}</Badge>
                          <Badge variant="outline">{currentAssignment.path?.type === "ASSESSMENT" ? "Assessment" : "Course"}</Badge>
                          <Badge variant="outline">{completedModuleCount}/{assignmentModules.length} modules complete</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {learningProgressPercent}% progress
                          {typeof currentAssignment.score === "number" ? ` · Latest score ${Math.round(currentAssignment.score)}%` : ""}
                        </p>
                      </div>
                      <div className="grid min-w-[220px] gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border bg-white/90 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Questions answered</p>
                          <p className="mt-1 text-xl font-semibold">
                            {assignmentModules.reduce((sum: number, module: any) => sum + moduleAnsweredCount(module, assignmentAnswers), 0)}
                            <span className="text-sm font-normal text-muted-foreground">
                              {" "} / {assignmentModules.reduce((sum: number, module: any) => sum + moduleQuestionCount(module), 0)}
                            </span>
                          </p>
                        </div>
                        <div className="rounded-2xl border bg-white/90 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Latest rating</p>
                          <p className="mt-1 text-xl font-semibold">
                            {typeof currentAssignment.starRating === "number" ? `${currentAssignment.starRating.toFixed(1)} / 5` : "In progress"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {currentAssignment.status === "COMPLETED" && currentAssignment.evaluation ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Readiness band</p>
                        <p className="mt-2 font-semibold">{currentAssignment.evaluation.band || "Completed"}</p>
                      </div>
                      <div className="rounded-2xl border bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Prediction</p>
                        <p className="mt-2 text-sm text-muted-foreground">{currentAssignment.evaluation.prediction || "Evaluation ready."}</p>
                      </div>
                      <div className="rounded-2xl border bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Strengths</p>
                        <p className="mt-2 text-sm">{(currentAssignment.evaluation.strengths ?? []).join(", ") || "Not enough data yet"}</p>
                      </div>
                      <div className="rounded-2xl border bg-white/90 p-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Focus areas</p>
                        <p className="mt-2 text-sm">{(currentAssignment.evaluation.lowAreas ?? []).join(", ") || "No critical low areas"}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-[280px,1fr]">
                    <div className="rounded-3xl border bg-white/80 p-4 shadow-sm">
                      <div className="mb-4">
                        <p className="text-sm font-semibold">Course outline</p>
                        <p className="text-xs text-muted-foreground">Follow the modules in order, save draft progress, and resubmit whenever needed.</p>
                      </div>
                      <div className="space-y-2">
                        {assignmentModules.map((module: any, index: number) => {
                          const complete = isModuleComplete(module, assignmentAnswers);
                          const answered = moduleAnsweredCount(module, assignmentAnswers);
                          const totalQuestions = moduleQuestionCount(module);
                          const active = selectedModule?.id === module.id;
                          return (
                            <button
                              key={module.id}
                              type="button"
                              onClick={() => setCurrentModule(module.id)}
                              className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${active ? "border-primary bg-primary/5" : "bg-white/90 hover:bg-muted/40"}`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? "bg-emerald-500 text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                                  {complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{module.title}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {module.kind === "quiz" ? "Knowledge check" : "Lesson"}
                                    {totalQuestions ? ` · ${answered}/${totalQuestions} answered` : complete ? " · Completed" : ""}
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {selectedModule ? (
                        <div className="rounded-3xl border bg-white/85 p-5 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={selectedModule.kind === "quiz" ? "warning" : "outline"}>
                                  {selectedModule.kind === "quiz" ? "Assessment" : "Lesson"}
                                </Badge>
                                {isModuleComplete(selectedModule, assignmentAnswers) ? <Badge variant="success">Completed</Badge> : null}
                              </div>
                              <h3 className="mt-2 text-xl font-semibold">{selectedModule.title}</h3>
                              {selectedModule.summary ? <p className="mt-2 text-sm text-muted-foreground">{selectedModule.summary}</p> : null}
                            </div>
                          </div>

                          {selectedModule.imageUrl ? <img src={selectedModule.imageUrl} alt={selectedModule.title} className="mt-5 h-52 w-full rounded-3xl object-cover" /> : null}

                          {(selectedModule.sections ?? []).map((section: any, index: number) => (
                            <div key={`${selectedModule.id}-${index}`} className="mt-5 space-y-3 rounded-2xl border bg-white/90 p-4">
                              {section.heading ? <h4 className="font-medium">{section.heading}</h4> : null}
                              {section.body ? <p className="text-sm leading-6 text-muted-foreground">{section.body}</p> : null}
                              {section.bullets?.length ? <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{section.bullets.map((bullet: string) => <li key={bullet}>{bullet}</li>)}</ul> : null}
                              {section.callout ? <div className="rounded-xl border bg-amber-50/80 p-3 text-sm text-amber-900">{section.callout}</div> : null}
                            </div>
                          ))}

                          {(selectedModule.questions ?? []).map((question: any) => (
                            <div key={question.id} className="mt-5 space-y-3 rounded-2xl border bg-background p-4">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-medium">{question.prompt}</p>
                                {isAnswered(assignmentAnswers[question.id]) ? <Badge variant="success">Answered</Badge> : <Badge variant="secondary">Pending</Badge>}
                              </div>
                              {question.type === "single" ? (
                                <div className="space-y-2">
                                  {(question.options ?? []).map((option: any) => (
                                    <label key={option.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${assignmentAnswers[question.id] === option.id ? "border-primary bg-primary/5" : ""}`}>
                                      <input
                                        type="radio"
                                        name={question.id}
                                        checked={assignmentAnswers[question.id] === option.id}
                                        onChange={() => updateAssignmentAnswers((current) => ({ ...current, [question.id]: option.id }))}
                                      />
                                      <span>{option.label}</span>
                                    </label>
                                  ))}
                                </div>
                              ) : question.type === "multi" ? (
                                <div className="space-y-2">
                                  {(question.options ?? []).map((option: any) => {
                                    const values = Array.isArray(assignmentAnswers[question.id]) ? assignmentAnswers[question.id] : [];
                                    return (
                                      <label key={option.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${values.includes(option.id) ? "border-primary bg-primary/5" : ""}`}>
                                        <Checkbox
                                          checked={values.includes(option.id)}
                                          onCheckedChange={(checked) => updateAssignmentAnswers((current) => {
                                            const existing = Array.isArray(current[question.id]) ? current[question.id] : [];
                                            return {
                                              ...current,
                                              [question.id]: checked ? [...existing, option.id] : existing.filter((item: string) => item !== option.id),
                                            };
                                          })}
                                        />
                                        <span>{option.label}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : (
                                <Textarea
                                  value={assignmentAnswers[question.id] || ""}
                                  onChange={(event) => updateAssignmentAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                                  placeholder={question.placeholder || "Write your answer"}
                                  className="min-h-28"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-3xl border bg-white/80 p-8 text-sm text-muted-foreground">Choose a module to start learning.</div>
                      )}

                      <div className="sticky bottom-3 z-10 rounded-3xl border bg-white/95 p-4 shadow-lg backdrop-blur">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" disabled={selectedModuleIndex <= 0} onClick={() => goToAdjacentModule(-1)}>
                              <ChevronLeft className="mr-2 h-4 w-4" />Previous
                            </Button>
                            <Button variant="outline" disabled={selectedModuleIndex < 0 || selectedModuleIndex >= assignmentModules.length - 1} onClick={() => goToAdjacentModule(1)}>
                              Next<ChevronRight className="ml-2 h-4 w-4" />
                            </Button>
                            {selectedModule?.kind === "lesson" ? (
                              <Button variant="outline" onClick={() => markLessonModuleComplete(selectedModule.id)}>
                                <CheckCircle2 className="mr-2 h-4 w-4" />Mark lesson complete
                              </Button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              disabled={learningBusy}
                              onClick={async () => {
                                if (!currentAssignment) return;
                                try {
                                  setLearningBusy(true);
                                  await runAction({ action: "SAVE_LEARNING_PROGRESS", assignmentId: currentAssignment.id, answers: assignmentAnswers }, "Draft saved");
                                } catch (err: any) {
                                  toast({ title: "Save failed", description: err.message ?? "Could not save draft.", variant: "destructive" });
                                } finally {
                                  setLearningBusy(false);
                                }
                              }}
                            >
                              <Save className="mr-2 h-4 w-4" />Save draft
                            </Button>
                            {currentAssignment.status === "COMPLETED" ? (
                              <Button
                                variant="outline"
                                disabled={learningBusy}
                                onClick={async () => {
                                  try {
                                    setLearningBusy(true);
                                    await runAction({ action: "RESTART_LEARNING", assignmentId: currentAssignment.id }, "Retake started");
                                    setAnswersByAssignment((current) => ({ ...current, [currentAssignment.id]: {} }));
                                    if (assignmentModules[0]?.id) {
                                      setSelectedModuleByAssignment((current) => ({ ...current, [currentAssignment.id]: assignmentModules[0].id }));
                                    }
                                  } catch (err: any) {
                                    toast({ title: "Retake failed", description: err.message ?? "Could not restart learning.", variant: "destructive" });
                                  } finally {
                                    setLearningBusy(false);
                                  }
                                }}
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />Retake from start
                              </Button>
                            ) : null}
                            <Button
                              disabled={learningBusy}
                              onClick={async () => {
                                try {
                                  setLearningBusy(true);
                                  if (currentAssignment.status !== "COMPLETED") {
                                    await runAction({ action: "START_LEARNING", assignmentId: currentAssignment.id }, "Learning started");
                                  }
                                  await runAction({ action: "SUBMIT_LEARNING", assignmentId: currentAssignment.id, answers: assignmentAnswers }, currentAssignment.status === "COMPLETED" ? "Answers resubmitted" : "Learning submitted");
                                } catch (err: any) {
                                  toast({ title: "Submit failed", description: err.message ?? "Try again.", variant: "destructive" });
                                } finally {
                                  setLearningBusy(false);
                                }
                              }}
                            >
                              {currentAssignment.status === "COMPLETED" ? "Resubmit answers" : "Submit learning"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border bg-white/80 p-8 text-sm text-muted-foreground">Select an assignment to begin.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents" className="grid gap-4 xl:grid-cols-[320px,1fr]">
          <Card>
            <CardHeader><CardTitle>Upload Document</CardTitle><CardDescription>Keep licences, police checks, CVs, and certifications in one place.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Category</Label><Select value={docForm.category} onValueChange={(value) => setDocForm((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Title</Label><Input value={docForm.title} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Expiry date</Label><Input type="date" value={docForm.expiresAt} onChange={(event) => setDocForm((current) => ({ ...current, expiresAt: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={docForm.notes} onChange={(event) => setDocForm((current) => ({ ...current, notes: event.target.value }))} /></div>
              <div className="space-y-2"><Label>File</Label><Input type="file" onChange={(event) => setDocFile(event.target.files?.[0] ?? null)} /></div>
              <Button disabled={!docFile || !docForm.title.trim()} onClick={async () => {
                try {
                  const upload = await uploadPrivateFile(docFile!, "staff-documents");
                  await runAction({ action: "UPLOAD_DOCUMENT", ...docForm, fileName: docFile!.name, s3Key: upload.key, url: upload.url, mimeType: upload.mimeType ?? docFile!.type }, "Document uploaded");
                  setDocFile(null);
                } catch (err: any) {
                  toast({ title: "Upload failed", description: err.message ?? "Could not upload document.", variant: "destructive" });
                }
              }}>Upload</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Your Documents</CardTitle><CardDescription>Admin can verify or reject these after review.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {(data?.documents ?? []).map((doc: any) => (
                <div key={doc.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{doc.title}</p>
                    <Badge variant="outline">{doc.category.replace(/_/g, " ")}</Badge>
                    <Badge variant={doc.status === "VERIFIED" ? "success" : doc.status === "REJECTED" ? "destructive" : "warning"}>{doc.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{doc.fileName}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex rounded-full border px-3 py-2 text-xs font-medium">Open</a>
                    {doc.expiresAt ? <Badge variant="outline">Expires {String(doc.expiresAt).slice(0, 10)}</Badge> : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recognition" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Your Recognition</CardTitle><CardDescription>QA trend visibility plus public recognition sent by admin.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">QA profile</p>
                  {typeof data?.me?.qaStars === "number" ? <Badge variant="warning">{data.me.qaStars.toFixed(1)} / 5</Badge> : <Badge variant="secondary">No QA average yet</Badge>}
                  {data?.me?.readinessLabel ? <Badge variant="outline">{data.me.readinessLabel}</Badge> : null}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Average QA: {data?.me?.qaAverage ?? "-"}% · Reviews: {data?.me?.qaReviewCount ?? 0}</p>
              </div>
              {(data?.recognitions ?? []).map((recognition: any) => (
                <div key={recognition.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{recognition.title}</p>
                    <Badge variant="outline"><Sparkles className="mr-1 h-3 w-3" />{recognition.badgeKey.replace(/_/g, " ")}</Badge>
                  </div>
                  {recognition.message ? <p className="mt-2 text-sm leading-6">{recognition.message}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">{new Date(recognition.createdAt).toLocaleString("en-AU")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

