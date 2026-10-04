"use client";
import { OperationsPage, OperationsButton, OperationsNotice, OperationsLoading } from "@/components/operations/ui";
import * as React from "react";
type Account = { contextId: string; name: string; email: string; role: string; expiresAt: string; available: boolean };
export default function AccountsPage() {
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [canEnroll, setCanEnroll] = React.useState(false);
  const [step, setStep] = React.useState<"owner" | "other" | "consent">("owner");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [factor, setFactor] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  async function refresh() {
    const res = await fetch("/api/auth/retained", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not load accounts");
    setLoaded(true); setAccounts(body.accounts ?? []); setCanEnroll(body.canEnroll === true);
    if (body.currentEmail) setEmail(body.currentEmail);
  }
  React.useEffect(() => { void refresh().catch(error => setError(error.message)); }, []);
  async function post(body: unknown, path = "/api/auth/retained") {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? "Account verification failed");
    return result;
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (!factor) {
        const first = await post({ email, password }, "/api/auth/2fa/begin");
        if (first.required) { setFactor(true); return; }
      } else await post({ email, password, code, remember: false }, "/api/auth/2fa/complete");
      await post({ action: "prepare", slot: step, credentials: { email, password } });
      setPassword(""); setEmail(""); setCode(""); setFactor(false);
      setStep(step === "owner" ? "other" : "consent");
    } catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function link() {
    setBusy(true); setError(""); setNotice("");
    try { await post({ action: "link", consent }); await refresh(); setStep("owner"); setConsent(false); setNotice("Your accounts are linked. Choose an account below."); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function revoke(account: Account, all = false) {
    setBusy(true); setError(""); setNotice("");
    try { await post({ action: "revoke", contextId: account.contextId, all }); await refresh(); setNotice(all ? "Both retained accounts removed." : "Retained account removed."); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <OperationsPage title="Your accounts" backHref="/v2" backLabel="Back to portal">
    <p>Keep your own Admin and Cleaner accounts signed in. Each tab keeps its identity. Save unfinished work before closing a tab; you can open the other account in a new tab.</p>
    {error ? <OperationsNotice tone="danger">{error}</OperationsNotice> : null}
    {!loaded && !error ? <OperationsLoading label="Loading your accounts…" /> : null}
    {notice ? <OperationsNotice tone="success">{notice}</OperationsNotice> : null}{busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
    {error && !loaded ? <OperationsButton variant="outline" onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}>Retry loading accounts</OperationsButton> : null}
    {accounts.map(account => <section key={account.contextId} className="ops-card space-y-4">
      <h2 className="font-semibold">{account.name || account.email} — {account.role}</h2>
      <p>{account.email}</p><p>{account.available ? `Valid until ${new Date(account.expiresAt).toLocaleString()}` : "Expired or removed — authenticate again"}</p>
      {account.available ? <div className="ops-actions">
        <OperationsButton asChild variant="outline"><a href={`/_accounts/${account.contextId}/v2/${account.role === "ADMIN" ? "admin" : "cleaner"}`}>Open {account.role === "ADMIN" ? "Admin" : "Cleaner"}</a></OperationsButton>
        <OperationsButton asChild variant="outline"><a target="_blank" rel="noopener noreferrer" href={`/_accounts/${account.contextId}/v2/${account.role === "ADMIN" ? "admin" : "cleaner"}`}>Open in new tab</a></OperationsButton>
        {canEnroll ? <OperationsButton variant="ghost" disabled={busy} onClick={() => void revoke(account)}>Remove</OperationsButton> : null}
      </div> : null}
    </section>)}
    {loaded && (accounts.some(account => account.available) ? <>{canEnroll ? <OperationsButton variant="danger" disabled={busy} onClick={() => void revoke(accounts.find(account => account.available)!, true)}>Remove both retained accounts</OperationsButton> : null}</> : canEnroll ? <section className="ops-card space-y-4">
      <p className="e-eyebrow">Step {step === "owner" ? "1 of 3" : step === "other" ? "2 of 3" : "3 of 3"}</p>
      <h2 className="font-semibold">{step === "owner" ? "Verify your current account" : step === "other" ? "Verify your other account" : "Confirm account linking"}</h2>
      {step !== "consent" ? <form onSubmit={verify} className="space-y-3">
        <label className="block">Email<input required type="email" autoComplete="username" value={email} disabled={busy || factor} onChange={event => setEmail(event.target.value)} className="ops-field" /></label>
        <label className="block">Password<input required type="password" autoComplete="current-password" value={password} disabled={busy || factor} onChange={event => setPassword(event.target.value)} className="ops-field" /></label>
        {factor ? <label className="block">Verification code<input required autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} className="ops-field" /></label> : null}
        <OperationsButton disabled={busy} >{busy ? "Verifying…" : factor ? "Verify code" : "Verify account"}</OperationsButton>
      </form> : <>
        <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />Both accounts are mine. Keep them signed in on this browser for up to eight hours.</label>
        <OperationsButton disabled={busy || !consent}  onClick={() => void link()}>Link my accounts</OperationsButton>
      </>}
    </section> : <OperationsButton asChild variant="outline"><a href="/v2/login">Sign in to link or manage accounts</a></OperationsButton>)}
  </OperationsPage>;
}
