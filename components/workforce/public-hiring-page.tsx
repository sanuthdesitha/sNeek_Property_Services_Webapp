"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

async function uploadPublicFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/public/uploads", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body.error ?? "Upload failed.");
  return body;
}

export function PublicHiringPage({ position }: { position: any }) {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [resume, setResume] = useState<{ url: string; key: string; fileName: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="space-y-3">
        <Badge variant="outline">Hiring</Badge>
        <h1 className="text-3xl font-bold">{position.title}</h1>
        <p className="text-muted-foreground">{position.location || "Location flexible"}{position.department ? ` · ${position.department}` : ""}{position.employmentType ? ` · ${position.employmentType}` : ""}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Apply Now</CardTitle>
          <CardDescription>{position.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Full name</Label><Input value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>Phone</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
          {(position.applicationSchema?.steps ?? []).map((step: any) => (
            <div key={step.id} className="rounded-2xl border bg-white/90 p-5 shadow-sm">
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <div className="mt-4 space-y-4">
                {(step.fields ?? []).map((field: any) => (
                  <div key={field.id} className="space-y-2">
                    <Label>{field.label}{field.required ? " *" : ""}</Label>
                    {field.type === "single" ? (
                      <div className="space-y-2">
                        {(field.options ?? []).map((option: string) => (
                          <label key={option} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                            <input type="radio" name={field.id} checked={answers[field.id] === option} onChange={() => setAnswers((current) => ({ ...current, [field.id]: option }))} />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : field.type === "multi" ? (
                      <div className="space-y-2">
                        {(field.options ?? []).map((option: string) => {
                          const values = Array.isArray(answers[field.id]) ? answers[field.id] : [];
                          return (
                            <label key={option} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                              <Checkbox checked={values.includes(option)} onCheckedChange={(checked) => setAnswers((current) => ({ ...current, [field.id]: checked ? [...values, option] : values.filter((item: string) => item !== option) }))} />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : field.type === "longText" ? (
                      <Textarea value={answers[field.id] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />
                    ) : field.type === "file" ? (
                      <div className="space-y-2">
                        <Input type="file" onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          try {
                            const upload = await uploadPublicFile(file);
                            setResume({ url: upload.url, key: upload.key, fileName: upload.fileName || file.name });
                            setAnswers((current) => ({ ...current, [field.id]: upload.url }));
                            toast({ title: "Resume uploaded" });
                          } catch (err: any) {
                            toast({ title: "Upload failed", description: err.message ?? "Could not upload file.", variant: "destructive" });
                          }
                        }} />
                        {resume ? <p className="text-xs text-muted-foreground">Uploaded: {resume.fileName}</p> : null}
                      </div>
                    ) : (
                      <Input type={field.type === "email" ? "email" : "text"} value={answers[field.id] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-2"><Label>Cover letter / extra note</Label><Textarea value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} /></div>
          <Button disabled={submitting || !fullName.trim() || !email.trim()} onClick={async () => {
            try {
              setSubmitting(true);
              const res = await fetch(`/api/public/hiring/${position.slug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fullName, email, phone, coverLetter, answers, resumeUrl: resume?.url ?? null, resumeKey: resume?.key ?? null }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(body.error ?? "Could not submit application.");
              toast({ title: "Application submitted" });
              setFullName("");
              setEmail("");
              setPhone("");
              setCoverLetter("");
              setAnswers({});
              setResume(null);
            } catch (err: any) {
              toast({ title: "Submit failed", description: err.message ?? "Could not submit application.", variant: "destructive" });
            } finally {
              setSubmitting(false);
            }
          }}>Submit application</Button>
        </CardContent>
      </Card>
    </div>
  );
}

