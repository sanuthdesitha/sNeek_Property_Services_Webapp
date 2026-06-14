"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { RotateCcw, Smartphone, Monitor, Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/lib/settings";
import {
  EMAIL_TEMPLATE_DEFINITIONS,
  EMAIL_TEMPLATE_KEYS,
  getDefaultEmailTemplates,
  renderEmailTemplate,
  type AppEmailTemplateKey,
} from "@/lib/email-templates";
import {
  NOTIFICATION_TEMPLATE_DEFINITIONS,
  NOTIFICATION_TEMPLATE_KEYS,
  getDefaultNotificationTemplates,
  renderNotificationTemplate,
  type AppNotificationTemplateKey,
} from "@/lib/notification-templates";

/**
 * Wix / WordPress-style real-time template editor for BOTH email and SMS/web
 * notification templates. The left pane holds the editable fields (with
 * click-to-insert variable chips that drop a {token} at the cursor); the right
 * pane is a LIVE preview that updates as you type.
 *
 * - Email previews are rendered through the REAL luxury shell via
 *   `renderEmailTemplate` (which calls `wrapEmailHtml` internally), so what the
 *   admin sees is exactly what recipients receive.
 * - SMS previews are a phone-style bubble with live character + segment counts.
 *
 * This component is fully controlled: it never persists on its own. It mutates
 * the shared `settings` object via `onSettingsChange`, so the parent's single
 * Save button writes everything through the existing /api/admin/settings PATCH.
 */

interface TemplateEditorProps {
  settings: AppSettings;
  onSettingsChange: (updater: (prev: AppSettings) => AppSettings) => void;
  readOnly?: boolean;
}

type EditorTab = "email" | "sms";

/** Rich, realistic sample data so the preview reads like a real message. */
function buildSampleVariables(settings: AppSettings): Record<string, string> {
  return {
    companyName: settings.companyName,
    projectName: settings.projectName,
    logoUrl: settings.logoUrl,
    accountsEmail: settings.accountsEmail,
    supportEmail: settings.accountsEmail,
    timezone: settings.timezone,
    appUrl: "https://app.sneekproservices.com.au",
    portalUrl: "https://app.sneekproservices.com.au",
    loginUrl: "https://app.sneekproservices.com.au/login",
    adminUrl: "https://app.sneekproservices.com.au/admin",
    cleanerUrl: "https://app.sneekproservices.com.au/cleaner",
    clientUrl: "https://app.sneekproservices.com.au/client",
    laundryUrl: "https://app.sneekproservices.com.au/laundry",
    jobsUrl: "https://app.sneekproservices.com.au/admin/jobs",
    reportsUrl: "https://app.sneekproservices.com.au/admin/reports",
    settingsUrl: "https://app.sneekproservices.com.au/admin/settings",
    currentDate: "14 June 2026",
    currentTime: "10:15 AM",
    currentDateTime: "14 June 2026, 10:15 AM",
    currentDateIso: "2026-06-14",
    currentDateTimeIso: "2026-06-14T10:15:00.000Z",
    currentYear: "2026",
    actionUrl: "https://app.sneekproservices.com.au/action-required",
    actionLabel: "Open details",
    // Account
    userName: "Alex Morgan",
    email: "alex.morgan@example.com",
    code: "482915",
    expiryMinutes: "10",
    tempPassword: "TempPass!234",
    role: "Cleaner",
    welcomeNote: "We're glad to have you on the team.",
    createdVia: "invited account onboarding",
    createdAt: "14 Jun 2026, 10:15 AM",
    // Jobs
    jobType: "Airbnb Turnover",
    jobNumber: "SPS-1042",
    propertyName: "Harbour View Apartment",
    propertyAddress: "12/88 Bayview Road, Manly NSW 2095",
    when: "Fri, 19 Jun 2026 at 10:00 AM",
    timingFlags: "Early check-in due by 12:30 PM",
    changeSummary: "Start time: 10:00 -> 09:30",
    immediateAttention: "Immediate attention required. ",
    // Laundry
    cleanDate: "Tuesday, 16 June 2026",
    scheduledPickupDate: "Wednesday, 17 June 2026",
    scheduledDropoffDate: "Thursday, 18 June 2026",
    bagLocation: "Laundry bin",
    laundryPhotoUrl: "https://app.sneekproservices.com.au/laundry/photo/123",
    laundryOutcome: "No pickup required",
    reasonCode: "No linen used",
    reasonNote: " No guest linen was used for this clean.",
    decision: "Approved",
    // Reports
    clientName: "Jordan Property Group",
    recipientName: "Laundry Team",
    reportLabel: "Week 24 Summary",
    reportLink: "https://app.sneekproservices.com.au/reports/123",
    visibilityAudience: "Client",
    visibilityState: "Visible",
    visibilityNote: "Report approved for client viewing.",
    // Cases / pay
    cleanerName: "Chris Doyle",
    itemName: "Silver wristwatch",
    location: "Master bedroom drawer",
    notes: "Found during final inspection.",
    caseLink: "https://app.sneekproservices.com.au/admin/cases/123",
    caseTitle: "Lost & Found — wristwatch",
    caseType: "Lost & Found",
    status: "Open",
    priority: "High",
    updateNote: "Item logged and owner notified.",
    requestType: "HOURLY",
    requestedAmount: "$120.00",
    approvedAmount: "$120.00",
    cleanerNote: "Extra scope requested on arrival.",
    adminNote: "Outside agreed scope for this property.",
    title: "Extra bathroom deep clean",
    type: "manual",
    scope: "single job",
    // Shopping / stock
    runTitle: "Weekly restock run",
    submittedBy: "Taylor Reed",
    paidBy: "Cleaner",
    actualAmount: "$84.50",
    propertyNames: "Harbour View Apartment, Bay Retreat",
    requestedBy: "Taylor Reed",
    lineCount: "14",
    // Summaries
    dateLabel: "Wednesday, 17 June 2026",
    roleLabel: "Cleaner",
    jobCount: "4",
    taskCount: "3",
    attentionCount: "5",
    approvalCount: "2",
    pendingPayRequests: "1",
    pendingTimeAdjustments: "0",
    pendingContinuations: "0",
    pendingClientApprovals: "1",
    pendingLaundryRescheduleDraft: "0",
    unassignedJobCount: "2",
    openCaseCount: "3",
    overdueCaseCount: "1",
    highCaseCount: "1",
    newCaseCount: "2",
    flaggedLaundryCount: "1",
    propertyCount: "2",
    itemCount: "3",
    breakdownHtml:
      "<ul><li>Pay requests: 1</li><li>Client approvals: 1</li><li>Unassigned jobs: 2</li></ul>",
    breakdownText: "Pay requests 1; Client approvals 1; Unassigned jobs 2.",
    summaryHtml:
      "<ol><li><strong>P1 · SPS-1042 · Harbour View Apartment</strong><br/>Airbnb Turnover · 09:30-12:30<br/>Note: VIP arrival, top up coffee pods.</li></ol>",
    summaryText:
      "1) P1 SPS-1042 Harbour View Apartment 09:30-12:30. Note: VIP arrival, top up coffee pods.",
    inventoryHtml:
      "<ul><li><strong>Harbour View Apartment</strong><br/>Coffee Pods (0/4 box), Toilet Paper (1/8 roll)</li></ul>",
    inventoryText:
      "Harbour View Apartment: Coffee Pods (0/4 box), Toilet Paper (1/8 roll)",
    // Finance
    invoiceNumber: "INV-2026-0188",
    clientEmail: "accounts@jordanpropertygroup.com.au",
    totalAmount: "$1,240.00",
    periodLabel: "1–14 June 2026",
    periodStart: "1 June 2026",
    periodEnd: "14 June 2026",
    gstAmount: "$112.73",
    dueDate: "28 June 2026",
    paidAt: "14 Jun 2026, 2:30 PM",
    gatewayProvider: "Stripe",
    xeroInvoiceId: "9f1c-INV-188",
    payrollRunId: "PR-2026-24",
    cleanerCount: "6",
    grandTotal: "$4,820.00",
    completedAt: "14 Jun 2026, 5:00 PM",
    error: "Bank rejected the file",
    failedCount: "1",
    amount: "$680.00",
    method: "Bank transfer (ABA)",
    processedAt: "14 Jun 2026, 5:00 PM",
    failureReason: "Invalid BSB",
    payoutCount: "6",
    reviewedAt: "14 Jun 2026, 3:00 PM",
    paymentLink: "https://pay.sneekproservices.com.au/inv/188",
    refundAmount: "$120.00",
    refundedAt: "14 Jun 2026, 4:00 PM",
    tenantName: "sNeek Property Services Pty Ltd",
    connectedAt: "14 Jun 2026, 9:00 AM",
    disconnectedAt: "14 Jun 2026, 9:00 AM",
    contactName: "Jordan Property Group",
    contactType: "Client",
    xeroContactId: "c-188",
    xeroBillId: "b-204",
    serviceType: "Deep Clean",
    quoteTotal: "$540.00",
    validUntil: "28 June 2026",
    endpoint: "/api.xro/2.0/Invoices",
    timestamp: "14 Jun 2026, 9:00 AM",
    quoteUrl: "https://app.sneekproservices.com.au/quotes/123",
    approvalUrl: "https://app.sneekproservices.com.au/admin/approvals/123",
  };
}

/** Insert text at the current caret of a textarea/input, keeping focus. */
function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  token: string
): { next: string; caret: number } {
  if (!el) {
    return { next: `${current}${token}`, caret: current.length + token.length };
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  return { next, caret: start + token.length };
}

/**
 * GSM-7 vs UCS-2 SMS segmentation. Plain GSM messages are 160 chars
 * (153/segment when multipart); messages containing non-GSM characters fall
 * back to UCS-2 at 70 chars (67/segment).
 */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

function smsStats(text: string): { length: number; segments: number; encoding: "GSM-7" | "UCS-2" } {
  let isUnicode = false;
  let gsmUnits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (GSM_BASIC.indexOf(ch) !== -1) {
      gsmUnits += 1;
    } else if (GSM_EXTENDED.indexOf(ch) !== -1) {
      gsmUnits += 2; // extended chars take an escape + char
    } else {
      isUnicode = true;
      break;
    }
  }

  if (isUnicode) {
    const units = text.length;
    const single = 70;
    const multi = 67;
    const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
    return { length: units, segments, encoding: "UCS-2" };
  }

  const single = 160;
  const multi = 153;
  const segments = gsmUnits === 0 ? 0 : gsmUnits <= single ? 1 : Math.ceil(gsmUnits / multi);
  return { length: gsmUnits, segments, encoding: "GSM-7" };
}

/** Highlight {tokens} inside a plain-text field for the preview. */
function highlightTokens(text: string) {
  const parts = text.split(/(\{[a-zA-Z0-9_]+\})/g);
  return parts.map((part, index) =>
    /^\{[a-zA-Z0-9_]+\}$/.test(part) ? (
      <span key={index} className="rounded bg-primary/15 px-1 text-primary">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

function VariableChips({
  variables,
  onInsert,
  disabled,
}: {
  variables: string[];
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-input/70 bg-card p-3">
      {variables.map((variable) => (
        <button
          key={variable}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(`{${variable}}`)}
          className={cn(
            "rounded-md border border-primary/20 bg-primary/10 px-2 py-1 font-mono text-xs text-primary transition-colors",
            "hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          )}
          title={`Insert {${variable}} at cursor`}
        >
          {`{${variable}}`}
        </button>
      ))}
    </div>
  );
}

export function TemplateEditor({ settings, onSettingsChange, readOnly = false }: TemplateEditorProps) {
  const [tab, setTab] = useState<EditorTab>("email");

  // Email state
  const [emailKey, setEmailKey] = useState<AppEmailTemplateKey>("jobAssigned");
  const [emailPreviewMode, setEmailPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEmailFieldRef = useRef<"subject" | "html">("html");

  // SMS / notification state
  const [smsKey, setSmsKey] = useState<AppNotificationTemplateKey>("jobAssigned");
  const webTitleRef = useRef<HTMLInputElement | null>(null);
  const webBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const smsBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSmsFieldRef = useRef<"webSubject" | "webBody" | "smsBody">("smsBody");

  const sampleVariables = useMemo(() => buildSampleVariables(settings), [settings]);

  // ── Email ──────────────────────────────────────────────────────────────
  const emailTemplate = settings.emailTemplates[emailKey];
  const emailDefinition = EMAIL_TEMPLATE_DEFINITIONS[emailKey];

  const setEmailField = useCallback(
    (field: "subject" | "html", value: string) => {
      onSettingsChange((prev) => ({
        ...prev,
        emailTemplates: {
          ...prev.emailTemplates,
          [emailKey]: { ...prev.emailTemplates[emailKey], [field]: value },
        },
      }));
    },
    [emailKey, onSettingsChange]
  );

  const insertEmailToken = useCallback(
    (token: string) => {
      if (readOnly) return;
      const field = lastEmailFieldRef.current;
      const el = field === "subject" ? subjectRef.current : bodyRef.current;
      const current = field === "subject" ? emailTemplate.subject : emailTemplate.html;
      const { next, caret } = insertAtCursor(el, current, token);
      setEmailField(field, next);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      });
    },
    [emailTemplate.subject, emailTemplate.html, readOnly, setEmailField]
  );

  const resetEmailTemplate = useCallback(() => {
    if (readOnly) return;
    const fresh = getDefaultEmailTemplates()[emailKey];
    onSettingsChange((prev) => ({
      ...prev,
      emailTemplates: { ...prev.emailTemplates, [emailKey]: { ...fresh } },
    }));
    toast({
      title: "Template reset",
      description: `${emailDefinition.label} restored to the shipped default. Save to apply.`,
    });
  }, [emailKey, emailDefinition.label, onSettingsChange, readOnly]);

  const emailPreview = useMemo(
    () =>
      renderEmailTemplate(
        {
          companyName: settings.companyName,
          projectName: settings.projectName,
          logoUrl: settings.logoUrl,
          accountsEmail: settings.accountsEmail,
          timezone: settings.timezone,
          emailTemplates: settings.emailTemplates,
        },
        emailKey,
        sampleVariables
      ),
    [
      emailKey,
      sampleVariables,
      settings.accountsEmail,
      settings.companyName,
      settings.emailTemplates,
      settings.logoUrl,
      settings.projectName,
      settings.timezone,
    ]
  );

  // ── SMS / Notification ─────────────────────────────────────────────────
  const smsTemplate = settings.notificationTemplates[smsKey];
  const smsDefinition = NOTIFICATION_TEMPLATE_DEFINITIONS[smsKey];

  const setSmsField = useCallback(
    (field: "webSubject" | "webBody" | "smsBody", value: string) => {
      onSettingsChange((prev) => ({
        ...prev,
        notificationTemplates: {
          ...prev.notificationTemplates,
          [smsKey]: { ...prev.notificationTemplates[smsKey], [field]: value },
        },
      }));
    },
    [smsKey, onSettingsChange]
  );

  const insertSmsToken = useCallback(
    (token: string) => {
      if (readOnly) return;
      const field = lastSmsFieldRef.current;
      const el =
        field === "webSubject"
          ? webTitleRef.current
          : field === "webBody"
            ? webBodyRef.current
            : smsBodyRef.current;
      const current = smsTemplate[field];
      const { next, caret } = insertAtCursor(el, current, token);
      setSmsField(field, next);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      });
    },
    [readOnly, setSmsField, smsTemplate]
  );

  const resetSmsTemplate = useCallback(() => {
    if (readOnly) return;
    const fresh = getDefaultNotificationTemplates()[smsKey];
    onSettingsChange((prev) => ({
      ...prev,
      notificationTemplates: { ...prev.notificationTemplates, [smsKey]: { ...fresh } },
    }));
    toast({
      title: "Template reset",
      description: `${smsDefinition.label} restored to the shipped default. Save to apply.`,
    });
  }, [onSettingsChange, readOnly, smsDefinition.label, smsKey]);

  const smsPreview = useMemo(
    () =>
      renderNotificationTemplate(
        {
          companyName: settings.companyName,
          projectName: settings.projectName,
          accountsEmail: settings.accountsEmail,
          timezone: settings.timezone,
          notificationTemplates: settings.notificationTemplates,
        },
        smsKey,
        sampleVariables
      ),
    [
      sampleVariables,
      settings.accountsEmail,
      settings.companyName,
      settings.notificationTemplates,
      settings.projectName,
      settings.timezone,
      smsKey,
    ]
  );

  const liveSmsStats = useMemo(() => smsStats(smsTemplate.smsBody), [smsTemplate.smsBody]);
  const renderedSmsStats = useMemo(() => smsStats(smsPreview.smsBody), [smsPreview.smsBody]);

  const previewFrameStyle: CSSProperties = {
    width: emailPreviewMode === "mobile" ? "390px" : "100%",
    maxWidth: "100%",
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Message templates</p>
        <p className="text-xs text-muted-foreground">
          A real-time editor with live preview. Click a variable to drop it at your cursor; the
          preview fills in sample data so it reads exactly like a real message. Email previews use
          the real branded email shell, so what you see is what recipients receive.
        </p>
      </div>

      {/* Tab switch */}
      <div className="inline-flex rounded-lg border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setTab("email")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "email" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Mail className="h-4 w-4" /> Email
        </button>
        <button
          type="button"
          onClick={() => setTab("sms")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "sms" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="h-4 w-4" /> SMS & web
        </button>
      </div>

      {/* ── EMAIL EDITOR ─────────────────────────────────────────────── */}
      {tab === "email" ? (
        <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Left: editable fields */}
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>Template</Label>
                <Select
                  value={emailKey}
                  onValueChange={(value: AppEmailTemplateKey) => setEmailKey(value)}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_TEMPLATE_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {EMAIL_TEMPLATE_DEFINITIONS[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetEmailTemplate}
                disabled={readOnly}
                title="Restore the shipped default for this template"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                ref={subjectRef}
                value={emailTemplate.subject}
                onFocus={() => (lastEmailFieldRef.current = "subject")}
                onChange={(e) => setEmailField("subject", e.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Insert variable</Label>
              <VariableChips
                variables={emailDefinition.variables}
                onInsert={insertEmailToken}
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                Click a token to insert it into the last field you edited (subject or body). Common
                variables like <code>{"{loginUrl}"}</code> and <code>{"{currentDateTime}"}</code> work in
                every template.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Body</Label>
              <Textarea
                ref={bodyRef}
                value={emailTemplate.html}
                onFocus={() => (lastEmailFieldRef.current = "html")}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEmailField("html", e.target.value)}
                disabled={readOnly}
                rows={14}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                The luxury branded shell (header, logo, footer) wraps your content automatically. You
                can use simple HTML such as <code>&lt;p&gt;</code>, <code>&lt;strong&gt;</code>, and{" "}
                <code>&lt;h2&gt;</code>.
              </p>
            </div>
          </div>

          {/* Right: live preview through the REAL shell */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Live preview</p>
              <div className="inline-flex rounded-md border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setEmailPreviewMode("desktop")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                    emailPreviewMode === "desktop" ? "bg-muted font-medium" : "text-muted-foreground"
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setEmailPreviewMode("mobile")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                    emailPreviewMode === "mobile" ? "bg-muted font-medium" : "text-muted-foreground"
                  )}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Mobile
                </button>
              </div>
            </div>
            <div className="rounded-md border bg-background p-2">
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Subject:</span> {emailPreview.subject}
              </p>
            </div>
            <div className="overflow-hidden rounded-md border bg-white">
              <div className="mx-auto" style={previewFrameStyle}>
                <iframe
                  title={`Email preview ${emailKey}`}
                  srcDoc={emailPreview.html}
                  className="h-[560px] w-full"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── SMS / WEB EDITOR ─────────────────────────────────────────── */}
      {tab === "sms" ? (
        <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          {/* Left: editable fields */}
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label>Template</Label>
                <Select
                  value={smsKey}
                  onValueChange={(value: AppNotificationTemplateKey) => setSmsKey(value)}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTIFICATION_TEMPLATE_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {NOTIFICATION_TEMPLATE_DEFINITIONS[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetSmsTemplate}
                disabled={readOnly}
                title="Restore the shipped default for this template"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>Insert variable</Label>
              <VariableChips
                variables={smsDefinition.variables}
                onInsert={insertSmsToken}
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                Click a token to insert it into the last field you edited. Keep SMS plain text — no
                HTML.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Web notification title</Label>
              <Input
                ref={webTitleRef}
                value={smsTemplate.webSubject}
                onFocus={() => (lastSmsFieldRef.current = "webSubject")}
                onChange={(e) => setSmsField("webSubject", e.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Web notification message</Label>
              <Textarea
                ref={webBodyRef}
                value={smsTemplate.webBody}
                onFocus={() => (lastSmsFieldRef.current = "webBody")}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSmsField("webBody", e.target.value)}
                disabled={readOnly}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>SMS message</Label>
                <span
                  className={cn(
                    "font-mono text-xs",
                    liveSmsStats.segments > 1 ? "text-amber-600" : "text-muted-foreground"
                  )}
                >
                  {liveSmsStats.length} chars · {liveSmsStats.segments} segment
                  {liveSmsStats.segments === 1 ? "" : "s"} · {liveSmsStats.encoding}
                </span>
              </div>
              <Textarea
                ref={smsBodyRef}
                value={smsTemplate.smsBody}
                onFocus={() => (lastSmsFieldRef.current = "smsBody")}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSmsField("smsBody", e.target.value)}
                disabled={readOnly}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Single SMS is {liveSmsStats.encoding === "UCS-2" ? "70" : "160"} characters; longer
                messages split into {liveSmsStats.encoding === "UCS-2" ? "67" : "153"}-character
                segments (each segment is billed separately). The counts above use the raw template;
                actual sends fill in variables, shown in the preview.
              </p>
            </div>
          </div>

          {/* Right: live previews */}
          <div className="space-y-3">
            {/* Phone bubble */}
            <div className="rounded-2xl border bg-muted/40 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                SMS preview
              </p>
              <div className="mx-auto max-w-[300px] rounded-[1.75rem] border-4 border-foreground/80 bg-background p-3 shadow-inner">
                <div className="mb-2 text-center text-[10px] font-medium text-muted-foreground">
                  {settings.companyName || "Messages"}
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-snug text-foreground shadow-sm">
                    {smsPreview.smsBody || (
                      <span className="text-muted-foreground">Your SMS appears here…</span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 pl-1 text-[10px] text-muted-foreground">
                  {renderedSmsStats.length} chars · {renderedSmsStats.segments} segment
                  {renderedSmsStats.segments === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {/* Web/push card */}
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Web / push preview
              </p>
              <div className="rounded-lg border bg-background p-3 shadow-sm">
                <p className="text-sm font-semibold leading-snug">{smsPreview.webSubject}</p>
                <p className="mt-1 text-sm text-muted-foreground">{smsPreview.webBody}</p>
              </div>
            </div>

            {/* Raw template w/ token highlight */}
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                SMS template (tokens highlighted)
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-snug">
                {smsTemplate.smsBody ? highlightTokens(smsTemplate.smsBody) : (
                  <span className="text-muted-foreground">No SMS body set.</span>
                )}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
