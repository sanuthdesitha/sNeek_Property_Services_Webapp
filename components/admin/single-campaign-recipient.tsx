"use client";
import { useEffect, useState } from "react";
import { z } from "zod";

export function normalizedRecipientEmail(value: string) {
  return value.trim().toLowerCase();
}
export function validRecipientEmail(value: string) {
  return z.string().email().safeParse(normalizedRecipientEmail(value)).success;
}
export function SingleCampaignRecipient({ email, onChange }: { email: string; onChange: (email: string) => void }) {
  const normalized = normalizedRecipientEmail(email);
  const [result, setResult] = useState<{ email: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!validRecipientEmail(normalized)) return;
    const controller = new AbortController(); let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/email-campaigns/audience-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: { type: "single_recipient", filters: { email: normalized } } }), signal: controller.signal });
        const body = await response.json();
        if (!response.ok || (body.count !== 0 && body.count !== 1)) throw new Error("Preview unavailable");
        if (!cancelled) setResult({ email: normalized, message: body.count === 1 ? `1 matching recipient: ${normalized}` : `No matching recipient for ${normalized}. No other clients will be selected.` });
      } catch { if (!cancelled) setResult({ email: normalized, message: "Recipient preview unavailable. Try again before sending." }); }
    }, 250);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [normalized, retry]);
  return <div className="space-y-2">
    <label className="block text-sm">Recipient email<input aria-label="Recipient email" type="email" value={email} onChange={event => { setResult(null); onChange(event.target.value); }} className="block w-full rounded-md border bg-transparent px-3 py-2" placeholder="client@example.com" /></label>
    <p className="text-xs">Selects only this existing client or contact email. Eligibility and email preferences still apply.</p>
    <p role="status" className="text-xs">{!validRecipientEmail(normalized) ? "Enter a valid email to find the recipient." : result?.email === normalized ? result.message : "Checking recipient…"}</p>
    {result?.email === normalized && result.message.startsWith("Recipient preview unavailable") ? <button type="button" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Retry recipient preview</button> : null}
  </div>;
}
