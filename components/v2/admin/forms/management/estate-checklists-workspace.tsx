"use client";

/**
 * ESTATE — Service checklists workspace (native v2 port of
 * components/forms/checklists-workspace.tsx). Per-service coverage editor:
 * what's covered (and not) for each service with how-to instructions, and a
 * "generate job form" action that mints a DRAFT FormTemplate from the checklist.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/admin/checklists                          → { checklists, jobTypes }
 *   PATCH /api/admin/checklists   { jobType, checklist } → { ok }
 *   POST  /api/admin/checklists/generate-form { jobType }→ { ok, templateId }
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, ClipboardList } from "lucide-react";
import {
  EButton,
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
  EAlert,
} from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ETextarea,
  ESelect,
  ESwitch,
} from "@/components/v2/admin/estate-kit";

type Item = {
  id: string;
  label: string;
  covered: boolean;
  instructions?: string;
  imageUrl?: string;
  videoUrl?: string;
};
type Section = { id: string; title: string; items: Item[] };
type Checklist = { jobType: string; summary?: string; notCovered?: string[]; sections: Section[] };

function prettyType(jt: string) {
  return jt
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || `i-${Math.round(Math.random() * 1e6)}`
  );
}

export function EstateChecklistsWorkspace() {
  const [checklists, setChecklists] = useState<Record<string, Checklist>>({});
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/checklists", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error ?? "Could not load checklists.");
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
    setChecklists((prev) => ({
      ...prev,
      [active]: updater(prev[active] ?? { jobType: active, sections: [] }),
    }));
  }

  async function save() {
    if (!checklist) return;
    setSaving(true);
    setError(null);
    setNotice(null);
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
      setNotice(`${prettyType(active)} checklist saved.`);
    } catch (err: any) {
      setError(err.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function generateForm() {
    if (!active) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/checklists/generate-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not generate form.");
      setNotice(
        "A draft form was created from this checklist — open the Templates tab to review, tweak and publish it."
      );
    } catch (err: any) {
      setError(err.message ?? "Could not generate form.");
    } finally {
      setGenerating(false);
    }
  }

  const coveredCount = useMemo(
    () =>
      (checklist?.sections ?? []).reduce(
        (n, s) => n + s.items.filter((i) => i.covered).length,
        0
      ),
    [checklist]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading checklists…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <EAlert tone="danger" title="Something went wrong">
          {error}
        </EAlert>
      ) : null}
      {notice ? (
        <EAlert tone="success" title="Done">
          {notice}
        </EAlert>
      ) : null}

      <ECard>
        <div className="flex flex-wrap items-end justify-between gap-3 p-4">
          <EField label="Service" className="w-full max-w-xs">
            <ESelect value={active} onChange={(e) => setActive(e.target.value)}>
              {jobTypes.length === 0 ? <option value="">No services</option> : null}
              {jobTypes.map((jt) => (
                <option key={jt} value={jt}>
                  {prettyType(jt)}
                </option>
              ))}
            </ESelect>
          </EField>
          {checklist ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {coveredCount} covered items
              </span>
              <EButton variant="outline" size="sm" onClick={() => void generateForm()} disabled={generating}>
                {generating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ClipboardList className="mr-1.5 h-3.5 w-3.5" />
                )}
                {generating ? "Generating…" : "Generate job form"}
              </EButton>
              <EButton size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                {saving ? "Saving…" : "Save checklist"}
              </EButton>
            </div>
          ) : null}
        </div>
      </ECard>

      {checklist ? (
        <>
          <ECard>
            <ECardHeader>
              <ECardTitle className="text-[1rem]">Overview</ECardTitle>
            </ECardHeader>
            <ECardBody className="space-y-3">
              <EField label="Summary">
                <EInput
                  value={checklist.summary ?? ""}
                  onChange={(e) => patch((c) => ({ ...c, summary: e.target.value }))}
                  placeholder="One line describing this service"
                />
              </EField>
              <EField label="Not covered (one per line)">
                <ETextarea
                  value={(checklist.notCovered ?? []).join("\n")}
                  onChange={(e) =>
                    patch((c) => ({
                      ...c,
                      notCovered: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder={"Mould remediation\nExterior windows above ground floor"}
                  rows={3}
                />
              </EField>
            </ECardBody>
          </ECard>

          {checklist.sections.map((section, sIdx) => (
            <ECard key={section.id}>
              <div className="flex flex-row items-center justify-between gap-2 p-4">
                <EInput
                  className="max-w-xs font-medium"
                  value={section.title}
                  onChange={(e) =>
                    patch((c) => {
                      const sections = [...c.sections];
                      sections[sIdx] = { ...sections[sIdx], title: e.target.value };
                      return { ...c, sections };
                    })
                  }
                />
                <EButton
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() =>
                    patch((c) => ({ ...c, sections: c.sections.filter((_, i) => i !== sIdx) }))
                  }
                  aria-label="Remove section"
                >
                  <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                </EButton>
              </div>
              <ECardBody className="space-y-3 pt-0">
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
                    <div
                      key={item.id}
                      className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"
                    >
                      <div className="flex items-center gap-2">
                        <EInput
                          value={item.label}
                          onChange={(e) => setItem({ label: e.target.value })}
                          placeholder="Task"
                        />
                        <ESwitch
                          checked={item.covered}
                          onCheckedChange={(v) => setItem({ covered: v })}
                          label={item.covered ? "Covered" : "Not covered"}
                        />
                        <EButton
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() =>
                            patch((c) => {
                              const sections = [...c.sections];
                              sections[sIdx] = {
                                ...sections[sIdx],
                                items: sections[sIdx].items.filter((_, i) => i !== iIdx),
                              };
                              return { ...c, sections };
                            })
                          }
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                        </EButton>
                      </div>
                      <ETextarea
                        value={item.instructions ?? ""}
                        onChange={(e) => setItem({ instructions: e.target.value })}
                        placeholder="How to clean this (shown to cleaners)…"
                        rows={2}
                      />
                      <EInput
                        value={item.videoUrl ?? ""}
                        onChange={(e) => setItem({ videoUrl: e.target.value })}
                        placeholder="How-to video URL (optional)"
                      />
                    </div>
                  );
                })}
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patch((c) => {
                      const sections = [...c.sections];
                      const newItem: Item = {
                        id: `${section.id}.${slug("item")}-${sections[sIdx].items.length + 1}`,
                        label: "",
                        covered: true,
                      };
                      sections[sIdx] = { ...sections[sIdx], items: [...sections[sIdx].items, newItem] };
                      return { ...c, sections };
                    })
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add item
                </EButton>
              </ECardBody>
            </ECard>
          ))}

          <EButton
            variant="outline"
            onClick={() =>
              patch((c) => ({
                ...c,
                sections: [
                  ...c.sections,
                  { id: slug(`section-${c.sections.length + 1}`), title: "New section", items: [] },
                ],
              }))
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add section
          </EButton>
        </>
      ) : (
        <p className="px-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Choose a service to edit its checklist.
        </p>
      )}
    </div>
  );
}
