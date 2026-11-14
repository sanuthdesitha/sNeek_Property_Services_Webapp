"use client";

/**
 * "Hires become" (board "Hiring", 2026-11-16): the explicit account role a
 * person hired into this role gets. It replaces the old guess from the offer
 * title. Saved on its own (PATCH the role with `hireAccountRole` only); an
 * offer can still choose another role for one person. Who may then hire into
 * it is decided by the server (operations managers: Cleaner and Laundry only).
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, ESelect } from "@/components/v2/admin/estate-kit";
import { accountKindLabel, HIRE_ACCOUNT_KINDS, hiresBecomeLabel } from "@/lib/accounts/create-account-rules";

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function HiresBecomeCard({ positionId, title, initial, summary }: { positionId: string | null; title: string; initial: string | null; summary: React.ReactNode }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [state, setState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    setValue(initial ?? "");
    setSaved(initial ?? "");
    setState({ status: "idle" });
  }, [positionId, initial]);

  async function save() {
    if (!positionId) return;
    setState({ status: "saving" });
    try {
      const res = await fetch(`/api/admin/workforce/hiring/positions/${encodeURIComponent(positionId)}/hires-become`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hireAccountRole: value || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setState({ status: "error", message: body.error ?? "Not saved." });
      setSaved(value);
      setState({ status: "saved" });
    } catch {
      setState({ status: "error", message: "Not saved: the request did not reach the server." });
    }
  }

  return (
    <section aria-labelledby="hires-become-title" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <h2 id="hires-become-title" className="text-[0.9375rem] font-semibold">Details tab, in short</h2>
      <div className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{summary}</div>
      <fieldset disabled={state.status === "saving" || !positionId} className="mt-3 space-y-2">
        <EField label="Hires become" hint={`Hiring someone into ${title || "this role"} creates ${value ? hiresBecomeLabel(value).toLowerCase() : "nothing until you choose"}. The account role is no longer guessed from the offer title.`}>
          <ESelect value={value} onChange={(e) => setValue(e.target.value)} className="max-sm:text-[16px]">
            <option value="">Not chosen</option>
            {HIRE_ACCOUNT_KINDS.map((kind) => <option key={kind} value={kind}>{accountKindLabel(kind)} accounts</option>)}
          </ESelect>
        </EField>
        <EButton type="button" size="sm" variant="outline" onClick={save} disabled={value === saved || state.status === "saving"}>
          {state.status === "saving" ? "Saving…" : "Save hires become"}
        </EButton>
        <p role={state.status === "error" ? "alert" : "status"} className={`text-[0.75rem] ${state.status === "error" ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-muted-foreground))]"}`}>
          {state.status === "saved" ? "Saved." : state.status === "error" ? state.message : !positionId ? "Save the details first." : ""}
        </p>
      </fieldset>
    </section>
  );
}
