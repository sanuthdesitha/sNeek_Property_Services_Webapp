"use client";

/** Application field-schema editor → PATCH .../[id]/application-schema.
 *  Stores { schema: { version: 3, steps } } exactly as v1 does. */
import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { EButton, ECard, ECardBody, ECardHeader, EAlert } from "@/components/v2/ui/primitives";
import { EInput, ESelect, ESwitch, EField } from "@/components/v2/admin/estate-kit";
import { FIELD_TYPES, uid, type AppStep, type AppField, type PositionShape } from "./types";

export function ApplicationSchemaEditor({
  positionId,
  position,
}: {
  positionId: string;
  position: PositionShape;
}) {
  const [steps, setSteps] = useState<AppStep[]>(() => position?.applicationSchema?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const setStep = (i: number, patch: Partial<AppStep>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addStep = () => setSteps((s) => [...s, { id: uid("step"), title: "New section", fields: [] }]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  const setField = (si: number, fi: number, patch: Partial<AppField>) =>
    setSteps((s) =>
      s.map((st, idx) =>
        idx !== si ? st : { ...st, fields: st.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) },
      ),
    );
  const addField = (si: number) =>
    setSteps((s) =>
      s.map((st, idx) =>
        idx !== si ? st : { ...st, fields: [...st.fields, { id: uid("f"), label: "New field", type: "text" }] },
      ),
    );
  const removeField = (si: number, fi: number) =>
    setSteps((s) =>
      s.map((st, idx) => (idx !== si ? st : { ...st, fields: st.fields.filter((_, j) => j !== fi) })),
    );
  const moveField = (si: number, fi: number, dir: -1 | 1) =>
    setSteps((s) =>
      s.map((st, idx) => {
        if (idx !== si) return st;
        const j = fi + dir;
        if (j < 0 || j >= st.fields.length) return st;
        const fields = [...st.fields];
        [fields[fi], fields[j]] = [fields[j], fields[fi]];
        return { ...st, fields };
      }),
    );

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${positionId}/application-schema`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: { version: 3, steps } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "danger", text: body.error ?? "Save failed." });
        return;
      }
      setMsg({ tone: "success", text: "Application form saved." });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message ?? "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Sections and the questions applicants fill in. Keep it short for more applicants.
        </p>
        <EButton onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save form
        </EButton>
      </div>

      {msg ? <EAlert tone={msg.tone === "success" ? "success" : "danger"} title={msg.text} /> : null}

      {steps.length === 0 ? (
        <ECard>
          <ECardBody className="pt-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No sections yet. Add one to start collecting applicant details.
          </ECardBody>
        </ECard>
      ) : null}

      {steps.map((step, si) => (
        <ECard key={step.id ?? si}>
          <ECardHeader className="gap-2">
            <div className="flex items-center gap-2">
              <EInput
                className="font-semibold"
                value={step.title ?? ""}
                onChange={(e) => setStep(si, { title: e.target.value })}
                placeholder="Section title"
              />
              <EButton variant="ghost" size="icon" onClick={() => moveStep(si, -1)} aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </EButton>
              <EButton variant="ghost" size="icon" onClick={() => moveStep(si, 1)} aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </EButton>
              <EButton variant="ghost" size="icon" onClick={() => removeStep(si)} aria-label="Delete section">
                <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
              </EButton>
            </div>
            <EInput
              className="text-[0.8125rem]"
              value={step.description ?? ""}
              onChange={(e) => setStep(si, { description: e.target.value })}
              placeholder="Optional section hint"
            />
          </ECardHeader>
          <ECardBody className="space-y-2">
            {(step.fields ?? []).map((field, fi) => (
              <div
                key={field.id ?? fi}
                className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                  <EInput
                    value={field.label ?? ""}
                    onChange={(e) => setField(si, fi, { label: e.target.value })}
                    placeholder="Question label"
                  />
                  <ESelect value={field.type ?? "text"} onChange={(e) => setField(si, fi, { type: e.target.value })}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </ESelect>
                  <div className="flex items-center gap-1">
                    <EButton variant="ghost" size="icon" onClick={() => moveField(si, fi, -1)} aria-label="Move field up">
                      <ArrowUp className="h-4 w-4" />
                    </EButton>
                    <EButton variant="ghost" size="icon" onClick={() => moveField(si, fi, 1)} aria-label="Move field down">
                      <ArrowDown className="h-4 w-4" />
                    </EButton>
                    <EButton variant="ghost" size="icon" onClick={() => removeField(si, fi)} aria-label="Delete field">
                      <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                    </EButton>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <ESwitch
                    checked={field.required === true}
                    onCheckedChange={(v) => setField(si, fi, { required: v })}
                    label="Required"
                  />
                  {field.type === "single" || field.type === "multi" ? (
                    <EInput
                      className="flex-1 text-[0.8125rem]"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        setField(si, fi, {
                          options: e.target.value
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Options, comma separated"
                    />
                  ) : (
                    <EInput
                      className="flex-1 text-[0.8125rem]"
                      value={field.placeholder ?? ""}
                      onChange={(e) => setField(si, fi, { placeholder: e.target.value })}
                      placeholder="Placeholder (optional)"
                    />
                  )}
                </div>
              </div>
            ))}
            <EButton variant="outline" size="sm" onClick={() => addField(si)}>
              <Plus className="h-4 w-4" />
              Add field
            </EButton>
          </ECardBody>
        </ECard>
      ))}

      <EButton variant="outline" onClick={addStep}>
        <Plus className="h-4 w-4" />
        Add section
      </EButton>
    </div>
  );
}
