"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type Question = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  options?: Array<{ id: string; label: string }>;
  placeholder?: string;
};

export default function QuizPage({ params }: { params: { token: string } }) {
  const [quiz, setQuiz] = useState<{ title: string; intro: string; status: string; questions: Question[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/quiz/${params.token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) { setError(data.error); return; }
        setQuiz(data);
        if (data.status === "COMPLETED") setDone(true);
      })
      .catch(() => setError("Could not load the quiz."))
      .finally(() => setLoading(false));
  }, [params.token]);

  const setAnswer = (id: string, v: any) => setAnswers((a) => ({ ...a, [id]: v }));

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/quiz/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Could not submit."); return; }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-start justify-center p-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,178,98,0.18),transparent_35%),radial-gradient(circle_at_86%_10%,rgba(38,157,169,0.18),transparent_31%)]" />
      <div className="w-full max-w-xl space-y-4">
        {loading ? (
          <Card><CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</CardContent></Card>
        ) : error ? (
          <Card><CardContent className="py-10"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></CardContent></Card>
        ) : done ? (
          <Card className="text-center">
            <CardContent className="space-y-3 py-10">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="text-2xl font-semibold">Thank you!</h1>
              <p className="text-muted-foreground">Your answers have been submitted. We&apos;ll be in touch.</p>
            </CardContent>
          </Card>
        ) : quiz ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">{quiz.title}</CardTitle>
                {quiz.intro ? <CardDescription>{quiz.intro}</CardDescription> : null}
              </CardHeader>
            </Card>
            {quiz.questions.map((q, i) => (
              <Card key={q.id}>
                <CardContent className="space-y-3 p-5">
                  <p className="font-medium"><span className="text-muted-foreground">{i + 1}.</span> {q.prompt}</p>
                  {q.type === "short" ? (
                    <Textarea rows={3} placeholder={q.placeholder || "Your answer"} value={answers[q.id] || ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
                  ) : q.type === "multi" ? (
                    <div className="space-y-2">
                      {(q.options ?? []).map((o) => {
                        const arr: string[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];
                        return (
                          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                            <Checkbox checked={arr.includes(o.id)} onCheckedChange={(c) => setAnswer(q.id, c ? [...arr, o.id] : arr.filter((x) => x !== o.id))} />
                            <span>{o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(q.options ?? []).map((o) => (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                          <input type="radio" name={q.id} className="accent-primary" checked={answers[q.id] === o.id} onChange={() => setAnswer(q.id, o.id)} />
                          <span>{o.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit answers"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
