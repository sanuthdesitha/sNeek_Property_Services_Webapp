"use client";

/**
 * Estate client actions for the property profile page — preferred cleaner
 * selection and report PDF download. Same endpoints as the v1 components
 * (PreferredCleanerCard / ClientReportDownloadButton), new Estate UI.
 */
import { useState } from "react";
import { Download, Loader2, Save } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { ESelect, EInlineNotice } from "@/components/v2/client/fields";

type CleanerOption = { id: string; name: string | null; email: string };

export function EPreferredCleanerCard({
  propertyId,
  currentCleanerId,
  options,
}: {
  propertyId: string;
  currentCleanerId?: string | null;
  options: CleanerOption[];
}) {
  const [selectedId, setSelectedId] = useState(currentCleanerId ?? "none");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function savePreference() {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/client/properties/${propertyId}/preferred-cleaner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredCleanerUserId: selectedId === "none" ? null : selectedId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save preferred cleaner.");
      setNotice({
        tone: "success",
        text: body.preferredCleanerName
          ? `${body.preferredCleanerName} will be prioritised when available.`
          : "No preferred cleaner is set for this property.",
      });
    } catch (error: any) {
      setNotice({ tone: "danger", text: error?.message ?? "Could not save preferred cleaner." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Preferred cleaner</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Choose a cleaner who has already worked at this home so new services are prioritised to
          them when available.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-3">
        <ESelect value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="none">No preferred cleaner</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name?.trim() || option.email}
            </option>
          ))}
        </ESelect>
        <div className="flex items-center justify-between gap-3">
          {notice ? <EInlineNotice tone={notice.tone}>{notice.text}</EInlineNotice> : <span />}
          <EButton size="sm" onClick={() => void savePreference()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save preference
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}

export function EReportDownloadButton({ jobId, label = "Download PDF" }: { jobId: string; label?: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${jobId}/download`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unable to prepare the PDF report right now.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `job-report-${jobId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-1">
      <EButton variant="outline" size="sm" onClick={() => void download()} disabled={downloading}>
        <Download className="h-3.5 w-3.5" />
        {downloading ? "Preparing PDF…" : label}
      </EButton>
      {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
    </div>
  );
}
