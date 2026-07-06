"use client";

/** Job-post fields → POST (create) or PATCH (update) the position. */
import { useState } from "react";
import { Loader2, Save, Check } from "lucide-react";
import { EButton, ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { EInput, ETextarea, EField, ESwitch } from "@/components/v2/admin/estate-kit";
import type { PositionShape } from "./types";

const EMPLOYMENT_TYPES = ["", "Full-time", "Part-time", "Casual", "Contract", "Internship"];

export function DetailsTab({
  mode,
  position,
  positionId,
  onCreated,
  onSaved,
}: {
  mode: "new" | "edit";
  position: PositionShape;
  positionId: string | null;
  onCreated: (p: { id: string; slug?: string | null; title?: string }) => void;
  onSaved: (p: { slug?: string | null; title?: string }) => void;
}) {
  const [form, setForm] = useState({
    title: position?.title ?? "",
    slug: position?.slug ?? "",
    description: position?.description ?? "",
    department: position?.department ?? "",
    location: position?.location ?? "",
    employmentType: position?.employmentType ?? "",
    isPublished: position?.isPublished !== false,
    requireKnowledgeTest: position?.screening != null,
    passThreshold: position?.screening?.passThreshold ?? 65,
    heroImageUrl: position?.applicationSchema?.heroImageUrl ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const creating = positionId == null;
      const url = creating
        ? `/api/admin/workforce/hiring/positions`
        : `/api/admin/workforce/hiring/positions/${positionId}`;
      const res = await fetch(url, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "danger", text: body.error ?? "Save failed." });
        return;
      }
      if (creating) {
        onCreated({ id: body.id, slug: body.slug ?? form.slug, title: form.title });
      } else {
        onSaved({ slug: form.slug, title: form.title });
      }
      setMsg({ tone: "success", text: creating ? "Role created." : "Details saved." });
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message ?? "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-5 pt-6">
        {msg ? (
          <EAlert tone={msg.tone === "success" ? "success" : "danger"} title={msg.text} />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Title">
            <EInput value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Estate Cleaner" />
          </EField>
          <EField label="Public slug" hint="Used in the public apply URL — /apply/slug">
            <EInput value={form.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="estate-cleaner" />
          </EField>
        </div>

        <EField label="Description">
          <ETextarea
            rows={5}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="What the role involves, who thrives in it…"
          />
        </EField>

        <div className="grid gap-4 sm:grid-cols-3">
          <EField label="Department">
            <EInput value={form.department} onChange={(e) => set({ department: e.target.value })} />
          </EField>
          <EField label="Location">
            <EInput value={form.location} onChange={(e) => set({ location: e.target.value })} />
          </EField>
          <EField label="Employment type">
            <select
              className="h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 pr-8 text-[0.875rem] text-[hsl(var(--e-foreground))] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))]"
              value={form.employmentType}
              onChange={(e) => set({ employmentType: e.target.value })}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || "—"}
                </option>
              ))}
            </select>
          </EField>
        </div>

        <EField label="Hero / flyer image URL" hint="Shown at the top of the public apply page (optional).">
          <EInput
            value={form.heroImageUrl}
            onChange={(e) => set({ heroImageUrl: e.target.value })}
            placeholder="https://…"
          />
          {form.heroImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.heroImageUrl}
              alt="Hero preview"
              className="mt-2 h-32 w-full max-w-sm rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
            />
          ) : null}
        </EField>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
          <ESwitch
            checked={form.isPublished}
            onCheckedChange={(v) => set({ isPublished: v })}
            label="Published (accepting applications)"
          />
          <ESwitch
            checked={form.requireKnowledgeTest}
            onCheckedChange={(v) => set({ requireKnowledgeTest: v })}
            label="Require knowledge test"
          />
          <div className="flex items-center gap-2">
            <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Pass %</span>
            <EInput
              type="number"
              min={0}
              max={100}
              className="w-20"
              disabled={!form.requireKnowledgeTest}
              value={form.passThreshold}
              onChange={(e) =>
                set({ passThreshold: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <EButton onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "new" && positionId == null ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {positionId == null ? "Create role" : "Save details"}
          </EButton>
          {positionId == null ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Save the role to unlock the application form and knowledge test.
            </p>
          ) : null}
        </div>
      </ECardBody>
    </ECard>
  );
}
