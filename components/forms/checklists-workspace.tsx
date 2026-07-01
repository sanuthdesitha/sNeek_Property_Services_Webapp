"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, ListChecks, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/hooks/use-toast";

type Item = { id: string; label: string; covered: boolean; instructions?: string; imageUrl?: string; videoUrl?: string };
type Section = { id: string; title: string; items: Item[] };
type Checklist = { jobType: string; summary?: string; notCovered?: string[]; sections: Section[] };

function prettyType(jt: string) {
  return jt.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || `i-${Math.round(Math.random() * 1e6)}`;
}

export function ChecklistsWorkspace() {
  const [checklists, setChecklists] = useState<Record<string, Checklist>>({});
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/checklists", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Could not load checklists", description: body.error ?? "Retry.", variant: "destructive" });
          return;
        }
        setChecklists(body.checklists ?? {});
        setJobTypes(body.jobTypes ?? []);
        setActive((body.jobTypes ?? [])[0] ?? "");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const checklist = active ? checklists[active] : undefined;

  function patch(updater: (c: Checklist) => Checklist) {
    if (!active) return;
    setChecklists((prev) => ({ ...prev, [active]: updater(prev[active] ?? { jobType: active, sections: [] }) }));
  }

  async function save() {
    if (!checklist) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/checklists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: active, checklist }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed.");
      }
      toast({ title: `${prettyType(active)} checklist saved` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function generateForm() {
    if (!active) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/checklists/generate-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not generate form.");
      toast({
        title: "Job form generated",
        description: "A draft form was created from this checklist — open Forms to review, tweak and publish it.",
      });
    } catch (err: any) {
      toast({ title: "Generate failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  const coveredCount = useMemo(
    () => (checklist?.sections ?? []).reduce((n, s) => n + s.items.filter((i) => i.covered).length, 0),
    [checklist]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading checklists…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ListChecks />}
        title="Service checklists"
        description="What's covered (and not) for each service, with how-to instructions. Sent with quotes and used to generate the matching job form."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="w-full max-w-xs space-y-1.5">
            <Label>Service</Label>
            <Select value={active} onValueChange={setActive}>
              <SelectTrigger><SelectValue placeholder="Choose a service" /></SelectTrigger>
              <SelectContent>
                {jobTypes.map((jt) => <SelectItem key={jt} value={jt}>{prettyType(jt)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {checklist ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">{coveredCount} covered items</span>
              <Button variant="outline" onClick={generateForm} disabled={generating}>
                <ClipboardList className="mr-2 h-4 w-4" />
                {generating ? "Generating…" : "Generate job form"}
              </Button>
              <Button onClick={save} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving…" : "Save checklist"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {checklist ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Summary</Label>
                <Input value={checklist.summary ?? ""} onChange={(e) => patch((c) => ({ ...c, summary: e.target.value }))} placeholder="One line describing this service" />
              </div>
              <div className="space-y-1.5">
                <Label>Not covered (one per line)</Label>
                <Textarea
                  value={(checklist.notCovered ?? []).join("\n")}
                  onChange={(e) => patch((c) => ({ ...c, notCovered: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }))}
                  placeholder="Mould remediation&#10;Exterior windows above ground floor"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {checklist.sections.map((section, sIdx) => (
            <Card key={section.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <Input
                  className="max-w-xs font-medium"
                  value={section.title}
                  onChange={(e) => patch((c) => {
                    const sections = [...c.sections];
                    sections[sIdx] = { ...sections[sIdx], title: e.target.value };
                    return { ...c, sections };
                  })}
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => patch((c) => ({ ...c, sections: c.sections.filter((_, i) => i !== sIdx) }))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {section.items.map((item, iIdx) => {
                  const setItem = (patchItem: Partial<Item>) =>
                    patch((c) => {
                      const sections = [...c.sections];
                      const items = [...sections[sIdx].items];
                      items[iIdx] = { ...items[iIdx], ...patchItem };
                      sections[sIdx] = { ...sections[sIdx], items };
                      return { ...c, sections };
                    });
                  return (
                    <div key={item.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <Input value={item.label} onChange={(e) => setItem({ label: e.target.value })} placeholder="Task" />
                        <label className="flex shrink-0 items-center gap-1.5 text-xs">
                          <Switch checked={item.covered} onCheckedChange={(v) => setItem({ covered: v })} />
                          {item.covered ? "Covered" : "Not covered"}
                        </label>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => patch((c) => {
                          const sections = [...c.sections];
                          sections[sIdx] = { ...sections[sIdx], items: sections[sIdx].items.filter((_, i) => i !== iIdx) };
                          return { ...c, sections };
                        })}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <Textarea value={item.instructions ?? ""} onChange={(e) => setItem({ instructions: e.target.value })} placeholder="How to clean this (shown to cleaners)…" rows={2} />
                      <Input value={item.videoUrl ?? ""} onChange={(e) => setItem({ videoUrl: e.target.value })} placeholder="How-to video URL (optional)" />
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => patch((c) => {
                  const sections = [...c.sections];
                  const newItem: Item = { id: `${section.id}.${slug("item")}-${sections[sIdx].items.length + 1}`, label: "", covered: true };
                  sections[sIdx] = { ...sections[sIdx], items: [...sections[sIdx].items, newItem] };
                  return { ...c, sections };
                })}>
                  <Plus className="mr-1 h-4 w-4" /> Add item
                </Button>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={() => patch((c) => ({
            ...c,
            sections: [...c.sections, { id: slug(`section-${c.sections.length + 1}`), title: "New section", items: [] }],
          }))}>
            <Plus className="mr-2 h-4 w-4" /> Add section
          </Button>
        </>
      ) : null}
    </div>
  );
}
