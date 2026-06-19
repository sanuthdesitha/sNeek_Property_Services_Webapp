"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Share2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type PublicAssessmentQuestion = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  category: string;
  categoryLabel?: string;
  options?: Array<{ id: string; label: string }>;
  placeholder?: string;
  allowExplain?: boolean;
};

type PublicAssessment = {
  title: string;
  intro: string;
  questions: PublicAssessmentQuestion[];
};

type ApplicationField = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helper?: string;
};

type ApplicationStep = {
  id: string;
  title: string;
  description?: string;
  fields: ApplicationField[];
};

type PublicPosition = {
  slug: string;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  applicationSchema?: { steps?: ApplicationStep[]; heroImageUrl?: string | null } | null;
  assessment?: PublicAssessment | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function uploadPublicFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/public/uploads", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body.error ?? "Upload failed.");
  return body as { url: string; key: string; fileName?: string };
}

export function PublicHiringPage({ position }: { position: PublicPosition }) {
  const steps = useMemo<ApplicationStep[]>(() => position.applicationSchema?.steps ?? [], [position]);
  const assessment = position.assessment ?? null;
  const heroImage = position.applicationSchema?.heroImageUrl?.trim() || null;

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [resume, setResume] = useState<{ url: string; key: string; fileName: string } | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setAnswer = (id: string, value: any) => setAnswers((current) => ({ ...current, [id]: value }));

  const answeredAssessment = useMemo(() => {
    if (!assessment) return 0;
    return assessment.questions.filter((q) => {
      const v = answers[q.id];
      return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : Boolean(v);
    }).length;
  }, [assessment, answers]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = "Required";
    if (!email.trim()) next.email = "Required";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email";
    if (!phone.trim()) next.phone = "Required";

    for (const step of steps) {
      for (const field of step.fields) {
        if (field.id === "fullName" || field.id === "email" || field.id === "phone") continue;
        if (!field.required) continue;
        const v = answers[field.id];
        const missing = field.type === "multi" ? !Array.isArray(v) || v.length === 0 : field.type === "file" ? !resume : !String(v ?? "").trim();
        if (missing) next[field.id] = "Required";
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast({ title: "Please complete the highlighted fields", variant: "destructive" });
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      // Fold the top-level identity into answers too so the structured fields persist.
      const fullAnswers = { ...answers, fullName, email, phone };
      const res = await fetch(`/api/public/hiring/${position.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          coverLetter,
          answers: fullAnswers,
          resumeUrl: resume?.url ?? answers.resumeUrl ?? null,
          resumeKey: resume?.key ?? null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not submit application.");
      setSubmitted(true);
      toast({ title: "Application submitted", description: "Thanks — we'll be in touch." });
    } catch (err: any) {
      toast({ title: "Submit failed", description: err.message ?? "Could not submit application.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function sharePosition() {
    const url = typeof window !== "undefined" ? window.location.href : `/apply/${position.slug}`;
    const shareData = { title: `${position.title} — apply now`, text: `Join the team: ${position.title}`, url };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // user cancelled or unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Application link copied to clipboard." });
    } catch {
      toast({ title: "Could not share", description: url, variant: "destructive" });
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Card className="rounded-2xl text-center">
          <CardContent className="space-y-4 p-10">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="text-2xl font-semibold">Application received</h1>
            <p className="text-muted-foreground">
              Thanks for applying for <strong>{position.title}</strong>. Our team will review your application and knowledge check, and reach out
              if you are a good fit.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Hero banner — the flyer image if set, otherwise a branded gradient. */}
      <div className="overflow-hidden rounded-3xl border shadow-sm">
        {heroImage ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImage} alt={`${position.title} — hiring`} className="max-h-[440px] w-full object-cover" />
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3 rounded-full"
              onClick={() => void sharePosition()}
            >
              <Share2 className="mr-2 h-4 w-4" />Share
            </Button>
          </div>
        ) : (
          <div className="relative bg-gradient-to-br from-primary to-[#0f5a44] px-6 py-12 text-white">
            <div className="pointer-events-none absolute inset-0 opacity-20 [background:radial-gradient(circle_at_18%_20%,white,transparent_40%),radial-gradient(circle_at_85%_12%,white,transparent_35%)]" />
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-4 top-4 rounded-full"
              onClick={() => void sharePosition()}
            >
              <Share2 className="mr-2 h-4 w-4" />Share
            </Button>
            <div className="relative">
              <Badge variant="secondary" className="mb-3">We&apos;re hiring</Badge>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{position.title}</h1>
              <p className="mt-2 max-w-xl text-white/85">
                {position.location || "Greater Sydney"} · flexible days · paid training
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {heroImage ? <h1 className="text-3xl font-bold tracking-tight">{position.title}</h1> : null}
        <div className="flex flex-wrap gap-2">
          {position.location ? <Badge variant="outline">📍 {position.location}</Badge> : null}
          {position.employmentType ? <Badge variant="outline">🗓 {position.employmentType}</Badge> : null}
          {position.department ? <Badge variant="outline">{position.department}</Badge> : null}
        </div>
        {position.description ? (
          <div className="rounded-2xl border bg-white/90 p-5 text-sm leading-7 text-muted-foreground dark:bg-white/5">
            <p className="whitespace-pre-line">{position.description}</p>
          </div>
        ) : null}
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Apply now</CardTitle>
          <CardDescription>Fill in your details honestly. Fields marked * are required.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Core identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name *</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} />
              {errors.fullName ? <p className="text-xs text-destructive">{errors.fullName}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
              {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Mobile number *</Label>
            <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.phone} placeholder="04xx xxx xxx" />
            {errors.phone ? <p className="text-xs text-destructive">{errors.phone}</p> : null}
          </div>

          {/* Structured application steps (identity fields above are skipped) */}
          {steps.map((step) => {
            const renderable = step.fields.filter((f) => !["fullName", "email", "phone"].includes(f.id));
            if (renderable.length === 0) return null;
            return (
              <div key={step.id} className="rounded-2xl border bg-white/90 dark:bg-white/5 p-5 shadow-sm">
                <h3 className="text-lg font-semibold">{step.title}</h3>
                {step.description ? <p className="mt-1 text-sm text-muted-foreground">{step.description}</p> : null}
                <div className="mt-4 space-y-4">
                  {renderable.map((field) => (
                    <FieldRenderer
                      key={field.id}
                      field={field}
                      value={answers[field.id]}
                      error={errors[field.id]}
                      resume={resume}
                      resumeUploading={resumeUploading}
                      onChange={(value) => setAnswer(field.id, value)}
                      onResume={async (file) => {
                        try {
                          setResumeUploading(true);
                          const upload = await uploadPublicFile(file);
                          setResume({ url: upload.url, key: upload.key, fileName: upload.fileName || file.name });
                          setAnswer(field.id, upload.url);
                          toast({ title: "Resume uploaded" });
                        } catch (err: any) {
                          toast({ title: "Upload failed", description: err.message ?? "Could not upload file.", variant: "destructive" });
                        } finally {
                          setResumeUploading(false);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <Label>Cover letter / anything else (optional)</Label>
            <Textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} rows={3} />
          </div>
        </CardContent>
      </Card>

      {/* Knowledge / IQ test */}
      {assessment && assessment.questions.length > 0 ? (
        <Card className="rounded-2xl border-primary/20">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{assessment.title}</CardTitle>
              <Badge variant="secondary" className="tabular-nums">{answeredAssessment}/{assessment.questions.length} answered</Badge>
            </div>
            {assessment.intro ? <CardDescription>{assessment.intro}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {assessment.questions.map((q, index) => (
              <div key={q.id} className="rounded-2xl border bg-white/90 dark:bg-white/5 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{index + 1}</span>
                  <div className="flex-1 space-y-3">
                    <div className="space-y-1">
                      <p className="font-medium leading-6">{q.prompt}</p>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{q.categoryLabel || q.category}</p>
                    </div>
                    <AssessmentInput question={q} value={answers[q.id]} onChange={(value) => setAnswer(q.id, value)} />
                    {q.allowExplain && q.type !== "short" ? (
                      <Textarea
                        rows={2}
                        placeholder="Optional: briefly explain your choice"
                        value={answers[`${q.id}__explain`] || ""}
                        onChange={(e) => setAnswer(`${q.id}__explain`, e.target.value)}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">By submitting you agree we may contact you about this role.</p>
        <Button size="lg" disabled={submitting || resumeUploading} onClick={() => void handleSubmit()} className="rounded-full">
          {submitting ? "Submitting…" : "Submit application"}
        </Button>
      </div>
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  error,
  resume,
  resumeUploading,
  onChange,
  onResume,
}: {
  field: ApplicationField;
  value: any;
  error?: string;
  resume: { fileName: string } | null;
  resumeUploading: boolean;
  onChange: (value: any) => void;
  onResume: (file: File) => void | Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required ? " *" : ""}
      </Label>
      {field.helper ? <p className="text-xs text-muted-foreground">{field.helper}</p> : null}
      {field.type === "single" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name={field.id} className="accent-primary" checked={value === option} onChange={() => onChange(option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : field.type === "multi" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {(field.options ?? []).map((option) => {
            const values: string[] = Array.isArray(value) ? value : [];
            return (
              <label key={option} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <Checkbox
                  checked={values.includes(option)}
                  onCheckedChange={(checked) => onChange(checked ? [...values, option] : values.filter((v) => v !== option))}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      ) : field.type === "longText" ? (
        <Textarea rows={4} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} aria-invalid={!!error} />
      ) : field.type === "file" ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground hover:border-primary">
            <Upload className="h-4 w-4" />
            <span>{resumeUploading ? "Uploading…" : resume ? `Uploaded: ${resume.fileName}` : "Choose a PDF or DOC file"}</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onResume(file);
              }}
            />
          </label>
        </div>
      ) : (
        <Input
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "number" ? "number" : "text"}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-invalid={!!error}
        />
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function AssessmentInput({
  question,
  value,
  onChange,
}: {
  question: PublicAssessmentQuestion;
  value: any;
  onChange: (value: any) => void;
}) {
  if (question.type === "short") {
    return <Textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={question.placeholder || "Your answer"} />;
  }
  if (question.type === "multi") {
    const values: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {(question.options ?? []).map((option) => (
          <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <Checkbox
              className="mt-0.5"
              checked={values.includes(option.id)}
              onCheckedChange={(checked) => onChange(checked ? [...values, option.id] : values.filter((v) => v !== option.id))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {(question.options ?? []).map((option) => (
        <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name={question.id} className="mt-1 accent-primary" checked={value === option.id} onChange={() => onChange(option.id)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
