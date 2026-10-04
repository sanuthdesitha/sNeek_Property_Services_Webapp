"use client";
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
  async function refresh() {
    const res = await fetch("/api/auth/retained", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not load accounts");
    setAccounts(body.accounts ?? []); setCanEnroll(body.canEnroll === true);
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
    event.preventDefault(); setBusy(true); setError("");
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
    setBusy(true); setError("");
    try { await post({ action: "link", consent }); await refresh(); setStep("owner"); setConsent(false); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function revoke(account: Account, all = false) {
    setBusy(true); setError("");
    try { await post({ action: "revoke", contextId: account.contextId, all }); await refresh(); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Your accounts</h1>
    <p>Keep your own Admin and Cleaner accounts signed in. Each tab keeps its identity. Save unfinished work before closing a tab; you can open the other account in a new tab.</p>
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    {accounts.map(account => <section key={account.contextId} className="space-y-2 rounded border p-4">
      <h2 className="font-semibold">{account.name || account.email} — {account.role}</h2>
      <p>{account.email}</p><p>{account.available ? `Valid until ${new Date(account.expiresAt).toLocaleString()}` : "Expired or removed — authenticate again"}</p>
      {account.available ? <div className="flex gap-4">
        <a className="underline" href={`/_accounts/${account.contextId}/v2/${account.role === "ADMIN" ? "admin" : "cleaner"}`}>Open {account.role === "ADMIN" ? "Admin" : "Cleaner"}</a>
        <a className="underline" target="_blank" rel="noopener noreferrer" href={`/_accounts/${account.contextId}/v2/${account.role === "ADMIN" ? "admin" : "cleaner"}`}>Open in new tab</a>
        {canEnroll ? <button disabled={busy} onClick={() => void revoke(account)}>Remove</button> : null}
      </div> : null}
    </section>)}
    {accounts.some(account => account.available) ? <>{canEnroll ? <button className="rounded border p-2" disabled={busy} onClick={() => void revoke(accounts.find(account => account.available)!, true)}>Remove both retained accounts</button> : null}</> : canEnroll ? <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">{step === "owner" ? "Verify your current account" : step === "other" ? "Verify your other account" : "Confirm account linking"}</h2>
      {step !== "consent" ? <form onSubmit={verify} className="space-y-3">
        <label className="block">Email<input required type="email" autoComplete="username" value={email} disabled={busy || factor} onChange={event => setEmail(event.target.value)} className="block w-full rounded border p-2" /></label>
        <label className="block">Password<input required type="password" autoComplete="current-password" value={password} disabled={busy || factor} onChange={event => setPassword(event.target.value)} className="block w-full rounded border p-2" /></label>
        {factor ? <label className="block">Verification code<input required autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} className="block w-full rounded border p-2" /></label> : null}
        <button disabled={busy} className="rounded border p-2">{busy ? "Verifying…" : factor ? "Verify code" : "Verify account"}</button>
      </form> : <>
        <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />Both accounts are mine. Keep them signed in on this browser for up to eight hours.</label>
        <button disabled={busy || !consent} className="rounded border p-2" onClick={() => void link()}>Link my accounts</button>
      </>}
    </section> : <a className="underline" href="/v2/login">Sign in to link or manage accounts</a>}
  </main>;
}
