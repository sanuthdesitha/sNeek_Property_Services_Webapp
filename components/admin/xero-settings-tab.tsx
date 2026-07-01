"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JobType } from "@prisma/client";
import { jobTypeLabel } from "@/lib/qa/templates";

const JOB_TYPES = Object.values(JobType) as JobType[];

interface XeroInvoiceDefaults {
  defaultAccountCode: string;
  defaultItemCode: string;
  salesTaxType: string;
  contactFallbackEmail: string;
  itemCodeByService: Record<string, string>;
}

export function XeroSettingsTab() {
  const [cfg, setCfg] = useState<XeroInvoiceDefaults>({
    defaultAccountCode: "",
    defaultItemCode: "",
    salesTaxType: "",
    contactFallbackEmail: "",
    itemCodeByService: {},
  });
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgSaved, setCfgSaved] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean; tenantName?: string; lastSyncAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const tenantParam = searchParams.get("tenant");
  const errorParam = searchParams.get("error");
  const errorDescParam = searchParams.get("error_description");

  // Friendly, actionable explanations for the common OAuth failures.
  const errorHelp: Record<string, string> = {
    invalid_scope:
      "Xero rejected the requested scopes — almost always because this app is a 'Custom Connection' (machine-to-machine), which can't use the Connect flow. In the Xero developer portal (developer.xero.com/app/manage) create a Web app (Auth Code) instead: set the redirect URI to this site's /api/xero/callback, copy its Client ID & Secret into Settings → Integrations, then reconnect. (A Custom Connection is only for the Xero MCP server, not this button.)",
    access_denied: "Authorisation was cancelled or declined in Xero. Try connecting again and click Allow.",
    invalid_state: "The connection link expired or was opened in a different browser. Click Connect again and complete it in one go.",
    exchange_failed:
      "Xero accepted the login but the token exchange failed — usually a wrong Client ID/Secret or a redirect URI that doesn't exactly match the one set on the Xero app. Check Settings → Integrations and the Xero app's redirect URI.",
    missing_code: "Xero didn't return an authorisation code. Try connecting again.",
    unauthorized: "You need to be signed in as an admin to connect Xero.",
  };

  useEffect(() => { loadStatus(); loadCfg(); }, []);

  async function loadStatus() {
    try {
      const res = await fetch("/api/xero/status");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function loadCfg() {
    try {
      const res = await fetch("/api/admin/integrations/settings");
      if (!res.ok) return;
      const data = await res.json();
      const x = data?.xero ?? {};
      setCfg({
        defaultAccountCode: x.defaultAccountCode ?? "",
        defaultItemCode: x.defaultItemCode ?? "",
        salesTaxType: x.salesTaxType ?? "",
        contactFallbackEmail: x.contactFallbackEmail ?? "",
        itemCodeByService: x.itemCodeByService && typeof x.itemCodeByService === "object" ? x.itemCodeByService : {},
      });
    } catch { /* ignore */ }
  }

  async function saveCfg() {
    setSavingCfg(true);
    setCfgSaved(false);
    try {
      const res = await fetch("/api/admin/integrations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xero: cfg }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error ?? "Could not save"); return; }
      setCfgSaved(true);
      setTimeout(() => setCfgSaved(false), 2500);
    } catch { alert("Could not save Xero invoice defaults"); }
    finally { setSavingCfg(false); }
  }

  const setField = (k: "defaultAccountCode" | "defaultItemCode" | "salesTaxType" | "contactFallbackEmail", v: string) =>
    setCfg((prev) => ({ ...prev, [k]: v }));
  const setServiceCode = (jobType: string, v: string) =>
    setCfg((prev) => {
      const next = { ...prev.itemCodeByService };
      if (v.trim()) next[jobType] = v;
      else delete next[jobType];
      return { ...prev, itemCodeByService: next };
    });

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/xero/connect");
      if (!res.ok) { const e = await res.json(); alert(e.error); return; }
      const data = await res.json();
      if (data.authUrl) {
        window.open(data.authUrl, "_blank");
      } else {
        alert("No auth URL returned from Xero. Check server logs.");
      }
    } catch { alert("Failed to connect to Xero"); }
    finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Xero? This will revoke the OAuth token.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/xero/disconnect", { method: "POST" });
      if (!res.ok) { const e = await res.json(); alert(e.error); return; }
      await loadStatus();
    } catch { alert("Failed to disconnect"); }
    finally { setDisconnecting(false); }
  }

  if (loading) return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading Xero status...</div>;

  const isConnected = status?.connected ?? false;

  return (
    <div className="space-y-6">
      {connectedParam === "true" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Xero connected successfully: {tenantParam || "Unknown tenant"}
        </div>
      )}
      {errorParam && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Xero connection failed: {errorParam.replace(/_/g, " ")}</p>
          {(errorHelp[errorParam] || errorDescParam) && (
            <p className="mt-1 text-red-600">{errorHelp[errorParam] || errorDescParam}</p>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Xero Accounting</CardTitle>
          <CardDescription>
            Connect your Xero account to sync invoices and contacts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant={isConnected ? "success" : "secondary"} className="text-sm">
              {isConnected ? "Connected" : "Not connected"}
            </Badge>
            {isConnected && status?.tenantName && (
              <span className="text-sm text-muted-foreground">Tenant: {status.tenantName}</span>
            )}
            {isConnected && status?.lastSyncAt && (
              <span className="text-xs text-muted-foreground">
                Last sync: {new Date(status.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {!isConnected ? (
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? "Connecting..." : "Connect to Xero"}
              </Button>
            ) : (
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </Button>
            )}
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">What gets synced:</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Client contacts are created/updated in Xero when invoices are pushed</li>
              <li>Cleaner contacts are created as suppliers in Xero</li>
              <li>Client invoices are pushed as DRAFT invoices (ACCREC) with full line
                  descriptions (service · property · date · note) and your item code</li>
              <li>Cleaner bills are pushed as DRAFT bills (ACCPAY)</li>
              <li>GST tax types are set from your override or the per-invoice GST toggle</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice defaults</CardTitle>
          <CardDescription>
            Applied to every invoice pushed to Xero. The item code links each line to your
            Xero inventory item so it lands under the right account &amp; description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="xero-item">Item code (Xero item number)</Label>
              <Input
                id="xero-item"
                value={cfg.defaultItemCode}
                onChange={(e) => setField("defaultItemCode", e.target.value)}
                placeholder="e.g. CLEAN"
              />
              <p className="text-xs text-muted-foreground">
                Must match an Item Code in Xero (Business → Products &amp; services). Leave blank for none.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xero-account">Sales account code</Label>
              <Input
                id="xero-account"
                value={cfg.defaultAccountCode}
                onChange={(e) => setField("defaultAccountCode", e.target.value)}
                placeholder="200"
              />
              <p className="text-xs text-muted-foreground">Revenue account, e.g. 200 (Sales).</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xero-tax">Sales tax type (optional)</Label>
              <Input
                id="xero-tax"
                value={cfg.salesTaxType}
                onChange={(e) => setField("salesTaxType", e.target.value)}
                placeholder="OUTPUT (blank = auto from GST toggle)"
              />
              <p className="text-xs text-muted-foreground">
                Xero tax type code, e.g. OUTPUT or OUTPUT2 (AU GST on Income).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="xero-fallback">Contact fallback email</Label>
              <Input
                id="xero-fallback"
                type="email"
                value={cfg.contactFallbackEmail}
                onChange={(e) => setField("contactFallbackEmail", e.target.value)}
                placeholder="billing@yourbusiness.com.au"
              />
              <p className="text-xs text-muted-foreground">Used when a client has no email on file.</p>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Per-service item codes (optional)</p>
              <p className="text-xs text-muted-foreground">
                Map a Xero item code to each service type. A line uses its service&apos;s code if set,
                otherwise the default item code above. Leave a row blank to use the default.
              </p>
            </div>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {JOB_TYPES.map((jt) => (
                <div key={jt} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-sm text-muted-foreground" title={jobTypeLabel(jt)}>
                    {jobTypeLabel(jt)}
                  </span>
                  <Input
                    value={cfg.itemCodeByService[jt] ?? ""}
                    onChange={(e) => setServiceCode(jt, e.target.value)}
                    placeholder="item code"
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={saveCfg} disabled={savingCfg}>
              {savingCfg ? "Saving…" : "Save invoice defaults"}
            </Button>
            {cfgSaved && <span className="text-sm text-green-600">Saved</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
