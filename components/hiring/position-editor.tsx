"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Trash2, Save, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { toast } from "@/hooks/use-toast";

const FIELD_TYPES = ["text", "email", "phone", "single", "multi", "longText", "file", "number"] as const;
const Q_TYPES = ["single", "multi", "short"] as const;

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
}

export function PositionEditor({ position }: { position: any }) {
  const router = useRouter();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/admin/hiring"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Edit role</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{position.title}</h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/apply/${position.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> View apply page</a>
        </Button>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="form">Application form</TabsTrigger>
          <TabsTrigger value="quiz">Knowledge test</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-4"><DetailsTab position={position} onSaved={() => router.refresh()} /></TabsContent>
        <TabsContent value="form" className="mt-4"><FormSchemaEditor position={position} onSaved={() => router.refresh()} /></TabsContent>
        <TabsContent value="quiz" className="mt-4"><QuizDesigner position={position} onSaved={() => router.refresh()} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────
function DetailsTab({ position, onSaved }: { position: any; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: position.title ?? "",
    slug: position.slug ?? "",
    description: position.description ?? "",
    department: position.department ?? "",
    location: position.location ?? "",
    employmentType: position.employmentType ?? "",
    isPublished: position.isPublished !== false,
    requireKnowledgeTest: position.screening != null,
    passThreshold: position.screening?.passThreshold ?? 65,
    heroImageUrl: position.applicationSchema?.heroImageUrl ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${position.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: e.error, variant: "destructive" });
        return;
      }
      toast({ title: "Saved" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Public slug"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
        </div>
        <Field label="Description">
          <Textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Department"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Employment type"><Input value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} /></Field>
        </div>
        <Field label="Hero / flyer image">
          {form.heroImageUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.heroImageUrl} alt="Hero" className="h-32 w-full max-w-sm rounded-lg border object-cover" />
              <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, heroImageUrl: "" })}>Remove</Button>
            </div>
          ) : (
            <UploadDropzone accept="image/*" maxFiles={1} onUploaded={(r) => setForm({ ...form, heroImageUrl: r.url })} />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.isPublished} onCheckedChange={(v) => setForm({ ...form, isPublished: v === true })} /> Published
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.requireKnowledgeTest} onCheckedChange={(v) => setForm({ ...form, requireKnowledgeTest: v === true })} /> Require knowledge test
          </label>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Pass %</Label>
            <Input
              type="number" min={0} max={100} className="w-20"
              value={form.passThreshold}
              disabled={!form.requireKnowledgeTest}
              onChange={(e) => setForm({ ...form, passThreshold: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            />
          </div>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save details
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Application form editor ────────────────────────────────────────────────────
function FormSchemaEditor({ position, onSaved }: { position: any; onSaved: () => void }) {
  const [steps, setSteps] = useState<any[]>(() => position.applicationSchema?.steps ?? []);
  const [saving, setSaving] = useState(false);

  const setStep = (i: number, patch: any) => setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const moveStep = (i: number, dir: -1 | 1) => setSteps((s) => {
    const j = i + dir; if (j < 0 || j >= s.length) return s;
    const next = [...s]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const addStep = () => setSteps((s) => [...s, { id: uid("step"), title: "New section", fields: [] }]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const setField = (si: number, fi: number, patch: any) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, fields: st.fields.map((f: any, j: number) => (j === fi ? { ...f, ...patch } : f)) }));
  const addField = (si: number) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, fields: [...st.fields, { id: uid("f"), label: "New field", type: "text" }] }));
  const removeField = (si: number, fi: number) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, fields: st.fields.filter((_: any, j: number) => j !== fi) }));
  const moveField = (si: number, fi: number, dir: -1 | 1) =>
    setSteps((s) => s.map((st, idx) => {
      if (idx !== si) return st;
      const j = fi + dir; if (j < 0 || j >= st.fields.length) return st;
      const fields = [...st.fields]; [fields[fi], fields[j]] = [fields[j], fields[fi]]; return { ...st, fields };
    }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${position.id}/application-schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: { version: 3, steps } }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast({ title: "Save failed", description: e.error, variant: "destructive" }); return; }
      toast({ title: "Application form saved" });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Sections and the questions applicants fill in. Keep it short for more applicants.</p>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save form</Button>
      </div>
      {steps.map((step, si) => (
        <Card key={step.id ?? si}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Input className="font-semibold" value={step.title ?? ""} onChange={(e) => setStep(si, { title: e.target.value })} placeholder="Section title" />
              <Button variant="ghost" size="icon" onClick={() => moveStep(si, -1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => moveStep(si, 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeStep(si)}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <Input className="mt-2 text-xs" value={step.description ?? ""} onChange={(e) => setStep(si, { description: e.target.value })} placeholder="Optional section hint" />
          </CardHeader>
          <CardContent className="space-y-2">
            {(step.fields ?? []).map((field: any, fi: number) => (
              <div key={field.id ?? fi} className="rounded-lg border p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                  <Input value={field.label ?? ""} onChange={(e) => setField(si, fi, { label: e.target.value })} placeholder="Question label" />
                  <Select value={field.type ?? "text"} onValueChange={(v) => setField(si, fi, { type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => moveField(si, fi, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => moveField(si, fi, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeField(si, fi)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch checked={field.required === true} onCheckedChange={(v) => setField(si, fi, { required: v === true })} /> Required
                  </label>
                  {(field.type === "single" || field.type === "multi") ? (
                    <Input
                      className="flex-1 text-xs"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) => setField(si, fi, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
                      placeholder="Options, comma separated"
                    />
                  ) : (
                    <Input className="flex-1 text-xs" value={field.placeholder ?? ""} onChange={(e) => setField(si, fi, { placeholder: e.target.value })} placeholder="Placeholder (optional)" />
                  )}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => addField(si)}><Plus className="mr-1 h-4 w-4" /> Add field</Button>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" onClick={addStep}><Plus className="mr-1 h-4 w-4" /> Add section</Button>
    </div>
  );
}

// ── Quiz designer ──────────────────────────────────────────────────────────────
function QuizDesigner({ position, onSaved }: { position: any; onSaved: () => void }) {
  const screening = position.screening ?? null;
  const [questions, setQuestions] = useState<any[]>(() => screening?.questions ?? []);
  const [passThreshold, setPassThreshold] = useState<number>(screening?.passThreshold ?? 65);
  const [title, setTitle] = useState<string>(screening?.title ?? "");
  const [intro, setIntro] = useState<string>(screening?.intro ?? "");
  const [saving, setSaving] = useState(false);

  const setQ = (i: number, patch: any) => setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const addQ = () => setQuestions((qs) => [...qs, { id: uid("q"), prompt: "New question", type: "single", category: "judgement", weight: 1, options: [{ id: uid("o"), label: "Option 1" }], correct: "" }]);
  const removeQ = (i: number) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const moveQ = (i: number, dir: -1 | 1) => setQuestions((qs) => { const j = i + dir; if (j < 0 || j >= qs.length) return qs; const n = [...qs]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const setOption = (qi: number, oi: number, label: string) =>
    setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : { ...q, options: q.options.map((o: any, j: number) => (j === oi ? { ...o, label } : o)) }));
  const addOption = (qi: number) =>
    setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : { ...q, options: [...(q.options ?? []), { id: uid("o"), label: "New option" }] }));
  const removeOption = (qi: number, oi: number) =>
    setQuestions((qs) => qs.map((q, idx) => idx !== qi ? q : { ...q, options: q.options.filter((_: any, j: number) => j !== oi) }));

  function toggleCorrect(qi: number, optId: string, type: string) {
    setQuestions((qs) => qs.map((q, idx) => {
      if (idx !== qi) return q;
      if (type === "single") return { ...q, correct: optId };
      const arr: string[] = Array.isArray(q.correct) ? q.correct : [];
      return { ...q, correct: arr.includes(optId) ? arr.filter((x) => x !== optId) : [...arr, optId] };
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${position.id}/screening-schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireKnowledgeTest: true, passThreshold, title, intro, questions }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast({ title: "Save failed", description: e.error, variant: "destructive" }); return; }
      toast({ title: "Knowledge test saved" });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{questions.length} question(s). Short-answer questions are reviewed by a human; multiple-choice is auto-scored.</p>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Pass %</Label>
          <Input type="number" min={0} max={100} className="w-20" value={passThreshold} onChange={(e) => setPassThreshold(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save test</Button>
        </div>
      </div>
      <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Test title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Knowledge check" /></Field>
        <Field label="Intro"><Input value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Shown above the questions" /></Field>
      </CardContent></Card>

      {questions.map((q, qi) => (
        <Card key={q.id ?? qi}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-sm font-semibold text-muted-foreground">{qi + 1}.</span>
              <Textarea className="flex-1" rows={2} value={q.prompt ?? ""} onChange={(e) => setQ(qi, { prompt: e.target.value })} placeholder="Question prompt" />
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="icon" onClick={() => moveQ(qi, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => moveQ(qi, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeQ(qi)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={q.type ?? "single"} onValueChange={(v) => setQ(qi, { type: v })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{Q_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="w-40" value={q.category ?? ""} onChange={(e) => setQ(qi, { category: e.target.value })} placeholder="Category" />
              <div className="flex items-center gap-1">
                <Label className="text-xs">Weight</Label>
                <Input type="number" min={1} max={5} className="w-16" value={q.weight ?? 1} onChange={(e) => setQ(qi, { weight: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
            </div>
            {q.type !== "short" ? (
              <div className="space-y-1.5">
                {(q.options ?? []).map((o: any, oi: number) => {
                  const isCorrect = q.type === "single" ? q.correct === o.id : Array.isArray(q.correct) && q.correct.includes(o.id);
                  return (
                    <div key={o.id ?? oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCorrect(qi, o.id, q.type)}
                        className={`shrink-0 rounded-md border px-2 py-1 text-[11px] ${isCorrect ? "border-emerald-500 bg-emerald-500/10 text-emerald-700" : "text-muted-foreground"}`}
                      >
                        {isCorrect ? "✓ correct" : "mark correct"}
                      </button>
                      <Input value={o.label ?? ""} onChange={(e) => setOption(qi, oi, e.target.value)} />
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeOption(qi, oi)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => addOption(qi)}><Plus className="mr-1 h-4 w-4" /> Add option</Button>
              </div>
            ) : (
              <Badge variant="secondary" className="text-[11px]">Free-text — human reviewed</Badge>
            )}
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" onClick={addQ}><Plus className="mr-1 h-4 w-4" /> Add question</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
