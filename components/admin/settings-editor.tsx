"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { JobType, Role } from "@prisma/client";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { AppSettings } from "@/lib/settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EMAIL_TEMPLATE_DEFINITIONS,
  EMAIL_TEMPLATE_KEYS,
  renderEmailTemplate,
  type AppEmailTemplateKey,
} from "@/lib/email-templates";
import {
  NOTIFICATION_TEMPLATE_DEFINITIONS,
  NOTIFICATION_TEMPLATE_KEYS,
  renderNotificationTemplate,
  type AppNotificationTemplateKey,
} from "@/lib/notification-templates";

interface SettingsEditorProps {
  initialSettings: AppSettings;
  cleanerOptions: Array<{
    id: string;
    name: string | null;
    email: string;
  }>;
  readOnly?: boolean;
}

const SETTINGS_RESTORED_EVENT = "sneek:settings-restored";

const ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.CLIENT, Role.LAUNDRY];
const JOB_TYPES: JobType[] = [
  JobType.AIRBNB_TURNOVER,
  JobType.DEEP_CLEAN,
  JobType.END_OF_LEASE,
  JobType.GENERAL_CLEAN,
  JobType.POST_CONSTRUCTION,
  JobType.PRESSURE_WASH,
  JobType.WINDOW_CLEAN,
  JobType.LAWN_MOWING,
  JobType.SPECIAL_CLEAN,
  JobType.COMMERCIAL_RECURRING,
];

function cleanerLabel(cleaner: { id: string; name: string | null; email: string }) {
  if (cleaner.name?.trim()) return `${cleaner.name} (${cleaner.email})`;
  return cleaner.email;
}

function normalizeOptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function dedupeOptionList(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = normalizeOptionLabel(rawValue);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

type EmailBlockType = "heading" | "paragraph" | "button" | "divider" | "html";

interface EmailBuilderBlock {
  id: string;
  type: EmailBlockType;
  text: string;
  url?: string;
}

interface EmailSnippetDefinition {
  id: string;
  label: string;
  description: string;
  blocks: Array<Omit<EmailBuilderBlock, "id">>;
}

const BUILDER_META_PREFIX = "<!--SNEEK_EMAIL_BUILDER:";

function createBlockId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encodeBuilderBlocks(blocks: EmailBuilderBlock[]) {
  try {
    if (typeof window === "undefined") return "";
    const json = JSON.stringify(blocks);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  } catch {
    return "";
  }
}

function decodeBuilderBlocks(value: string) {
  try {
    if (typeof window === "undefined") return null;
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const blocks: EmailBuilderBlock[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const type = (row as any).type as EmailBlockType;
      if (!["heading", "paragraph", "button", "divider"].includes(type)) continue;
      blocks.push({
        id: typeof (row as any).id === "string" && (row as any).id ? (row as any).id : createBlockId(),
        type,
        text: typeof (row as any).text === "string" ? (row as any).text : "",
        url: typeof (row as any).url === "string" ? (row as any).url : undefined,
      });
    }
    return blocks.length > 0 ? blocks : null;
  } catch {
    return null;
  }
}

function tryParseBuilderBlocks(html: string) {
  const match = html.match(/<!--SNEEK_EMAIL_BUILDER:([A-Za-z0-9+/=]+)-->/);
  if (!match?.[1]) return null;
  return decodeBuilderBlocks(match[1]);
}

function stripBuilderMetadata(html: string) {
  return html.replace(/<!--SNEEK_EMAIL_BUILDER:[A-Za-z0-9+/=]+-->/g, "").trim();
}

function escapeEmailBlockText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeEmailBlockAttribute(value: string) {
  return escapeEmailBlockText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeEmailParagraphText(value: string) {
  return escapeEmailBlockText(value).replace(/\r?\n/g, "<br />");
}

function hasUnsupportedHtmlFeatures(element: HTMLElement) {
  return Boolean(
    element.querySelector(
      "img, table, tbody, thead, tr, td, th, ul, ol, li, blockquote, pre, code, iframe, video, audio, svg"
    )
  );
}

function isStandaloneButtonElement(element: HTMLElement) {
  if (element.tagName === "A") return true;
  if (!["P", "DIV", "SECTION", "ARTICLE"].includes(element.tagName)) return false;
  if (element.children.length !== 1) return false;
  const onlyChild = element.children[0];
  return onlyChild?.tagName === "A" && element.textContent?.trim() === onlyChild.textContent?.trim();
}

function elementToBuilderBlocks(element: HTMLElement): EmailBuilderBlock[] {
  if (element.tagName === "HR") {
    return [{ id: createBlockId(), type: "divider", text: "" }];
  }

  if (/^H[1-6]$/.test(element.tagName)) {
    return [{ id: createBlockId(), type: "heading", text: element.textContent?.trim() || "Heading" }];
  }

  if (isStandaloneButtonElement(element)) {
    const anchor = element.tagName === "A" ? element : (element.querySelector("a") as HTMLAnchorElement | null);
    return [
      {
        id: createBlockId(),
        type: "button",
        text: anchor?.textContent?.trim() || "Take action",
        url: anchor?.getAttribute("href") || "{actionUrl}",
      },
    ];
  }

  if (["P", "DIV", "SECTION", "ARTICLE"].includes(element.tagName)) {
    if (hasUnsupportedHtmlFeatures(element)) {
      return [{ id: createBlockId(), type: "html", text: element.outerHTML.trim() }];
    }

    const inlineMarkup = element.innerHTML
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, "");
    const textOnly = (element.textContent || "").replace(/\s+/g, "");

    if (inlineMarkup && inlineMarkup !== textOnly) {
      return [{ id: createBlockId(), type: "html", text: element.outerHTML.trim() }];
    }

    const paragraphText = element.innerHTML
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();

    if (!paragraphText) return [];
    return [{ id: createBlockId(), type: "paragraph", text: paragraphText }];
  }

  return [{ id: createBlockId(), type: "html", text: element.outerHTML.trim() }];
}

function htmlToBuilderBlocks(html: string): EmailBuilderBlock[] | null {
  if (typeof window === "undefined") return null;
  const cleaned = stripBuilderMetadata(html);
  if (!cleaned) return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleaned, "text/html");
    const blocks: EmailBuilderBlock[] = [];

    for (const node of Array.from(doc.body.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) {
          blocks.push({ id: createBlockId(), type: "paragraph", text });
        }
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      blocks.push(...elementToBuilderBlocks(node as HTMLElement));
    }

    return blocks.length > 0 ? blocks : [{ id: createBlockId(), type: "html", text: cleaned }];
  } catch {
    return [{ id: createBlockId(), type: "html", text: cleaned }];
  }
}

function blocksToHtml(blocks: EmailBuilderBlock[]) {
  const htmlParts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      htmlParts.push(`<h2>${escapeEmailBlockText(block.text || "Heading")}</h2>`);
      continue;
    }
    if (block.type === "paragraph") {
      htmlParts.push(`<p>${escapeEmailParagraphText(block.text || "Add paragraph text here.")}</p>`);
      continue;
    }
    if (block.type === "button") {
      const text = block.text?.trim() || "{actionLabel}";
      const url = block.url?.trim() || "{actionUrl}";
      htmlParts.push(
        `<p><a href="${escapeEmailBlockAttribute(url)}">${escapeEmailBlockText(text)}</a></p>`
      );
      continue;
    }
    if (block.type === "divider") {
      htmlParts.push("<hr />");
      continue;
    }
    if (block.type === "html") {
      const rawHtml = block.text?.trim();
      if (rawHtml) {
        htmlParts.push(rawHtml);
      }
    }
  }

  const encoded = encodeBuilderBlocks(blocks);
  const metadata = encoded ? `\n${BUILDER_META_PREFIX}${encoded}-->` : "";
  return `${htmlParts.join("\n").trim()}${metadata}`.trim();
}

function defaultBuilderBlocks(templateLabel: string): EmailBuilderBlock[] {
  return [
    { id: createBlockId(), type: "heading", text: templateLabel },
    { id: createBlockId(), type: "paragraph", text: "Add your email message here. You can use variables like {userName}." },
    { id: createBlockId(), type: "button", text: "Take action", url: "{actionUrl}" },
  ];
}

const EMAIL_TEMPLATE_SNIPPETS: EmailSnippetDefinition[] = [
  {
    id: "otp",
    label: "OTP Verification",
    description: "One-time code email with expiry and sign-in action.",
    blocks: [
      { type: "heading", text: "Verify your email" },
      { type: "paragraph", text: "Use this one-time code to verify your account: {code}" },
      { type: "paragraph", text: "This code expires in {expiryMinutes} minutes." },
      { type: "button", text: "Complete verification", url: "{actionUrl}" },
    ],
  },
  {
    id: "approval",
    label: "Approval Request",
    description: "Admin approval request with amount and note context.",
    blocks: [
      { type: "heading", text: "Approval required" },
      { type: "paragraph", text: "{cleanerName} submitted a {requestType} request for {propertyName}." },
      { type: "paragraph", text: "Requested amount: {requestedAmount}. Note: {cleanerNote}" },
      { type: "button", text: "Review request", url: "{actionUrl}" },
    ],
  },
  {
    id: "alert",
    label: "Alert / Case",
    description: "Operational alert with direct case link.",
    blocks: [
      { type: "heading", text: "Action needed now" },
      { type: "paragraph", text: "A new issue was raised at {propertyName}." },
      { type: "paragraph", text: "Details: {itemName} at {location}. {notes}" },
      { type: "button", text: "Open case", url: "{actionUrl}" },
    ],
  },
  {
    id: "invoice",
    label: "Invoice Summary",
    description: "Invoice notice with summary and quick action.",
    blocks: [
      { type: "heading", text: "Invoice ready" },
      { type: "paragraph", text: "Invoice for {cleanerName} is ready with {jobCount} jobs included." },
      { type: "paragraph", text: "For accounts processing contact: {accountsEmail}" },
      { type: "button", text: "Open invoice", url: "{actionUrl}" },
    ],
  },
  {
    id: "report",
    label: "Report Share",
    description: "Client-ready cleaning/laundry report notification.",
    blocks: [
      { type: "heading", text: "Your report is ready" },
      { type: "paragraph", text: "Hello {clientName}, your report for {propertyName} is now available." },
      { type: "button", text: "View report", url: "{actionUrl}" },
    ],
  },
];

function instantiateSnippetBlocks(snippet: EmailSnippetDefinition): EmailBuilderBlock[] {
  return snippet.blocks.map((block) => ({
    id: createBlockId(),
    type: block.type,
    text: block.text,
    url: block.url,
  }));
}

export function SettingsEditor({ initialSettings, cleanerOptions, readOnly = false }: SettingsEditorProps) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [newBagLocation, setNewBagLocation] = useState("");
  const [newDropoffLocation, setNewDropoffLocation] = useState("");
  const [selectedCleanerToAdd, setSelectedCleanerToAdd] = useState("");
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState<AppEmailTemplateKey>("signupOtp");
  const [selectedNotificationTemplate, setSelectedNotificationTemplate] =
    useState<AppNotificationTemplateKey>("newProfileCreated");
  const [selectedEmailSnippetId, setSelectedEmailSnippetId] = useState<string>(EMAIL_TEMPLATE_SNIPPETS[0].id);
  const [builderEnabledByTemplate, setBuilderEnabledByTemplate] = useState<Record<AppEmailTemplateKey, boolean>>(
    () => Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((key) => [key, false])) as Record<AppEmailTemplateKey, boolean>
  );
  const [emailBlocksByTemplate, setEmailBlocksByTemplate] = useState<Record<AppEmailTemplateKey, EmailBuilderBlock[]>>(
    () =>
      Object.fromEntries(
        EMAIL_TEMPLATE_KEYS.map((key) => [
          key,
          defaultBuilderBlocks(EMAIL_TEMPLATE_DEFINITIONS[key].label),
        ])
      ) as Record<AppEmailTemplateKey, EmailBuilderBlock[]>
  );
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [emailPreviewMode, setEmailPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [selectedRateCleanerId, setSelectedRateCleanerId] = useState(
    cleanerOptions[0]?.id ?? ""
  );

  const cleanerById = useMemo(
    () => new Map(cleanerOptions.map((cleaner) => [cleaner.id, cleaner] as const)),
    [cleanerOptions]
  );
  const availableCleaners = useMemo(
    () =>
      cleanerOptions.filter(
        (cleaner) => !settings.selectAllAllowedCleanerIds.includes(cleaner.id)
      ),
    [cleanerOptions, settings.selectAllAllowedCleanerIds]
  );

  function hydrateFromSnapshot(nextSettings: AppSettings) {
    setSettings(nextSettings);
    const nextBlocks = Object.fromEntries(
      EMAIL_TEMPLATE_KEYS.map((key) => [
        key,
        defaultBuilderBlocks(EMAIL_TEMPLATE_DEFINITIONS[key].label),
      ])
    ) as Record<AppEmailTemplateKey, EmailBuilderBlock[]>;
    const nextEnabled = Object.fromEntries(
      EMAIL_TEMPLATE_KEYS.map((key) => [key, false])
    ) as Record<AppEmailTemplateKey, boolean>;
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const parsed =
        tryParseBuilderBlocks(nextSettings.emailTemplates[key].html) ??
        htmlToBuilderBlocks(nextSettings.emailTemplates[key].html);
      if (parsed) {
        nextBlocks[key] = parsed;
        nextEnabled[key] = true;
      }
    }
    setEmailBlocksByTemplate(nextBlocks);
    setBuilderEnabledByTemplate(nextEnabled);
  }

  useEffect(() => {
    hydrateFromSnapshot(initialSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSettings]);

  useEffect(() => {
    function handleSettingsRestored(event: Event) {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (!detail || typeof detail !== "object") return;
      hydrateFromSnapshot(detail);
    }

    window.addEventListener(SETTINGS_RESTORED_EVENT, handleSettingsRestored as EventListener);
    return () => {
      window.removeEventListener(SETTINGS_RESTORED_EVENT, handleSettingsRestored as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (readOnly) return;
    setSaving(true);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Failed to save settings", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    setSettings(body);
    toast({ title: "Settings updated" });
  }

  async function uploadLogo(file: File) {
    if (readOnly) return;
    setUploadingLogo(true);
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "branding");
    const res = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    setUploadingLogo(false);
    if (!res.ok) {
      toast({ title: "Logo upload failed", description: body.error ?? "Could not upload logo.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({ ...prev, logoUrl: body.url ?? prev.logoUrl }));
    toast({ title: "Logo uploaded" });
  }

  function addBagLocationOption() {
    const value = normalizeOptionLabel(newBagLocation);
    if (!value) return;
    setSettings((prev) => ({
      ...prev,
      laundryBagLocationOptions: dedupeOptionList([...prev.laundryBagLocationOptions, value]),
    }));
    setNewBagLocation("");
  }

  function addDropoffLocationOption() {
    const value = normalizeOptionLabel(newDropoffLocation);
    if (!value) return;
    setSettings((prev) => ({
      ...prev,
      laundryDropoffLocationOptions: dedupeOptionList([...prev.laundryDropoffLocationOptions, value]),
    }));
    setNewDropoffLocation("");
  }

  function removeBagLocationOption(value: string) {
    if (settings.laundryBagLocationOptions.length <= 1) {
      toast({ title: "At least one bag location option is required.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({
      ...prev,
      laundryBagLocationOptions: prev.laundryBagLocationOptions.filter((item) => item !== value),
    }));
  }

  function removeDropoffLocationOption(value: string) {
    if (settings.laundryDropoffLocationOptions.length <= 1) {
      toast({ title: "At least one drop-off location option is required.", variant: "destructive" });
      return;
    }
    setSettings((prev) => ({
      ...prev,
      laundryDropoffLocationOptions: prev.laundryDropoffLocationOptions.filter((item) => item !== value),
    }));
  }

  function addAllowedCleaner() {
    if (!selectedCleanerToAdd) return;
    setSettings((prev) => ({
      ...prev,
      selectAllAllowedCleanerIds: Array.from(
        new Set([...prev.selectAllAllowedCleanerIds, selectedCleanerToAdd])
      ),
    }));
    setSelectedCleanerToAdd("");
  }

  function removeAllowedCleaner(cleanerId: string) {
    setSettings((prev) => ({
      ...prev,
      selectAllAllowedCleanerIds: prev.selectAllAllowedCleanerIds.filter((id) => id !== cleanerId),
    }));
  }

  function getCleanerRateValue(cleanerId: string, jobType: JobType): string {
    const value = settings.cleanerJobHourlyRates?.[cleanerId]?.[jobType];
    return value === undefined || value === null ? "" : String(value);
  }

  function setCleanerRate(cleanerId: string, jobType: JobType, rawValue: string) {
    const trimmed = rawValue.trim();
    setSettings((prev) => {
      const existing = { ...(prev.cleanerJobHourlyRates ?? {}) };
      const cleanerRates = { ...(existing[cleanerId] ?? {}) };

      if (!trimmed) {
        delete cleanerRates[jobType];
      } else {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric >= 0) {
          cleanerRates[jobType] = numeric;
        }
      }

      if (Object.keys(cleanerRates).length === 0) {
        delete existing[cleanerId];
      } else {
        existing[cleanerId] = cleanerRates;
      }

      return { ...prev, cleanerJobHourlyRates: existing };
    });
  }

  function setActiveEmailSubject(subject: string) {
    setSettings((prev) => ({
      ...prev,
      emailTemplates: {
        ...prev.emailTemplates,
        [selectedEmailTemplate]: {
          ...prev.emailTemplates[selectedEmailTemplate],
          subject,
        },
      },
    }));
  }

  function setActiveEmailHtml(html: string) {
    setSettings((prev) => ({
      ...prev,
      emailTemplates: {
        ...prev.emailTemplates,
        [selectedEmailTemplate]: {
          ...prev.emailTemplates[selectedEmailTemplate],
          html,
        },
      },
    }));
  }

  function setTemplateBlocks(nextBlocks: EmailBuilderBlock[]) {
    setEmailBlocksByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: nextBlocks }));
    setActiveEmailHtml(blocksToHtml(nextBlocks));
  }

  function addBuilderBlock(type: EmailBlockType) {
    const current = emailBlocksByTemplate[selectedEmailTemplate] ?? [];
    const next: EmailBuilderBlock =
      type === "button"
        ? { id: createBlockId(), type, text: "Take action", url: "{actionUrl}" }
        : type === "heading"
          ? { id: createBlockId(), type, text: "Heading" }
          : type === "paragraph"
            ? { id: createBlockId(), type, text: "Paragraph text" }
            : type === "html"
              ? { id: createBlockId(), type, text: "<div>Custom HTML</div>" }
              : { id: createBlockId(), type, text: "" };
    setTemplateBlocks([...current, next]);
  }

  function updateBuilderBlock(blockId: string, patch: Partial<EmailBuilderBlock>) {
    const current = emailBlocksByTemplate[selectedEmailTemplate] ?? [];
    setTemplateBlocks(current.map((block) => (block.id === blockId ? { ...block, ...patch } : block)));
  }

  function removeBuilderBlock(blockId: string) {
    const current = emailBlocksByTemplate[selectedEmailTemplate] ?? [];
    const next = current.filter((block) => block.id !== blockId);
    setTemplateBlocks(next.length > 0 ? next : defaultBuilderBlocks(activeEmailTemplateDefinition.label));
  }

  function moveBuilderBlock(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const current = [...(emailBlocksByTemplate[selectedEmailTemplate] ?? [])];
    const sourceIndex = current.findIndex((block) => block.id === sourceId);
    const targetIndex = current.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [sourceBlock] = current.splice(sourceIndex, 1);
    current.splice(targetIndex, 0, sourceBlock);
    setTemplateBlocks(current);
  }

  function enableBuilderForTemplate() {
    const currentHtml = settings.emailTemplates[selectedEmailTemplate].html;
    const existing = tryParseBuilderBlocks(currentHtml);
    const imported = existing ?? htmlToBuilderBlocks(currentHtml);
    const blocks =
      imported ??
      emailBlocksByTemplate[selectedEmailTemplate] ??
      defaultBuilderBlocks(activeEmailTemplateDefinition.label);
    setEmailBlocksByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: blocks }));
    setBuilderEnabledByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: true }));
  }

  function applyEmailSnippet(mode: "append" | "replace") {
    const snippet = EMAIL_TEMPLATE_SNIPPETS.find((item) => item.id === selectedEmailSnippetId);
    if (!snippet) return;

    const snippetBlocks = instantiateSnippetBlocks(snippet);
    const currentBlocks =
      activeTemplateBlocks.length > 0 ? activeTemplateBlocks : defaultBuilderBlocks(activeEmailTemplateDefinition.label);
    const nextBlocks = mode === "replace" ? snippetBlocks : [...currentBlocks, ...snippetBlocks];

    setBuilderEnabledByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: true }));
    setTemplateBlocks(nextBlocks);
    toast({
      title: mode === "replace" ? "Snippet loaded" : "Snippet inserted",
      description: `${snippet.label} ${mode === "replace" ? "replaced" : "added to"} this template.`,
    });
  }

  const activeEmailTemplate = settings.emailTemplates[selectedEmailTemplate];
  const activeEmailTemplateDefinition = EMAIL_TEMPLATE_DEFINITIONS[selectedEmailTemplate];
  const activeBuilderEnabled = builderEnabledByTemplate[selectedEmailTemplate] === true;
  const activeTemplateBlocks = emailBlocksByTemplate[selectedEmailTemplate] ?? [];
  const activeSnippet = EMAIL_TEMPLATE_SNIPPETS.find((item) => item.id === selectedEmailSnippetId);
  const activeNotificationTemplate = settings.notificationTemplates[selectedNotificationTemplate];
  const activeNotificationTemplateDefinition =
    NOTIFICATION_TEMPLATE_DEFINITIONS[selectedNotificationTemplate];

  const previewVariables = useMemo(() => {
    const base: Record<string, string> = {
      companyName: settings.companyName,
      projectName: settings.projectName,
      logoUrl: settings.logoUrl,
      accountsEmail: settings.accountsEmail,
      supportEmail: settings.accountsEmail,
      timezone: settings.timezone,
      appUrl: "https://example.com",
      portalUrl: "https://example.com",
      loginUrl: "https://example.com/login",
      adminUrl: "https://example.com/admin",
      cleanerUrl: "https://example.com/cleaner",
      clientUrl: "https://example.com/client",
      laundryUrl: "https://example.com/laundry",
      jobsUrl: "https://example.com/admin/jobs",
      reportsUrl: "https://example.com/admin/reports",
      settingsUrl: "https://example.com/admin/settings",
      currentDate: "24 March 2026",
      currentTime: "10:15 AM",
      currentDateTime: "24 March 2026, 10:15 AM",
      currentDateIso: "2026-03-24",
      currentDateTimeIso: "2026-03-24T10:15:00.000Z",
      currentYear: "2026",
      userName: "Alex",
      email: "user@example.com",
      code: "123456",
      expiryMinutes: "10",
      tempPassword: "TempPass!234",
      role: "Cleaner",
      jobType: "Airbnb Turnover",
      propertyName: "Harbour View Apartment",
      when: "Fri, 12 Mar 2026 at 10:00 AM",
      recipientName: "Laundry Team",
      reportLabel: "Week 11 Summary",
      cleanerName: "Chris",
      itemName: "Watch",
      location: "Bedroom drawer",
      notes: "Found during final check",
      clientName: "Property Owner",
      requestedAmount: "$120.00",
      requestType: "HOURLY",
      cleanerNote: "Extra scope requested on phone",
      actionUrl: "https://example.com/action-required",
      actionLabel: "Review now",
      jobUrl: "https://example.com/jobs/123",
      reportLink: "https://example.com/reports/123",
      caseLink: "https://example.com/admin/issues/123",
      createdVia: "invited account onboarding",
      createdAt: "24 Mar 2026, 10:15 AM",
      status: "Open",
      priority: "High",
      runTitle: "Weekly restock run",
      submittedBy: "Taylor",
      paidBy: "Cleaner",
      actualAmount: "$84.50",
      propertyNames: "Harbour View Apartment, Bay Retreat",
      requestedBy: "Taylor",
      submittedByName: "Taylor",
      lineCount: "14",
      changeSummary: "Status: Assigned -> In progress | Start time: 10:00 -> 09:30",
      immediateAttention: "Immediate attention required. ",
      cleanDate: "Tuesday, 24 March 2026",
      scheduledPickupDate: "Wednesday, 25 March 2026",
      bagLocation: "Laundry bin",
      laundryOutcome: "No pickup required",
      reasonCode: "No linen used",
      reasonNote: " No guest linen was used for this clean.",
      roleLabel: "Cleaner",
      dateLabel: "Wednesday, 25 March 2026",
      jobCount: "4",
      summaryHtml:
        "<ol><li><strong>P1 · SPS-0001 · Harbour View Apartment</strong><br/>Airbnb Turnover · 09:30-12:30<br/>Priority: Early check-in due by 12:30<br/>Notes: VIP arrival, top up coffee pods.</li></ol>",
      summaryText:
        "1) P1 SPS-0001 Harbour View Apartment 09:30-12:30. Early check-in due by 12:30. Note: VIP arrival, top up coffee pods.",
      propertyCount: "2",
      itemCount: "3",
      inventoryHtml:
        "<ul><li><strong>Harbour View Apartment</strong><br/>Coffee Pods (0/4 box), Toilet Paper (1/8 roll)</li></ul>",
      inventoryText:
        "Harbour View Apartment: Coffee Pods (0/4 box), Toilet Paper (1/8 roll)",
    };
    const variables = Array.from(
      new Set([
        ...activeEmailTemplateDefinition.variables,
        ...activeNotificationTemplateDefinition.variables,
      ])
    );
    for (const variable of variables) {
      if (!base[variable]) {
        base[variable] = `{${variable}}`;
      }
    }
    return base;
  }, [
    activeEmailTemplateDefinition.variables,
    activeNotificationTemplateDefinition.variables,
    settings.accountsEmail,
    settings.companyName,
    settings.logoUrl,
    settings.projectName,
    settings.timezone,
  ]);

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
        selectedEmailTemplate,
        previewVariables
      ),
    [
      previewVariables,
      selectedEmailTemplate,
      settings.companyName,
      settings.emailTemplates,
      settings.logoUrl,
    ]
  );

  const notificationPreview = useMemo(
    () =>
      renderNotificationTemplate(
        {
          companyName: settings.companyName,
          projectName: settings.projectName,
          accountsEmail: settings.accountsEmail,
          timezone: settings.timezone,
          notificationTemplates: settings.notificationTemplates,
        },
        selectedNotificationTemplate,
        previewVariables
      ),
    [previewVariables, selectedNotificationTemplate, settings.notificationTemplates]
  );

  function setActiveNotificationField(field: "webSubject" | "webBody" | "smsBody", value: string) {
    setSettings((prev) => ({
      ...prev,
      notificationTemplates: {
        ...prev.notificationTemplates,
        [selectedNotificationTemplate]: {
          ...prev.notificationTemplates[selectedNotificationTemplate],
          [field]: value,
        },
      },
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Editable System Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Company name</Label>
            <Input
              value={settings.companyName}
              onChange={(e) => setSettings((prev) => ({ ...prev, companyName: e.target.value }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Project name</Label>
            <Input
              value={settings.projectName}
              onChange={(e) => setSettings((prev) => ({ ...prev, projectName: e.target.value }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Input
              value={settings.timezone}
              onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input
              value={settings.logoUrl}
              onChange={(e) => setSettings((prev) => ({ ...prev, logoUrl: e.target.value }))}
              disabled={readOnly}
              placeholder="https://.../logo.png"
            />
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*"
                disabled={readOnly || uploadingLogo}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo(file);
                  e.currentTarget.value = "";
                }}
              />
              {uploadingLogo ? <span className="text-xs text-muted-foreground">Uploading...</span> : null}
            </div>
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logoUrl} alt="Logo preview" className="h-12 w-auto rounded border bg-white p-1" />
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Accounts email</Label>
            <Input
              value={settings.accountsEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, accountsEmail: e.target.value }))}
              disabled={readOnly}
              placeholder="accounts@sneekproservices.com.au"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>SMS provider</Label>
            <Select
              value={settings.smsProvider}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  smsProvider: value as AppSettings["smsProvider"],
                }))
              }
              disabled={readOnly}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select SMS provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="twilio">Twilio</SelectItem>
                <SelectItem value="cellcast">Cellcast</SelectItem>
                <SelectItem value="none">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Credentials still come from environment variables. Use `TWILIO_*` for Twilio or `CELLCAST_APPKEY`
              for Cellcast. Optional Cellcast overrides: `CELLCAST_API_URL`, `CELLCAST_FROM`. Leave
              `CELLCAST_FROM` empty unless you have a valid short sender ID approved for Cellcast.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Reminder: 24h (hours before)</Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={settings.reminder24hHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, reminder24hHours: Number(e.target.value || 24) }))}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reminder: 2h (hours before)</Label>
            <Input
              type="number"
              min={1}
              max={48}
              value={settings.reminder2hHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, reminder2hHours: Number(e.target.value || 2) }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Quote validity (days)</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={settings.quoteDefaultValidityDays}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, quoteDefaultValidityDays: Number(e.target.value || 14) }))
              }
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Quote email subject</Label>
            <Input
              value={settings.quoteDefaultEmailSubject}
              onChange={(e) => setSettings((prev) => ({ ...prev, quoteDefaultEmailSubject: e.target.value }))}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Cleaner start date verification</p>
              <p className="text-xs text-muted-foreground">Cleaner must verify scheduled date when starting.</p>
            </div>
            <Switch
              checked={settings.cleanerStartRequireDateMatch}
              onCheckedChange={(value) => setSettings((prev) => ({ ...prev, cleanerStartRequireDateMatch: value }))}
              disabled={readOnly}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Cleaner start checklist verification</p>
              <p className="text-xs text-muted-foreground">Cleaner must confirm on-site readiness before start.</p>
            </div>
            <Switch
              checked={settings.cleanerStartRequireChecklistConfirm}
              onCheckedChange={(value) =>
                setSettings((prev) => ({ ...prev, cleanerStartRequireChecklistConfirm: value }))
              }
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Client communication requires admin initiation</p>
            <p className="text-xs text-muted-foreground">
              When enabled, automatic client messaging is blocked and only admin-initiated share actions can send.
            </p>
          </div>
          <Switch
            checked={settings.strictClientAdminOnly}
            onCheckedChange={(value) =>
              setSettings((prev) => ({ ...prev, strictClientAdminOnly: value }))
            }
            disabled={readOnly}
          />
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <div>
            <p className="text-sm font-medium">Laundry Location Dropdowns</p>
            <p className="text-xs text-muted-foreground">
              Manage pickup and drop-off location lists in one place. Use the sync buttons if both lists should match.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  laundryDropoffLocationOptions: dedupeOptionList(prev.laundryBagLocationOptions),
                }))
              }
              disabled={readOnly}
            >
              Copy bag options to drop-off
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  laundryBagLocationOptions: dedupeOptionList(prev.laundryDropoffLocationOptions),
                }))
              }
              disabled={readOnly}
            >
              Copy drop-off options to bag
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bag / pickup locations</Label>
              <div className="flex gap-2">
                <Input
                  value={newBagLocation}
                  onChange={(e) => setNewBagLocation(e.target.value)}
                  disabled={readOnly}
                  placeholder="Add bag location option"
                />
                <Button type="button" variant="outline" onClick={addBagLocationOption} disabled={readOnly || !newBagLocation.trim()}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
              <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-input/70 bg-white/60 p-3">
                {settings.laundryBagLocationOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No options yet.</p>
                ) : (
                  settings.laundryBagLocationOptions.map((option) => (
                    <span
                      key={option}
                      className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-3 py-1 text-xs"
                    >
                      {option}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeBagLocationOption(option)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${option}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Drop-off locations</Label>
              <div className="flex gap-2">
                <Input
                  value={newDropoffLocation}
                  onChange={(e) => setNewDropoffLocation(e.target.value)}
                  disabled={readOnly}
                  placeholder="Add drop-off location option"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addDropoffLocationOption}
                  disabled={readOnly || !newDropoffLocation.trim()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
              <div className="flex min-h-12 flex-wrap gap-2 rounded-xl border border-input/70 bg-white/60 p-3">
                {settings.laundryDropoffLocationOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No options yet.</p>
                ) : (
                  settings.laundryDropoffLocationOptions.map((option) => (
                    <span
                      key={option}
                      className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-3 py-1 text-xs"
                    >
                      {option}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeDropoffLocationOption(option)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${option}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Select-all allowed cleaners</Label>
          <div className="flex gap-2">
            <Select value={selectedCleanerToAdd} onValueChange={setSelectedCleanerToAdd} disabled={readOnly || availableCleaners.length === 0}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={availableCleaners.length === 0 ? "No more cleaners to add" : "Select a cleaner"} />
              </SelectTrigger>
              <SelectContent>
                {availableCleaners.map((cleaner) => (
                  <SelectItem key={cleaner.id} value={cleaner.id}>
                    {cleanerLabel(cleaner)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={addAllowedCleaner} disabled={readOnly || !selectedCleanerToAdd}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
          <div className="space-y-2 rounded-xl border border-input/70 bg-white/60 p-3">
            {settings.selectAllAllowedCleanerIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cleaners selected.</p>
            ) : (
              settings.selectAllAllowedCleanerIds.map((cleanerId) => {
                const cleaner = cleanerById.get(cleanerId);
                return (
                  <div key={cleanerId} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {cleaner ? cleaner.name ?? cleaner.email : cleanerId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cleaner ? `${cleaner.email} - ${cleanerId}` : cleanerId}
                      </p>
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAllowedCleaner(cleanerId)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Only selected cleaners can use the checklist Select All button.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Cleaner hourly rates by job category</p>
          {cleanerOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active cleaners found.</p>
          ) : (
            <>
              <div className="max-w-md">
                <Label>Select cleaner</Label>
                <Select
                  value={selectedRateCleanerId}
                  onValueChange={setSelectedRateCleanerId}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cleaner" />
                  </SelectTrigger>
                  <SelectContent>
                    {cleanerOptions.map((cleaner) => (
                      <SelectItem key={cleaner.id} value={cleaner.id}>
                        {cleanerLabel(cleaner)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRateCleanerId ? (
                <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                  {JOB_TYPES.map((jobType) => (
                    <div key={jobType} className="space-y-1">
                      <Label className="text-xs">{jobType.replace(/_/g, " ")}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={getCleanerRateValue(selectedRateCleanerId, jobType)}
                        onChange={(e) => setCleanerRate(selectedRateCleanerId, jobType, e.target.value)}
                        disabled={readOnly}
                        placeholder="e.g. 30"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            These rates are applied automatically to assignment pay rates (`JobAssignment.payRate`) per job type.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Email Templates</p>
          <div className="space-y-3 rounded-md border p-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3">
                <div className="max-w-md space-y-1.5">
                  <Label>Template</Label>
                  <Select value={selectedEmailTemplate} onValueChange={(value: AppEmailTemplateKey) => setSelectedEmailTemplate(value)} disabled={readOnly}>
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

                <div className="space-y-1.5">
                  <Label>Available variables</Label>
                  <div className="flex flex-wrap gap-2 rounded-xl border border-input/70 bg-white/60 p-3">
                    {activeEmailTemplateDefinition.variables.map((variable) => (
                      <button
                        key={variable}
                        type="button"
                        className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80"
                        onClick={() => {
                          if (readOnly) return;
                          const token = `{${variable}}`;
                          if (activeBuilderEnabled) {
                            const paragraphIndex = activeTemplateBlocks.findIndex((block) => block.type === "paragraph");
                            if (paragraphIndex >= 0) {
                              const target = activeTemplateBlocks[paragraphIndex];
                              updateBuilderBlock(
                                target.id,
                                { text: `${target.text}${target.text ? " " : ""}${token}` }
                              );
                              return;
                            }
                            addBuilderBlock("paragraph");
                            return;
                          }
                          setActiveEmailHtml(`${stripBuilderMetadata(activeEmailTemplate.html)}\n<p>${token}</p>`);
                        }}
                        disabled={readOnly}
                      >
                        {`{${variable}}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Common variables are available in every email template, including URLs like <code>{"{loginUrl}"}</code>, <code>{"{adminUrl}"}</code>, and date helpers like <code>{"{currentDateTime}"}</code>.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Input
                    value={activeEmailTemplate.subject}
                    onChange={(e) => setActiveEmailSubject(e.target.value)}
                    disabled={readOnly}
                  />
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">Visual builder</p>
                    {!activeBuilderEnabled ? (
                      <Button type="button" size="sm" variant="outline" onClick={enableBuilderForTemplate} disabled={readOnly}>
                        Enable visual builder
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setBuilderEnabledByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: false }));
                          setActiveEmailHtml(stripBuilderMetadata(activeEmailTemplate.html));
                        }}
                        disabled={readOnly}
                      >
                        Use raw HTML
                      </Button>
                    )}
                  </div>

                  {activeBuilderEnabled ? (
                    <>
                      <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Snippet library
                        </p>
                        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                          <Select value={selectedEmailSnippetId} onValueChange={setSelectedEmailSnippetId} disabled={readOnly}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a snippet" />
                            </SelectTrigger>
                            <SelectContent>
                              {EMAIL_TEMPLATE_SNIPPETS.map((snippet) => (
                                <SelectItem key={snippet.id} value={snippet.id}>
                                  {snippet.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => applyEmailSnippet("append")}
                            disabled={readOnly}
                          >
                            Insert snippet
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => applyEmailSnippet("replace")}
                            disabled={readOnly}
                          >
                            Replace with snippet
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {activeSnippet?.description ?? "Pick a snippet to quickly add structured content."}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => addBuilderBlock("heading")} disabled={readOnly}>
                          Add heading
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => addBuilderBlock("paragraph")} disabled={readOnly}>
                          Add paragraph
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => addBuilderBlock("button")} disabled={readOnly}>
                          Add action button
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => addBuilderBlock("divider")} disabled={readOnly}>
                          Add divider
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => addBuilderBlock("html")} disabled={readOnly}>
                          Add custom HTML
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {activeTemplateBlocks.map((block) => (
                          <div
                            key={block.id}
                            draggable={!readOnly}
                            onDragStart={() => setDraggingBlockId(block.id)}
                            onDragEnd={() => setDraggingBlockId(null)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              if (!draggingBlockId) return;
                              moveBuilderBlock(draggingBlockId, block.id);
                              setDraggingBlockId(null);
                            }}
                            className="space-y-2 rounded-md border bg-white p-3"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {block.type} block (drag to reorder)
                              </p>
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeBuilderBlock(block.id)} disabled={readOnly}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            {block.type !== "divider" ? (
                              block.type === "html" ? (
                                <Textarea
                                  value={block.text}
                                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateBuilderBlock(block.id, { text: e.target.value })}
                                  disabled={readOnly}
                                  placeholder="<table>...</table>"
                                  rows={6}
                                />
                              ) : (
                                <Input
                                  value={block.text}
                                  onChange={(e) => updateBuilderBlock(block.id, { text: e.target.value })}
                                  disabled={readOnly}
                                  placeholder={block.type === "button" ? "Button label" : "Text"}
                                />
                              )
                            ) : null}
                            {block.type === "button" ? (
                              <Input
                                value={block.url ?? ""}
                                onChange={(e) => updateBuilderBlock(block.id, { url: e.target.value })}
                                disabled={readOnly}
                                placeholder="{actionUrl}"
                              />
                            ) : null}
                            {block.type === "html" ? (
                              <p className="text-xs text-muted-foreground">
                                This block preserves custom HTML that cannot be cleanly represented as a simple visual paragraph, heading, button, or divider.
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Visual builder is off for this template. Enable it to build emails with drag-and-drop blocks.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>HTML body</Label>
                  <Textarea
                    value={stripBuilderMetadata(activeEmailTemplate.html)}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                      setBuilderEnabledByTemplate((prev) => ({ ...prev, [selectedEmailTemplate]: false }));
                      setActiveEmailHtml(e.target.value);
                    }}
                    disabled={readOnly}
                    rows={10}
                  />
                  <p className="text-xs text-muted-foreground">
                    Branding wrapper and responsive layout are applied automatically. Raw HTML edits switch this template to manual mode.
                  </p>
                </div>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Preview</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={emailPreviewMode === "mobile" ? "default" : "outline"}
                      onClick={() => setEmailPreviewMode("mobile")}
                    >
                      Mobile
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={emailPreviewMode === "desktop" ? "default" : "outline"}
                      onClick={() => setEmailPreviewMode("desktop")}
                    >
                      Desktop
                    </Button>
                  </div>
                </div>
                <div className="rounded-md bg-muted/50 p-2">
                  <div
                    className="mx-auto overflow-hidden rounded border bg-white"
                    style={{ width: emailPreviewMode === "mobile" ? "360px" : "100%", maxWidth: "100%" }}
                  >
                    <iframe
                      title={`Email preview ${selectedEmailTemplate}`}
                      srcDoc={emailPreview.html}
                      className="h-[520px] w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">SMS and Web Notification Templates</p>
          <div className="space-y-3 rounded-md border p-4">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-3">
                <div className="max-w-md space-y-1.5">
                  <Label>Template</Label>
                  <Select
                    value={selectedNotificationTemplate}
                    onValueChange={(value: AppNotificationTemplateKey) => setSelectedNotificationTemplate(value)}
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

                <div className="space-y-1.5">
                  <Label>Available variables</Label>
                  <div className="flex flex-wrap gap-2 rounded-xl border border-input/70 bg-white/60 p-3">
                    {activeNotificationTemplateDefinition.variables.map((variable) => (
                      <span key={variable} className="rounded bg-muted px-2 py-1 text-xs">
                        {`{${variable}}`}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Common notification variables are also available, including <code>{"{companyName}"}</code>, <code>{"{loginUrl}"}</code>, <code>{"{currentDate}"}</code>, and <code>{"{actionUrl}"}</code>.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Web notification title</Label>
                  <Input
                    value={activeNotificationTemplate.webSubject}
                    onChange={(e) => setActiveNotificationField("webSubject", e.target.value)}
                    disabled={readOnly}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Web notification message</Label>
                  <Textarea
                    value={activeNotificationTemplate.webBody}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setActiveNotificationField("webBody", e.target.value)}
                    disabled={readOnly}
                    rows={4}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>SMS message</Label>
                  <Textarea
                    value={activeNotificationTemplate.smsBody}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setActiveNotificationField("smsBody", e.target.value)}
                    disabled={readOnly}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    SMS should stay short. Current length: {activeNotificationTemplate.smsBody.length} characters.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Preview</p>
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <div className="rounded-md border bg-white p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Web title</p>
                    <p className="mt-1 text-sm font-semibold">{notificationPreview.webSubject}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{notificationPreview.webBody}</p>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SMS</p>
                    <p className="mt-1 text-sm text-muted-foreground">{notificationPreview.smsBody}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Profile edit permissions by role</p>
          <div className="space-y-2">
            {ROLES.map((role) => {
              const policy = settings.profileEditPolicy[role];
              return (
                <div key={role} className="grid items-center gap-2 rounded-md border p-3 md:grid-cols-4">
                  <p className="text-sm font-medium">{role}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Name</Label>
                    <Switch
                      checked={policy.canEditName}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditName: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Phone</Label>
                    <Switch
                      checked={policy.canEditPhone}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditPhone: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Email</Label>
                    <Switch
                      checked={policy.canEditEmail}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          profileEditPolicy: {
                            ...prev.profileEditPolicy,
                            [role]: { ...prev.profileEditPolicy[role], canEditEmail: value },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Client Portal Visibility (Admin-controlled)</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              {[
                ["showProperties", "Show properties"],
                ["showJobs", "Show jobs"],
                ["showCalendar", "Show calendar"],
                ["showReports", "Show reports"],
                ["showReportDownloads", "Allow report PDF downloads"],
                ["showChecklistPreview", "Show checklist preview"],
                ["showInventory", "Show inventory"],
                ["showShopping", "Show shopping"],
                ["showStockRuns", "Show stock count runs"],
                ["showFinanceDetails", "Show finance details"],
                ["showOngoingJobs", "Show ongoing jobs"],
                ["showLaundryUpdates", "Show laundry updates"],
                ["showLaundryImages", "Show laundry images"],
                ["showLaundryCosts", "Show laundry costs"],
                ["showClientTaskRequests", "Allow client task requests"],
                ["showCases", "Show cases/issues"],
                ["showExtraPayRequests", "Show extra pay requests"],
                ["showQuoteRequests", "Show quote requests"],
                ["showApprovals", "Show approval requests"],
                ["showCleanerNames", "Show cleaner names to client"],
              ["allowInventoryThresholdEdits", "Allow client inventory threshold edits"],
              ["allowStockRuns", "Allow client stock count runs"],
              ["allowCaseReplies", "Allow client case replies"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.clientPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      clientPortalVisibility: {
                        ...prev.clientPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Controls what clients can view in the Client Portal. Hidden sections are removed from navigation.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Cleaner Portal Visibility</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {[
              ["showJobs", "Show jobs"],
              ["showCalendar", "Show calendar"],
              ["showShopping", "Show shopping"],
              ["showStockRuns", "Show stock count runs"],
              ["showInvoices", "Show invoices"],
              ["showPayRequests", "Show pay requests"],
              ["showLostFound", "Show lost and found"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.cleanerPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      cleanerPortalVisibility: {
                        ...prev.cleanerPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Laundry Portal Controls</p>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {[
              ["showCalendar", "Show calendar"],
              ["showInvoices", "Show invoices"],
              ["showHistoryTab", "Show history tab"],
              ["showCostTracking", "Show laundry cost tracking"],
              ["showPickupPhoto", "Allow pickup photo"],
              ["showSkipReasons", "Show skip reasons and cleaner notes"],
              ["requireDropoffPhoto", "Require drop-off photo"],
              ["requireEarlyDropoffReason", "Require reason for early drop-off"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded border p-2">
                <Label className="text-xs">{label}</Label>
                <Switch
                  checked={(settings.laundryPortalVisibility as any)?.[key] ?? false}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryPortalVisibility: {
                        ...prev.laundryPortalVisibility,
                        [key]: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Pickup cutoff time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.pickupCutoffTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, pickupCutoffTime: e.target.value || "10:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default pickup time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.defaultPickupTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, defaultPickupTime: e.target.value || "09:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default drop-off time</Label>
              <Input
                type="time"
                value={settings.laundryOperations.defaultDropoffTime}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: { ...prev.laundryOperations, defaultDropoffTime: e.target.value || "16:00" },
                  }))
                }
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fallback outdoor days (manual jobs only)</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={settings.laundryOperations.maxOutdoorDays}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    laundryOperations: {
                      ...prev.laundryOperations,
                      maxOutdoorDays: Number(e.target.value || prev.laundryOperations.maxOutdoorDays),
                    },
                  }))
                }
                disabled={readOnly}
              />
              <p className="text-xs text-muted-foreground">
                Used when fast-return is disabled and there is no next known clean date.
              </p>
            </div>
            <div className="space-y-2 rounded border p-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-xs">Fast return when no next clean is known</Label>
                  <p className="text-xs text-muted-foreground">
                    If enabled, planner returns linen quickly so you can handle last-minute bookings.
                  </p>
                </div>
                <Switch
                  checked={settings.laundryOperations.fastReturnWhenNoNextClean}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryOperations: { ...prev.laundryOperations, fastReturnWhenNoNextClean: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fast-return days after pickup</Label>
                <Input
                  type="number"
                  min={1}
                  max={7}
                  value={settings.laundryOperations.fastReturnDaysWhenNoNextClean}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      laundryOperations: {
                        ...prev.laundryOperations,
                        fastReturnDaysWhenNoNextClean: Number(
                          e.target.value || prev.laundryOperations.fastReturnDaysWhenNoNextClean
                        ),
                      },
                    }))
                  }
                  disabled={readOnly || !settings.laundryOperations.fastReturnWhenNoNextClean}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These settings control the laundry portal menus and operational defaults shown to the laundry team.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Notification Defaults</p>
          <div className="grid gap-3 rounded-md border p-3">
            {Object.entries(settings.notificationDefaults.categories).map(([category, channels]) => (
              <div key={category} className="grid items-center gap-3 rounded border p-3 md:grid-cols-4">
                <div>
                  <p className="text-sm font-medium capitalize">{category}</p>
                  <p className="text-xs text-muted-foreground">Default delivery channels for new users and untouched preferences.</p>
                </div>
                {(["web", "email", "sms"] as const).map((channel) => (
                  <div key={`${category}-${channel}`} className="flex items-center justify-between gap-2 rounded border p-2">
                    <Label className="text-xs uppercase">{channel}</Label>
                    <Switch
                      checked={Boolean((channels as any)?.[channel])}
                      onCheckedChange={(value) =>
                        setSettings((prev) => ({
                          ...prev,
                          notificationDefaults: {
                            ...prev.notificationDefaults,
                            categories: {
                              ...prev.notificationDefaults.categories,
                              [category]: {
                                ...prev.notificationDefaults.categories[category as keyof typeof prev.notificationDefaults.categories],
                                [channel]: value,
                              },
                            },
                          },
                        }))
                      }
                      disabled={readOnly}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Scheduled Notification Automation</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">24-hour reminder emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends the scheduled email reminder flow based on the reminder hours above.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.reminder24hEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        reminder24hEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">2-hour reminder SMS</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends the scheduled SMS reminder flow based on the reminder hours above.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.reminder2hEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        reminder2hEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Tomorrow prep summaries</Label>
                  <p className="text-xs text-muted-foreground">
                    Cleaner, laundry, and admin tomorrow-prep notifications with critical stock alerts.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.tomorrowPrepEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        tomorrowPrepEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tomorrow prep send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.tomorrowPrepTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        tomorrowPrepTime: e.target.value || "17:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Critical stock alert emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Daily admin low-stock alert using the inventory reorder thresholds.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.stockAlertsEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        stockAlertsEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Stock alert send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.stockAlertsTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        stockAlertsTime: e.target.value || "07:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Daily admin attention summary</Label>
                  <p className="text-xs text-muted-foreground">
                    Sends admins a daily email and SMS summary of approvals, unassigned jobs, cases, and flagged work.
                  </p>
                </div>
                <Switch
                  checked={settings.scheduledNotifications.adminAttentionSummaryEnabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        adminAttentionSummaryEnabled: value,
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Admin summary send time</Label>
                <Input
                  type="time"
                  value={settings.scheduledNotifications.adminAttentionSummaryTime}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      scheduledNotifications: {
                        ...prev.scheduledNotifications,
                        adminAttentionSummaryTime: e.target.value || "08:00",
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These controls affect the worker-driven timed notification jobs. Manual dispatch remains available in the Notifications tab.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Operational Safeguards</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Auto clock-out enabled</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically stop running time logs after the configured grace period.
                  </p>
                </div>
                <Switch
                  checked={settings.autoClockOut.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: { ...prev.autoClockOut, enabled: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Grace minutes after due time</Label>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={settings.autoClockOut.graceMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: {
                        ...prev.autoClockOut,
                        graceMinutes: Number(e.target.value || prev.autoClockOut.graceMinutes),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Maximum job length (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={settings.autoClockOut.maxJobLengthHours}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: {
                        ...prev.autoClockOut,
                        maxJobLengthHours: Number(
                          e.target.value || prev.autoClockOut.maxJobLengthHours
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
                <p className="text-xs text-muted-foreground">
                  Used when a job does not have fixed / allocated pay hours set.
                </p>
              </div>
              <div className="flex items-center justify-between rounded border p-2">
                <Label className="text-xs">Fallback auto clock-out at midnight</Label>
                <Switch
                  checked={settings.autoClockOut.fallbackAtMidnight}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoClockOut: { ...prev.autoClockOut, fallbackAtMidnight: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Operations</p>
          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">SLA monitoring enabled</Label>
                <Switch
                  checked={settings.sla.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({ ...prev, sla: { ...prev.sla, enabled: value } }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Warn before due (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={72}
                  value={settings.sla.warnHoursBeforeDue}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      sla: { ...prev.sla, warnHoursBeforeDue: Number(e.target.value || prev.sla.warnHoursBeforeDue) },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Escalate overdue after (mins)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.sla.overdueEscalationMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      sla: {
                        ...prev.sla,
                        overdueEscalationMinutes: Number(
                          e.target.value || prev.sla.overdueEscalationMinutes
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Recurring generation enabled</Label>
                <Switch
                  checked={settings.recurringJobs.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      recurringJobs: { ...prev.recurringJobs, enabled: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lookahead days</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.recurringJobs.lookaheadDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      recurringJobs: {
                        ...prev.recurringJobs,
                        lookaheadDays: Number(e.target.value || prev.recurringJobs.lookaheadDays),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Smart auto-assign enabled</Label>
                <Switch
                  checked={settings.autoAssign.enabled}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({ ...prev, autoAssign: { ...prev.autoAssign, enabled: value } }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max daily jobs per cleaner</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.autoAssign.maxDailyJobsPerCleaner}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      autoAssign: {
                        ...prev.autoAssign,
                        maxDailyJobsPerCleaner: Number(
                          e.target.value || prev.autoAssign.maxDailyJobsPerCleaner
                        ),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Auto-create rework on QA fail</Label>
                <Switch
                  checked={settings.qaAutomation.autoCreateReworkJob}
                  onCheckedChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: { ...prev.qaAutomation, autoCreateReworkJob: value },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>QA fail threshold</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.qaAutomation.failureThreshold}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: {
                        ...prev.qaAutomation,
                        failureThreshold: Number(e.target.value || prev.qaAutomation.failureThreshold),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rework delay (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={settings.qaAutomation.reworkDelayHours}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      qaAutomation: {
                        ...prev.qaAutomation,
                        reworkDelayHours: Number(e.target.value || prev.qaAutomation.reworkDelayHours),
                      },
                    }))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These controls power SLA escalation, recurring generation, smart assignment scoring, route optimization, and QA rework automation.
          </p>
        </div>

      </CardContent>
      {!readOnly && (
        <div className="sticky bottom-4 z-20 flex justify-end px-6 pb-6">
          <div className="flex items-center gap-3 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="text-xs text-muted-foreground">Changes apply across all portals and automation rules.</p>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
