"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function XeroSettingsTab() {
  const [status, setStatus] = useState<{ connected: boolean; tenantName?: string; lastSyncAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const tenantParam = searchParams.get("tenant");
  const errorParam = searchParams.get("error");

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const res = await fetch("/api/xero/status");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

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
          Xero connection failed: {errorParam}
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
              <li>Client invoices are pushed as DRAFT invoices (ACCREC)</li>
              <li>Cleaner bills are pushed as DRAFT bills (ACCPAY)</li>
              <li>GST tax types are set based on per-invoice GST toggle</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
