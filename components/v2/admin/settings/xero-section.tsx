"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { EAlert, EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EField, EInput, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

interface XeroInvoiceDefaults {
  defaultAccountCode: string;
  defaultItemCode: string;
  salesTaxType: string;
  contactFallbackEmail: string;
  itemCodeByService: Record<string, string>;
}

/** Job types mirrored from the Prisma enum (client component — no server import). */
const SERVICE_TYPES: Array<{ value: string; label: string }> = [
  { value: "AIRBNB_TURNOVER", label: "Airbnb turnover" },
  { value: "DEEP_CLEAN", label: "Deep clean" },
  { value: "END_OF_LEASE", label: "End of lease" },
  { value: "GENERAL_CLEAN", label: "General clean" },
  { value: "POST_CONSTRUCTION", label: "Post construction" },
  { value: "PRESSURE_WASH", label: "Pressure wash" },
  { value: "WINDOW_CLEAN", label: "Window clean" },
  { value: "LAWN_MOWING", label: "Lawn mowing" },
  { value: "SPECIAL_CLEAN", label: "Special clean" },
  { value: "COMMERCIAL_RECURRING", label: "Commercial recurring" },
];

const ERROR_HELP: Record<string, string> = {
  invalid_scope:
    "Xero rejected the requested scopes — usually because the app is a 'Custom Connection'. Create a Web app (Auth Code) in the Xero developer portal, set its redirect URI to this site's /api/xero/callback, and put its Client ID & Secret in Integrations.",
  access_denied: "Authorisation was cancelled or declined in Xero. Try connecting again and click Allow.",
  invalid_state: "The connection link expired or was opened in a different browser. Click Connect again and complete it in one go.",
  exchange_failed:
    "Xero accepted the login but the token exchange failed — usually a wrong Client ID/Secret or a mismatched redirect URI. Check the Integrations section and the Xero app's redirect URI.",
  missing_code: "Xero didn't return an authorisation code. Try connecting again.",
  unauthorized: "You need to be signed in as an admin to connect Xero.",
};

/**
 * Xero — connect status via /api/xero/status|connect|disconnect and invoice
 * defaults via GET/PATCH /api/admin/integrations/settings ({ xero: {...} }).
 */
export function XeroSection() {
  const [cfg, setCfg] = useState<XeroInvoiceDefaults>({
    defaultAccountCode: "",
    defaultItemCode: "",
    salesTaxType: "",
    contactFallbackEmail: "",
    itemCodeByService: {},
  });
  const [connection, setConnection] = useState<{ connected: boolean; tenantName?: string; lastSyncAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { status, flash } = useSaveStatus();

  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const tenantParam = searchParams.get("tenant");
  const errorParam = searchParams.get("error");
  const errorDescParam = searchParams.get("error_description");

  useEffect(() => {
    void loadStatus();
    void loadCfg();
  }, []);

  async function loadStatus() {
    try {
      const res = await fetch("/api/xero/status");
      if (res.ok) setConnection(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
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
        itemCodeByService:
          x.itemCodeByService && typeof x.itemCodeByService === "object" ? x.itemCodeByService : {},
      });
    } catch {
      /* ignore */
    }
  }

  async function saveCfg() {
    setSavingCfg(true);
    try {
      const res = await fetch("/api/admin/integrations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xero: cfg }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        flash("error", e.error ?? "Could not save invoice defaults.");
        return;
      }
      flash("saved", "Invoice defaults saved");
    } catch {
      flash("error", "Could not save invoice defaults.");
    } finally {
      setSavingCfg(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/xero/connect");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", data.error ?? "Failed to start the Xero connection.");
        return;
      }
      if (data.authUrl) window.open(data.authUrl, "_blank");
      else flash("error", "No auth URL returned from Xero.");
    } catch {
      flash("error", "Failed to connect to Xero.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Xero? This revokes the OAuth token.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/xero/disconnect", { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        flash("error", e.error ?? "Failed to disconnect.");
        return;
      }
      await loadStatus();
    } catch {
      flash("error", "Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  }

  const setField = (k: keyof Omit<XeroInvoiceDefaults, "itemCodeByService">, v: string) =>
    setCfg((prev) => ({ ...prev, [k]: v }));
  const setServiceCode = (jobType: string, v: string) =>
    setCfg((prev) => {
      const next = { ...prev.itemCodeByService };
      if (v.trim()) next[jobType] = v;
      else delete next[jobType];
      return { ...prev, itemCodeByService: next };
    });

  if (loading) {
    return (
      <p className="px-1 py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Checking the Xero connection…
      </p>
    );
  }

  const isConnected = connection?.connected ?? false;

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Accounting"
        title="Xero"
        description="Invoices and contacts flow to Xero as drafts — nothing is finalised without your review there."
      />

      {connectedParam === "true" ? (
        <EAlert tone="success" title={`Xero connected: ${tenantParam || "Unknown tenant"}`} />
      ) : null}
      {errorParam ? (
        <EAlert tone="danger" title={`Xero connection failed: ${errorParam.replace(/_/g, " ")}`}>
          {ERROR_HELP[errorParam] || errorDescParam}
        </EAlert>
      ) : null}

      {/* Connection card */}
      <ECard variant="ceremony" className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <EBadge tone={isConnected ? "success" : "neutral"} soft>
              {isConnected ? "Connected" : "Not connected"}
            </EBadge>
            {isConnected && connection?.tenantName ? (
              <span className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                Tenant · {connection.tenantName}
              </span>
            ) : null}
            {isConnected && connection?.lastSyncAt ? (
              <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Last sync {new Date(connection.lastSyncAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          {!isConnected ? (
            <EButton variant="gold" onClick={connect} disabled={connecting}>
              <Link2 className="h-4 w-4" /> {connecting ? "Connecting…" : "Connect to Xero"}
            </EButton>
          ) : (
            <EButton variant="outline" onClick={disconnect} disabled={disconnecting}>
              <Unlink className="h-4 w-4" /> {disconnecting ? "Disconnecting…" : "Disconnect"}
            </EButton>
          )}
        </div>
        <hr className="e-thread my-5" />
        <p className="text-[0.8125rem] font-medium">What gets synced</p>
        <ul className="mt-2 space-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <li>Client contacts are created or updated when invoices are pushed</li>
          <li>Cleaner contacts are created as suppliers</li>
          <li>Client invoices arrive as DRAFT invoices (ACCREC) with full line descriptions</li>
          <li>Cleaner bills arrive as DRAFT bills (ACCPAY)</li>
          <li>GST tax types follow your override or each invoice&apos;s GST toggle</li>
        </ul>
        <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          OAuth credentials (Client ID / Secret) live in the Integrations section.
        </p>
      </ECard>

      {/* Invoice defaults */}
      <ECard className="p-6">
        <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">Invoice defaults</h3>
        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Applied to every invoice pushed to Xero. The item code links each line to your Xero inventory item.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <EField label="Item code" htmlFor="xero-item" hint="Must match an Item Code in Xero (Business → Products & services). Blank for none.">
            <EInput
              id="xero-item"
              value={cfg.defaultItemCode}
              onChange={(e) => setField("defaultItemCode", e.target.value)}
              placeholder="e.g. CLEAN"
            />
          </EField>
          <EField label="Sales account code" htmlFor="xero-account" hint="Revenue account, e.g. 200 (Sales).">
            <EInput
              id="xero-account"
              value={cfg.defaultAccountCode}
              onChange={(e) => setField("defaultAccountCode", e.target.value)}
              placeholder="200"
            />
          </EField>
          <EField label="Sales tax type" htmlFor="xero-tax" hint="Xero tax type code, e.g. OUTPUT. Blank = auto from the GST toggle.">
            <EInput
              id="xero-tax"
              value={cfg.salesTaxType}
              onChange={(e) => setField("salesTaxType", e.target.value)}
              placeholder="OUTPUT"
            />
          </EField>
          <EField label="Contact fallback email" htmlFor="xero-fallback" hint="Used when a client has no email on file.">
            <EInput
              id="xero-fallback"
              type="email"
              value={cfg.contactFallbackEmail}
              onChange={(e) => setField("contactFallbackEmail", e.target.value)}
              placeholder="billing@yourbusiness.com.au"
            />
          </EField>
        </div>

        <div className="mt-6 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-5">
          <p className="text-[0.8125rem] font-medium">Per-service item codes</p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Optional overrides — a line uses its service&apos;s code if set, otherwise the default above.
          </p>
          <div className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {SERVICE_TYPES.map((svc) => (
              <div key={svc.value} className="flex items-center gap-3">
                <span className="w-40 flex-shrink-0 truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {svc.label}
                </span>
                <EInput
                  value={cfg.itemCodeByService[svc.value] ?? ""}
                  onChange={(e) => setServiceCode(svc.value, e.target.value)}
                  placeholder="item code"
                  className="h-8 text-[0.8125rem]"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <ESaveStatus status={status} />
          <EButton onClick={saveCfg} disabled={savingCfg}>
            {savingCfg ? "Saving…" : "Save invoice defaults"}
          </EButton>
        </div>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Anything else Xero lives in the{" "}
        <Link href="/admin/settings?tab=xero" className="text-[hsl(var(--e-gold-ink))] hover:underline">
          classic Xero tab
        </Link>
        .
      </p>
    </div>
  );
}
