"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Award,
  Bell,
  Briefcase,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  GraduationCap,
  Megaphone,
  MessageCircle,
  Paperclip,
  Pencil,
  Pin,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { WorkforcePostCard } from "@/components/workforce/workforce-post-card";

function splitCsv(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function safeJsonText(value: unknown, fallback: Record<string, unknown>) {
  try {
    return JSON.stringify(value ?? fallback, null, 2);
  } catch {
    return JSON.stringify(fallback, null, 2);
  }
}

function formatDateTimeInput(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function prettifyLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

async function uploadPrivateFile(file: File, folder: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body.error ?? "Upload failed.");
  return body;
}

const DEFAULT_GROUP_FORM = {
  name: "",
  description: "",
  category: "GENERAL",
  membershipMode: "SMART",
  departments: "",
  locations: "",
  roles: ["CLEANER"],
  memberUserIds: [] as string[],
  createChatChannel: true,
};

const DEFAULT_POST_FORM = {
  title: "",
  body: "",
  audienceType: "all",
  audienceValues: [] as string[],
  pinned: true,
  coverImageUrl: "",
  publishAt: "",
  attachments: [] as Array<{ url: string; s3Key?: string | null; fileName?: string | null; mimeType?: string | null }>,
};

const DEFAULT_LEARNING_FORM = {
  title: "",
  slug: "",
  type: "COURSE",
  description: "",
  coverImageUrl: "",
  isPublished: false,
  mandatory: false,
  audienceRoles: ["CLEANER"],
  schemaText: safeJsonText(
    { version: 1, audienceRoles: ["CLEANER"], scoringModel: "guided_course_with_checks", modules: [] },
    { version: 1, audienceRoles: ["CLEANER"], scoringModel: "guided_course_with_checks", modules: [] }
  ),
};

const DEFAULT_POSITION_FORM = {
  title: "Cleaner / Turnover Specialist",
  slug: "",
  description: "",
  department: "Cleaning",
  location: "Greater Sydney",
  employmentType: "Casual / Contract",
  isPublished: true,
};

export function AdminWorkforceHub({ appBaseUrl = "" }: { appBaseUrl?: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTab, setSelectedTab] = useState("groups");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [messages, setMessages] = useState<any[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string>("");
  const [editingPostId, setEditingPostId] = useState<string>("");
  const [editingPositionId, setEditingPositionId] = useState<string>("");
  const [postImageUploading, setPostImageUploading] = useState(false);
  const [groupPreview, setGroupPreview] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [postFiles, setPostFiles] = useState<File[]>([]);
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingMessageBody, setEditingMessageBody] = useState("");
  const [channelMessageFiles, setChannelMessageFiles] = useState<File[]>([]);
  const [channelEditForm, setChannelEditForm] = useState({ name: "", description: "", memberUserIds: [] as string[] });
  const [editingLearningPathId, setEditingLearningPathId] = useState("");
  const [learningEditor, setLearningEditor] = useState(DEFAULT_LEARNING_FORM);
  const [docFilters, setDocFilters] = useState({ category: "ALL", userId: "ALL", expiryStatus: "ALL" });
  const [docRequestForm, setDocRequestForm] = useState({ userId: "", category: "POLICE_CHECK", title: "", notes: "", dueAt: "" });

  const [groupForm, setGroupForm] = useState(DEFAULT_GROUP_FORM);
  const [postForm, setPostForm] = useState(DEFAULT_POST_FORM);
  const [channelForm, setChannelForm] = useState({
    kind: "GROUP",
    name: "",
    description: "",
    groupId: "",
    otherUserId: "",
  });
  const [learningForm, setLearningForm] = useState({
    pathId: "",
    targetType: "user",
    targetValue: "",
    restart: false,
  });
  const [docForm, setDocForm] = useState({
    userId: "",
    category: "POLICE_CHECK",
    title: "",
    notes: "",
    expiresAt: "",
    requestId: "",
    requiresSignature: false,
  });
  const [recognitionForm, setRecognitionForm] = useState({
    userId: "",
    title: "",
    message: "",
    badgeKey: "STAR_PERFORMER",
    celebrationStyle: "SPOTLIGHT",
    isPublic: true,
  });
  const [positionForm, setPositionForm] = useState(DEFAULT_POSITION_FORM);
  const [applicationReview, setApplicationReview] = useState<Record<string, { status: string; notes: string; interviewNotes: string; interviewDate: string; rejectionReason: string; offerRole: string; offerRate: string; offerStartDate: string }>>({});

  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const res = await fetch("/api/admin/workforce");
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load workforce hub.");
      setData(body);
      const nextChannelIds = new Set((body?.channels ?? []).map((channel: any) => channel.id));
      if (selectedChannelId && nextChannelIds.has(selectedChannelId)) {
        // Keep the currently open channel when it still exists after refresh.
      } else if (body?.channels?.[0]?.id) {
        setSelectedChannelId(body.channels[0].id);
      } else {
        setSelectedChannelId("");
      }
      if (!learningForm.pathId && body?.learningPaths?.[0]?.id) {
        setLearningForm((current) => ({ ...current, pathId: body.learningPaths[0].id }));
      }
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message ?? "Could not load workforce data.", variant: "destructive" });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function runAction(payload: Record<string, unknown>, successTitle: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Action failed.");
      toast({ title: successTitle });
      await load({ silent: true });
      return body;
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message ?? "Try again.", variant: "destructive" });
      return null;
    } finally {
      setSaving(false);
    }
  }

  function resetGroupEditor() {
    setEditingGroupId("");
    setGroupForm(DEFAULT_GROUP_FORM);
    setGroupPreview([]);
  }

  function resetPostEditor() {
    setEditingPostId("");
    setPostForm(DEFAULT_POST_FORM);
    setPostFiles([]);
  }

  function resetLearningEditor() {
    setEditingLearningPathId("");
    setLearningEditor(DEFAULT_LEARNING_FORM);
  }

  function resetPositionEditor() {
    setEditingPositionId("");
    setPositionForm(DEFAULT_POSITION_FORM);
  }

  function startGroupEdit(group: any) {
    setEditingGroupId(group.id);
    setGroupForm({
      name: group.name ?? "",
      description: group.description ?? "",
      category: group.category ?? "GENERAL",
      membershipMode: group.membershipMode ?? "SMART",
      departments: (group.smartRules?.departments ?? []).join(", "),
      locations: (group.smartRules?.locations ?? []).join(", "),
      roles: Array.isArray(group.smartRules?.roles) && group.smartRules.roles.length > 0 ? group.smartRules.roles : ["CLEANER"],
      memberUserIds: group.memberUserIds ?? [],
      createChatChannel: false,
    });
    setGroupPreview(group.members ?? []);
  }

  function parsePostAudience(post: any) {
    const audience = post?.audience ?? {};
    if (audience.all) return { audienceType: "all", audienceValues: [] as string[] };
    if (Array.isArray(audience.groupIds) && audience.groupIds.length > 0) return { audienceType: "group", audienceValues: audience.groupIds.map(String) };
    if (Array.isArray(audience.roles) && audience.roles.length > 0) return { audienceType: "role", audienceValues: audience.roles.map(String) };
    if (Array.isArray(audience.userIds) && audience.userIds.length > 0) return { audienceType: "user", audienceValues: audience.userIds.map(String) };
    return { audienceType: "all", audienceValues: [] as string[] };
  }

  function startPostEdit(post: any) {
    const audience = parsePostAudience(post);
    setEditingPostId(post.id);
    setPostForm({
      title: post.title ?? "",
      body: post.body ?? "",
      audienceType: audience.audienceType,
      audienceValues: audience.audienceValues,
      pinned: post.pinned === true,
      coverImageUrl: post.coverImageUrl ?? "",
      publishAt: post.publishAt ? new Date(post.publishAt).toISOString().slice(0, 16) : "",
      attachments: Array.isArray(post.attachments) ? post.attachments : [],
    });
    setPostFiles([]);
  }

  function startLearningEdit(path: any) {
    setEditingLearningPathId(path.id);
    setLearningEditor({
      title: path.title ?? "",
      slug: path.slug ?? "",
      type: path.type ?? "COURSE",
      description: path.description ?? "",
      coverImageUrl: path.coverImageUrl ?? "",
      isPublished: path.isPublished === true,
      mandatory: path.mandatory === true,
      audienceRoles: Array.isArray(path.audience?.roles) && path.audience.roles.length > 0 ? path.audience.roles.map(String) : ["CLEANER"],
      schemaText: safeJsonText(
        path.schema,
        { version: 1, audienceRoles: ["CLEANER"], scoringModel: "guided_course_with_checks", modules: [] }
      ),
    });
  }

  function startPositionEdit(position: any) {
    setEditingPositionId(position.id);
    setPositionForm({
      title: position.title ?? "",
      slug: position.slug ?? "",
      description: position.description ?? "",
      department: position.department ?? "",
      location: position.location ?? "",
      employmentType: position.employmentType ?? "",
      isPublished: position.isPublished !== false,
    });
  }

  function resolvePublicPositionUrl(position: any) {
    const absoluteBase =
      appBaseUrl.trim() ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const path = `/apply/${position.slug}`;
    if (!absoluteBase) return path;
    return `${absoluteBase.replace(/\/+$/, "")}${path}`;
  }

  async function copyText(value: string, successTitle: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: successTitle });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err?.message ?? "Could not copy text.", variant: "destructive" });
    }
  }

  async function loadMessages(channelId: string) {
    if (!channelId) {
      setMessages([]);
      return;
    }
    try {
      const res = await fetch(`/api/chat/channels/${channelId}/messages`);
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error(body.error ?? "Could not load channel.");
      setMessages(Array.isArray(body) ? body : []);
    } catch (err: any) {
      toast({ title: "Chat load failed", description: err.message ?? "Could not load messages.", variant: "destructive" });
    }
  }

  const selectedChannel = useMemo(
    () => (data?.channels ?? []).find((channel: any) => channel.id === selectedChannelId) ?? null,
    [data, selectedChannelId]
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedChannelId) return;
    void loadMessages(selectedChannelId);
    const timer = window.setInterval(() => void loadMessages(selectedChannelId), 3000);
    return () => window.clearInterval(timer);
  }, [selectedChannelId]);

  useEffect(() => {
    if (!selectedChannel) return;
    setChannelEditForm({
      name: selectedChannel.name ?? "",
      description: selectedChannel.description ?? "",
      memberUserIds: Array.isArray(selectedChannel.memberUserIds) ? selectedChannel.memberUserIds : [],
    });
  }, [selectedChannel]);

  async function previewGroupMembers() {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/admin/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PREVIEW_GROUP",
          membershipMode: groupForm.membershipMode,
          smartRules: {
            logic: "AND",
            roles: groupForm.roles,
            departments: splitCsv(groupForm.departments),
            locations: splitCsv(groupForm.locations),
            rules: [],
          },
          memberUserIds: groupForm.memberUserIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not preview this group.");
      setGroupPreview(Array.isArray(body.result) ? body.result : []);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message ?? "Could not preview group members.", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function sendChatMessage() {
    if (!selectedChannelId || !messageBody.trim()) return;
    try {
      const attachments =
        channelMessageFiles.length > 0
          ? await Promise.all(
              channelMessageFiles.map(async (file) => {
                const upload = await uploadPrivateFile(file, "team-chat");
                return {
                  url: upload.url,
                  s3Key: upload.key,
                  fileName: file.name,
                  mimeType: upload.mimeType ?? file.type,
                };
              })
            )
          : [];
      const res = await fetch(`/api/chat/channels/${selectedChannelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: messageBody, attachments }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send message.");
      setMessageBody("");
      setChannelMessageFiles([]);
      await loadMessages(selectedChannelId);
      await load({ silent: true });
    } catch (err: any) {
      toast({ title: "Message failed", description: err.message ?? "Could not send message.", variant: "destructive" });
    }
  }

  async function updateMessage(messageId: string, payload: Record<string, unknown>, successTitle?: string) {
    try {
      const res = await fetch(`/api/chat/channels/${selectedChannelId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update message.");
      if (successTitle) toast({ title: successTitle });
      setEditingMessageId("");
      setEditingMessageBody("");
      await loadMessages(selectedChannelId);
      await load({ silent: true });
    } catch (err: any) {
      toast({ title: "Chat update failed", description: err.message ?? "Try again.", variant: "destructive" });
    }
  }

  const staff = useMemo(() => (data?.directory ?? []).filter((row: any) => row.role === "CLEANER" || row.role === "LAUNDRY" || row.role === "OPS_MANAGER" || row.role === "ADMIN"), [data]);
  const frontline = useMemo(() => (data?.directory ?? []).filter((row: any) => row.role === "CLEANER" || row.role === "LAUNDRY"), [data]);
  const groups = data?.groups ?? [];
  const learningPaths = data?.learningPaths ?? [];
  const filteredDocuments = useMemo(
    () =>
      (data?.documents ?? []).filter((doc: any) => {
        const categoryOk = docFilters.category === "ALL" || doc.category === docFilters.category;
        const userOk = docFilters.userId === "ALL" || doc.userId === docFilters.userId;
        const expiryOk = docFilters.expiryStatus === "ALL" || doc.expiryStatus === docFilters.expiryStatus;
        return categoryOk && userOk && expiryOk;
      }),
    [data, docFilters]
  );
  const hiringStatuses = ["NEW", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"];

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading workforce hub...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Workforce Hub</h2>
          <p className="text-sm text-muted-foreground">Groups, chat, updates, onboarding, staff docs, recognition, and hiring.</p>
        </div>
        <Button variant="outline" onClick={() => void load({ silent: true })}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Users} label="Active staff" value={String(staff.length)} />
        <SummaryCard icon={Megaphone} label="Posts" value={String(data?.posts?.length ?? 0)} />
        <SummaryCard icon={GraduationCap} label="Learning assignments" value={String(data?.learningAssignments?.length ?? 0)} />
        <SummaryCard icon={Briefcase} label="Hiring applications" value={String(data?.hiring?.applications?.length ?? 0)} />
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="recognition">Recognition</TabsTrigger>
          <TabsTrigger value="hiring">Hiring</TabsTrigger>
        </TabsList>
        <TabsContent value="groups" className="grid gap-4 xl:grid-cols-[440px,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{editingGroupId ? "Edit Group" : "Create Group"}</CardTitle>
              <CardDescription>Build smart workforce groups, preview who matches, and keep a linked chat room when needed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Group name</Label>
                <Input value={groupForm.name} onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={groupForm.description} onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={groupForm.category} onValueChange={(value) => setGroupForm((current) => ({ ...current, category: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GENERAL">General</SelectItem>
                      <SelectItem value="LOCATION">Location</SelectItem>
                      <SelectItem value="DEPARTMENT">Department</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Membership mode</Label>
                  <Select value={groupForm.membershipMode} onValueChange={(value) => setGroupForm((current) => ({ ...current, membershipMode: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SMART">Smart</SelectItem>
                      <SelectItem value="MANUAL">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="flex flex-wrap gap-2">
                  {["ADMIN", "OPS_MANAGER", "CLEANER", "LAUNDRY"].map((role) => (
                    <label key={role} className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs">
                      <Checkbox checked={groupForm.roles.includes(role)} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, roles: checked ? toggleValue(current.roles, role) : current.roles.filter((item) => item !== role) }))} />
                      {prettifyLabel(role)}
                    </label>
                  ))}
                </div>
              </div>
              {groupForm.membershipMode === "SMART" ? (
                <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                  <div className="space-y-2">
                    <Label>Departments</Label>
                    <Input placeholder="Cleaning, Laundry" value={groupForm.departments} onChange={(event) => setGroupForm((current) => ({ ...current, departments: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Locations</Label>
                    <Input placeholder="Parramatta, CBD, North Shore" value={groupForm.locations} onChange={(event) => setGroupForm((current) => ({ ...current, locations: event.target.value }))} />
                  </div>
                  <div className="rounded-xl border bg-white p-3 text-xs text-muted-foreground">
                    Smart rule preview uses role, department, and location matching together. Save a group after preview to lock the current logic.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Manual members</Label>
                  <ScrollArea className="h-48 rounded-xl border p-3">
                    <div className="space-y-2">
                      {staff.map((user: any) => (
                        <label key={user.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                          <span>
                            {user.name || user.email}
                            <span className="ml-2 text-xs text-muted-foreground">{prettifyLabel(user.role)}</span>
                          </span>
                          <Checkbox checked={groupForm.memberUserIds.includes(user.id)} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, memberUserIds: checked ? toggleValue(current.memberUserIds, user.id) : current.memberUserIds.filter((item) => item !== user.id) }))} />
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={groupForm.createChatChannel} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, createChatChannel: checked === true }))} />
                Create linked group chat
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={previewLoading} onClick={() => void previewGroupMembers()}>
                  <Users className="mr-2 h-4 w-4" />{previewLoading ? "Previewing" : "Preview members"}
                </Button>
                <Button
                  disabled={saving || !groupForm.name.trim()}
                  onClick={async () => {
                    const payload = {
                      action: editingGroupId ? "UPDATE_GROUP" : "CREATE_GROUP",
                      groupId: editingGroupId || undefined,
                      ...groupForm,
                      smartRules: {
                        logic: "AND",
                        roles: groupForm.roles,
                        departments: splitCsv(groupForm.departments),
                        locations: splitCsv(groupForm.locations),
                        rules: [],
                      },
                    };
                    const ok = await runAction(payload, editingGroupId ? "Group updated" : "Group created");
                    if (ok) resetGroupEditor();
                  }}
                >
                  {editingGroupId ? "Save changes" : "Save group"}
                </Button>
                {editingGroupId ? (
                  <Button variant="outline" onClick={resetGroupEditor}>
                    <X className="mr-2 h-4 w-4" />Cancel
                  </Button>
                ) : null}
              </div>

              <div className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Preview members</p>
                    <p className="text-xs text-muted-foreground">Check the current match before saving.</p>
                  </div>
                  <Badge variant="secondary">{groupPreview.length}</Badge>
                </div>
                <ScrollArea className="mt-3 h-52">
                  <div className="space-y-2 pr-3">
                    {groupPreview.length > 0 ? groupPreview.map((member: any) => (
                      <div key={member.id} className="rounded-xl border px-3 py-2">
                        <p className="text-sm font-medium">{member.name || member.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {[member.role && prettifyLabel(member.role), member.department, member.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No preview loaded yet.</p>}
                  </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Existing Groups</CardTitle>
              <CardDescription>Each group shows current membership, smart-rule output, and workforce stats for quick decisions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(groups as any[]).map((group) => (
                <div key={group.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{group.name}</p>
                    <Badge variant="outline">{prettifyLabel(group.category)}</Badge>
                    <Badge variant="secondary">{group.memberCount} members</Badge>
                    <Badge variant="outline">{prettifyLabel(group.membershipMode)}</Badge>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => startGroupEdit(group)}>
                      <Pencil className="mr-2 h-4 w-4" />Edit
                    </Button>
                  </div>
                  {group.description ? <p className="mt-2 text-sm text-muted-foreground">{group.description}</p> : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Avg QA</p>
                      <p className="mt-1 text-lg font-semibold">{group.stats?.averageQaScore ?? "-"}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active jobs</p>
                      <p className="mt-1 text-lg font-semibold">{group.stats?.activeJobsCount ?? 0}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Recent recognition</p>
                      <p className="mt-1 text-lg font-semibold">{group.stats?.recentRecognitions ?? 0}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Members</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(group.previewMembers ?? []).map((member: any) => (
                        <Badge key={member.id} variant="outline">{member.name || member.id}</Badge>
                      ))}
                    </div>
                    {(group.members?.length ?? 0) > 0 ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        {group.members.slice(0, 10).map((member: any) => member.email || member.name).join(", ")}
                        {group.members.length > 10 ? " ..." : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="updates" className="grid gap-4 xl:grid-cols-[460px,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{editingPostId ? "Edit Update" : "Publish Update"}</CardTitle>
              <CardDescription>Target one or many audiences, schedule dispatch, and add media so updates read like real team posts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={postForm.title} onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea className="min-h-36" value={postForm.body} onChange={(event) => setPostForm((current) => ({ ...current, body: event.target.value }))} />
                <p className="text-xs text-muted-foreground">Markdown-friendly input. Staff will see line breaks, bullets, and attachment cards.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Audience type</Label>
                  <Select value={postForm.audienceType} onValueChange={(value) => setPostForm((current) => ({ ...current, audienceType: value, audienceValues: [] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everyone</SelectItem>
                      <SelectItem value="group">Groups</SelectItem>
                      <SelectItem value="role">Roles</SelectItem>
                      <SelectItem value="user">Specific people</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Schedule publish time</Label>
                  <Input type="datetime-local" value={postForm.publishAt} onChange={(event) => setPostForm((current) => ({ ...current, publishAt: event.target.value }))} />
                </div>
              </div>
              {postForm.audienceType !== "all" ? (
                <div className="space-y-2">
                  <Label>Audience targets</Label>
                  <ScrollArea className="h-44 rounded-xl border p-3">
                    <div className="space-y-2 pr-3">
                      {(postForm.audienceType === "group"
                        ? groups.map((group: any) => ({ id: group.id, label: `${group.name} (${group.memberCount})` }))
                        : postForm.audienceType === "role"
                          ? ["ADMIN", "OPS_MANAGER", "CLEANER", "LAUNDRY"].map((role) => ({ id: role, label: prettifyLabel(role) }))
                          : staff.map((user: any) => ({ id: user.id, label: `${user.name || user.email} · ${prettifyLabel(user.role)}` }))
                      ).map((item: any) => (
                        <label key={item.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                          <span>{item.label}</span>
                          <Checkbox checked={postForm.audienceValues.includes(item.id)} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, audienceValues: checked ? toggleValue(current.audienceValues, item.id) : current.audienceValues.filter((value) => value !== item.id) }))} />
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground">{postForm.audienceValues.length} target(s) selected.</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Post image</Label>
                <Input
                  type="file"
                  accept="image/*"
                  disabled={postImageUploading}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      setPostImageUploading(true);
                      const upload = await uploadPrivateFile(file, "team-updates");
                      setPostForm((current) => ({ ...current, coverImageUrl: upload.url ?? "" }));
                      toast({ title: "Image uploaded" });
                    } catch (err: any) {
                      toast({ title: "Upload failed", description: err.message ?? "Could not upload image.", variant: "destructive" });
                    } finally {
                      setPostImageUploading(false);
                      event.target.value = "";
                    }
                  }}
                />
                {postForm.coverImageUrl ? (
                  <div className="overflow-hidden rounded-2xl border bg-slate-100">
                    <img src={postForm.coverImageUrl} alt="Post preview" className="aspect-[16/10] w-full object-cover" />
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Attachments</Label>
                <Input type="file" multiple onChange={(event) => setPostFiles(Array.from(event.target.files ?? []))} />
                {postFiles.length > 0 ? <Badge variant="outline"><Paperclip className="mr-1 h-3 w-3" />{postFiles.length} file(s) ready</Badge> : null}
                {postForm.attachments.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {postForm.attachments.map((attachment) => (
                      <div key={attachment.url} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs">
                        <span className="truncate">{attachment.fileName || attachment.url}</span>
                        <Button size="sm" variant="ghost" onClick={() => setPostForm((current) => ({ ...current, attachments: current.attachments.filter((item) => item.url !== attachment.url) }))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={postForm.pinned} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, pinned: checked === true }))} />
                Pin on dashboards
              </label>
              <div className="rounded-2xl border bg-muted/20 p-4">
                <p className="text-sm font-semibold">Preview</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{postForm.body || "Write a message to preview it here."}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={saving || !postForm.title.trim() || !postForm.body.trim() || (postForm.audienceType !== "all" && postForm.audienceValues.length === 0)}
                  onClick={async () => {
                    const uploads =
                      postFiles.length > 0
                        ? await Promise.all(
                            postFiles.map(async (file) => {
                              const upload = await uploadPrivateFile(file, "team-updates");
                              return {
                                url: upload.url,
                                s3Key: upload.key,
                                fileName: file.name,
                                mimeType: upload.mimeType ?? file.type,
                              };
                            })
                          )
                        : [];
                    const payload = {
                      action: editingPostId ? "UPDATE_POST" : "CREATE_POST",
                      postId: editingPostId || undefined,
                      title: postForm.title,
                      body: postForm.body,
                      pinned: postForm.pinned,
                      coverImageUrl: postForm.coverImageUrl,
                      publishAt: postForm.publishAt || null,
                      attachments: [...postForm.attachments, ...uploads],
                      audience:
                        postForm.audienceType === "all"
                          ? { all: true }
                          : postForm.audienceType === "group"
                            ? { groupIds: postForm.audienceValues }
                            : postForm.audienceType === "role"
                              ? { roles: postForm.audienceValues }
                              : { userIds: postForm.audienceValues },
                    };
                    const ok = await runAction(payload, editingPostId ? "Update saved" : "Update published");
                    if (ok) resetPostEditor();
                  }}
                >
                  {editingPostId ? "Save changes" : "Publish"}
                </Button>
                {editingPostId ? (
                  <Button variant="outline" onClick={resetPostEditor}>
                    <X className="mr-2 h-4 w-4" />Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent Updates</CardTitle>
              <CardDescription>Pinned items surface across staff dashboards. Seen counts confirm who has read the dispatch.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(data?.posts ?? []).map((post: any) => (
                <div key={post.id} className="space-y-3 rounded-3xl border bg-white/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {post.pinned ? <Badge variant="warning"><Pin className="mr-1 h-3 w-3" />Pinned</Badge> : null}
                      {post.publishAt ? <Badge variant="outline">Publishes {new Date(post.publishAt).toLocaleString("en-AU")}</Badge> : <Badge variant="outline">Immediate</Badge>}
                      <Badge variant="secondary"><Bell className="mr-1 h-3 w-3" />Seen {post.seenCount ?? 0}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => startPostEdit(post)}>
                      <Pencil className="mr-2 h-4 w-4" />Edit
                    </Button>
                  </div>
                  <WorkforcePostCard post={post} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="chat" className="grid gap-4 xl:grid-cols-[360px,1fr]">
          <Card>
            <CardHeader><CardTitle>Channels</CardTitle><CardDescription>Create and manage group chats or direct conversations.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Chat type</Label>
                <Select value={channelForm.kind} onValueChange={(value) => setChannelForm((current) => ({ ...current, kind: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GROUP">Group channel</SelectItem>
                    <SelectItem value="DIRECT">Direct chat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {channelForm.kind === "GROUP" ? (
                <>
                  <div className="space-y-2"><Label>Name</Label><Input value={channelForm.name} onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))} /></div>
                  <div className="space-y-2"><Label>Description</Label><Textarea value={channelForm.description} onChange={(event) => setChannelForm((current) => ({ ...current, description: event.target.value }))} /></div>
                  <div className="space-y-2">
                    <Label>Linked group</Label>
                    <Select value={channelForm.groupId} onValueChange={(value) => setChannelForm((current) => ({ ...current, groupId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                      <SelectContent>{groups.map((group: any) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button disabled={saving || !channelForm.name.trim() || !channelForm.groupId} onClick={() => void runAction({ action: "CREATE_CHANNEL", ...channelForm }, "Channel created")}>Create channel</Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Start direct chat with</Label>
                    <Select value={channelForm.otherUserId} onValueChange={(value) => setChannelForm((current) => ({ ...current, otherUserId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                      <SelectContent>{staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button disabled={saving || !channelForm.otherUserId} onClick={async () => {
                    const result = await runAction({ action: "OPEN_DIRECT_CHAT", otherUserId: channelForm.otherUserId }, "Direct chat ready");
                    if (result?.result?.id) setSelectedChannelId(result.result.id);
                  }}>Open direct chat</Button>
                </>
              )}
              <ScrollArea className="h-[480px]">
                <div className="space-y-2 pr-3">
                  {(data?.channels ?? []).map((channel: any) => (
                    <button key={channel.id} type="button" className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedChannelId === channel.id ? "border-primary bg-primary/5" : "bg-white/80"}`} onClick={() => setSelectedChannelId(channel.id)}>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{channel.name}</p>
                        {channel.unreadCount > 0 ? <Badge variant="destructive">{channel.unreadCount}</Badge> : null}
                        {channel.pinnedCount > 0 ? <Badge variant="outline"><Pin className="mr-1 h-3 w-3" />{channel.pinnedCount}</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{channel.description || prettifyLabel(channel.kind)}</p>
                      {channel.lastMessage ? <p className="mt-2 line-clamp-2 text-xs text-slate-500">{channel.lastMessage.senderName || "Team"} · {channel.lastMessage.body}</p> : null}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Conversation</CardTitle><CardDescription>Polling-based team chat with attachments, pinning, and moderation controls.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {selectedChannel ? (
                <div className="rounded-2xl border bg-muted/20 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Channel name</Label>
                      <Input value={channelEditForm.name} onChange={(event) => setChannelEditForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input value={channelEditForm.description} onChange={(event) => setChannelEditForm((current) => ({ ...current, description: event.target.value }))} />
                    </div>
                  </div>
                  {selectedChannel.kind === "DIRECT" ? (
                    <div className="mt-4 space-y-2">
                      <Label>Direct chat members</Label>
                      <div className="flex flex-wrap gap-2">
                        {staff.map((user: any) => (
                          <label key={user.id} className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-xs">
                            <Checkbox checked={channelEditForm.memberUserIds.includes(user.id)} onCheckedChange={(checked) => setChannelEditForm((current) => ({ ...current, memberUserIds: checked ? toggleValue(current.memberUserIds, user.id) : current.memberUserIds.filter((item) => item !== user.id) }))} />
                            {user.name || user.email}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" onClick={async () => {
                      try {
                        const res = await fetch(`/api/admin/chat/channels/${selectedChannel.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(channelEditForm),
                        });
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(body.error ?? "Could not update channel.");
                        toast({ title: "Channel updated" });
                        await load({ silent: true });
                      } catch (err: any) {
                        toast({ title: "Update failed", description: err.message ?? "Could not update channel.", variant: "destructive" });
                      }
                    }}>
                      Save channel settings
                    </Button>
                  </div>
                </div>
              ) : null}
              <ScrollArea className="h-[420px] rounded-2xl border bg-white/80 p-4">
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className={`rounded-2xl border bg-white p-3 shadow-sm ${message.isPinned ? "border-amber-300 bg-amber-50/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{message.sender?.name || message.sender?.role || "Team"}</span>
                        <div className="flex items-center gap-2">
                          {message.isPinned ? <Badge variant="warning"><Pin className="mr-1 h-3 w-3" />Pinned</Badge> : null}
                          <span>{new Date(message.createdAt).toLocaleString("en-AU")}</span>
                        </div>
                      </div>
                      {editingMessageId === message.id ? (
                        <div className="mt-2 space-y-2">
                          <Textarea value={editingMessageBody} onChange={(event) => setEditingMessageBody(event.target.value)} />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void updateMessage(message.id, { body: editingMessageBody }, "Message updated")}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => { setEditingMessageId(""); setEditingMessageBody(""); }}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                      )}
                      {(message.attachments?.length ?? 0) > 0 ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {message.attachments.map((attachment: any) => {
                            const isImage = String(attachment.mimeType ?? "").startsWith("image/");
                            return (
                              <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border bg-slate-50">
                                {isImage ? <img src={attachment.url} alt={attachment.fileName || "Attachment"} className="aspect-[4/3] w-full object-cover" /> : null}
                                <div className="p-3 text-xs text-slate-600">{attachment.fileName || attachment.label || "Attachment"}</div>
                              </a>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setEditingMessageId(message.id); setEditingMessageBody(message.body || ""); }}>
                          <Pencil className="mr-2 h-4 w-4" />Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void updateMessage(message.id, { pin: !message.isPinned }, message.isPinned ? "Message unpinned" : "Message pinned")}>
                          <Pin className="mr-2 h-4 w-4" />{message.isPinned ? "Unpin" : "Pin"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void updateMessage(message.id, { delete: true }, "Message removed")}>
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="space-y-2">
                <Textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Send a message to this channel" />
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="file" multiple className="max-w-sm" onChange={(event) => setChannelMessageFiles(Array.from(event.target.files ?? []))} />
                  {channelMessageFiles.length > 0 ? <Badge variant="outline"><Paperclip className="mr-1 h-3 w-3" />{channelMessageFiles.length} file(s) ready</Badge> : null}
                </div>
                <Button disabled={!selectedChannelId || !messageBody.trim()} onClick={() => void sendChatMessage()}>
                  <MessageCircle className="mr-2 h-4 w-4" />Send message
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="learning" className="grid gap-4 xl:grid-cols-[460px,1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{editingLearningPathId ? "Edit Learning Path" : "Create Learning Path"}</CardTitle>
                <CardDescription>Build courses or assessments, publish them, and mark mandatory paths for automatic onboarding.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Title</Label><Input value={learningEditor.title} onChange={(event) => setLearningEditor((current) => ({ ...current, title: event.target.value }))} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Slug</Label><Input value={learningEditor.slug} onChange={(event) => setLearningEditor((current) => ({ ...current, slug: event.target.value }))} /></div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={learningEditor.type} onValueChange={(value) => setLearningEditor((current) => ({ ...current, type: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COURSE">Course</SelectItem>
                        <SelectItem value="ASSESSMENT">Assessment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2"><Label>Description</Label><Textarea value={learningEditor.description} onChange={(event) => setLearningEditor((current) => ({ ...current, description: event.target.value }))} /></div>
                <div className="space-y-2">
                  <Label>Cover image</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const upload = await uploadPrivateFile(file, "learning-paths");
                        setLearningEditor((current) => ({ ...current, coverImageUrl: upload.url ?? "" }));
                        toast({ title: "Cover image uploaded" });
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message ?? "Could not upload image.", variant: "destructive" });
                      } finally {
                        event.target.value = "";
                      }
                    }}
                  />
                  {learningEditor.coverImageUrl ? <img src={learningEditor.coverImageUrl} alt="Learning cover" className="h-40 w-full rounded-2xl object-cover" /> : null}
                </div>
                <div className="space-y-2">
                  <Label>Audience roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {["ADMIN", "OPS_MANAGER", "CLEANER", "LAUNDRY"].map((role) => (
                      <label key={role} className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs">
                        <Checkbox checked={learningEditor.audienceRoles.includes(role)} onCheckedChange={(checked) => setLearningEditor((current) => ({ ...current, audienceRoles: checked ? toggleValue(current.audienceRoles, role) : current.audienceRoles.filter((item) => item !== role) }))} />
                        {prettifyLabel(role)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={learningEditor.isPublished} onCheckedChange={(checked) => setLearningEditor((current) => ({ ...current, isPublished: checked === true }))} />Published</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={learningEditor.mandatory} onCheckedChange={(checked) => setLearningEditor((current) => ({ ...current, mandatory: checked === true }))} />Mandatory onboarding path</label>
                </div>
                <div className="space-y-2">
                  <Label>Schema JSON</Label>
                  <Textarea className="min-h-64 font-mono text-xs" value={learningEditor.schemaText} onChange={(event) => setLearningEditor((current) => ({ ...current, schemaText: event.target.value }))} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={async () => {
                    try {
                      const schema = JSON.parse(learningEditor.schemaText || "{}");
                      const audience = { roles: learningEditor.audienceRoles };
                      const payload = {
                        action: editingLearningPathId ? "UPDATE_LEARNING_PATH" : "CREATE_LEARNING_PATH",
                        pathId: editingLearningPathId || undefined,
                        title: learningEditor.title,
                        slug: learningEditor.slug || null,
                        type: learningEditor.type,
                        description: learningEditor.description,
                        coverImageUrl: learningEditor.coverImageUrl || null,
                        isPublished: learningEditor.isPublished,
                        mandatory: learningEditor.mandatory,
                        audience,
                        schema,
                      };
                      const ok = await runAction(payload, editingLearningPathId ? "Learning path updated" : "Learning path created");
                      if (ok) resetLearningEditor();
                    } catch (err: any) {
                      toast({ title: "Schema invalid", description: err.message ?? "Check the learning schema JSON.", variant: "destructive" });
                    }
                  }} disabled={saving || !learningEditor.title.trim()}>
                    {editingLearningPathId ? "Save path" : "Create path"}
                  </Button>
                  {editingLearningPathId ? <Button variant="outline" onClick={resetLearningEditor}><X className="mr-2 h-4 w-4" />Cancel</Button> : null}
                </div>
                <div className="rounded-2xl border bg-amber-50/70 p-4 text-sm text-amber-900">Cleaner readiness scoring is an operational readiness measure. It is not presented to staff as a literal IQ score.</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Assign Learning</CardTitle><CardDescription>Assign published paths to one person, a group, or a role.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Learning path</Label><Select value={learningForm.pathId} onValueChange={(value) => setLearningForm((current) => ({ ...current, pathId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{learningPaths.map((path: any) => <SelectItem key={path.id} value={path.id}>{path.title}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Target type</Label><Select value={learningForm.targetType} onValueChange={(value) => setLearningForm((current) => ({ ...current, targetType: value, targetValue: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">Specific user</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="role">Role</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Target</Label><Select value={learningForm.targetValue} onValueChange={(value) => setLearningForm((current) => ({ ...current, targetValue: value }))}><SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger><SelectContent>{learningForm.targetType === "user" ? frontline.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>) : learningForm.targetType === "group" ? groups.map((group: any) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>) : ["CLEANER", "LAUNDRY"].map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={learningForm.restart} onCheckedChange={(checked) => setLearningForm((current) => ({ ...current, restart: checked === true }))} />Reset previous progress if already assigned</label>
                <Button disabled={saving || !learningForm.pathId || !learningForm.targetValue} onClick={() => void runAction({ action: "ASSIGN_LEARNING", pathId: learningForm.pathId, userIds: learningForm.targetType === "user" ? [learningForm.targetValue] : [], groupIds: learningForm.targetType === "group" ? [learningForm.targetValue] : [], roles: learningForm.targetType === "role" ? [learningForm.targetValue] : [], restart: learningForm.restart }, "Learning assigned")}>Assign</Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Library and Results</CardTitle><CardDescription>Edit learning paths, then review assignment outcomes and coaching predictions.</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {learningPaths.map((path: any) => (
                  <div key={path.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{path.title}</p>
                      <Badge variant="outline">{prettifyLabel(path.type)}</Badge>
                      {path.isPublished ? <Badge variant="success">Published</Badge> : <Badge variant="secondary">Draft</Badge>}
                      {path.mandatory ? <Badge variant="warning">Mandatory</Badge> : null}
                      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => startLearningEdit(path)}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </Button>
                    </div>
                    {path.description ? <p className="mt-2 text-sm text-muted-foreground">{path.description}</p> : null}
                    <p className="mt-2 text-xs text-muted-foreground">Slug: {path.slug}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                {(data?.learningAssignments ?? []).map((assignment: any) => (
                  <div key={assignment.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{assignment.user?.name || assignment.user?.id}</p>
                      <Badge variant="outline">{assignment.path?.title}</Badge>
                      <Badge variant={assignment.status === "COMPLETED" ? "success" : "secondary"}>{assignment.status}</Badge>
                      {typeof assignment.score === "number" ? <Badge variant="warning">{Math.round(assignment.score)}%</Badge> : null}
                    </div>
                    {assignment.evaluation?.band ? <p className="mt-2 text-sm">{assignment.evaluation.band} · {assignment.evaluation.prediction}</p> : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {assignment.path?.mandatory ? "Mandatory path" : "Optional path"} · Updated {new Date(assignment.updatedAt).toLocaleString("en-AU")}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents" className="grid gap-4 xl:grid-cols-[440px,1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Upload Staff Document</CardTitle><CardDescription>Store police checks, licences, white cards, CVs, insurance, and signed policies.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Staff member</Label><Select value={docForm.userId} onValueChange={(value) => setDocForm((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Category</Label><Select value={docForm.category} onValueChange={(value) => setDocForm((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"].map((item) => <SelectItem key={item} value={item}>{prettifyLabel(item)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Expiry date</Label><Input type="date" value={docForm.expiresAt} onChange={(event) => setDocForm((current) => ({ ...current, expiresAt: event.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label>Title</Label><Input value={docForm.title} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Notes</Label><Textarea value={docForm.notes} onChange={(event) => setDocForm((current) => ({ ...current, notes: event.target.value }))} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Linked request</Label>
                    <Select value={docForm.requestId || "none"} onValueChange={(value) => setDocForm((current) => ({ ...current, requestId: value === "none" ? "" : value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(data?.documentRequests ?? []).filter((request: any) => !docForm.userId || request.userId === docForm.userId).map((request: any) => (
                          <SelectItem key={request.id} value={request.id}>{request.title} · {request.user?.name || request.userId}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 self-end text-sm"><Checkbox checked={docForm.requiresSignature} onCheckedChange={(checked) => setDocForm((current) => ({ ...current, requiresSignature: checked === true }))} />Requires signature after review</label>
                </div>
                <div className="space-y-2"><Label>File</Label><Input type="file" onChange={(event) => setDocFile(event.target.files?.[0] ?? null)} /></div>
                <Button disabled={saving || !docForm.userId || !docFile} onClick={async () => {
                  try {
                    setSaving(true);
                    const upload = await uploadPrivateFile(docFile!, "staff-documents");
                    await runAction({ action: "UPLOAD_DOCUMENT", ...docForm, fileName: docFile!.name, s3Key: upload.key, url: upload.url, mimeType: upload.mimeType ?? docFile!.type }, "Document uploaded");
                    setDocFile(null);
                  } finally {
                    setSaving(false);
                  }
                }}>Upload document</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Request Document</CardTitle><CardDescription>Ask staff to upload missing or refreshed compliance files.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Staff member</Label><Select value={docRequestForm.userId} onValueChange={(value) => setDocRequestForm((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Category</Label><Select value={docRequestForm.category} onValueChange={(value) => setDocRequestForm((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"].map((item) => <SelectItem key={item} value={item}>{prettifyLabel(item)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Due date</Label><Input type="date" value={docRequestForm.dueAt} onChange={(event) => setDocRequestForm((current) => ({ ...current, dueAt: event.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label>Title</Label><Input value={docRequestForm.title} onChange={(event) => setDocRequestForm((current) => ({ ...current, title: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Notes</Label><Textarea value={docRequestForm.notes} onChange={(event) => setDocRequestForm((current) => ({ ...current, notes: event.target.value }))} /></div>
                <Button disabled={saving || !docRequestForm.userId || !docRequestForm.title.trim()} onClick={async () => {
                  const ok = await runAction({ action: "REQUEST_DOCUMENT", ...docRequestForm, dueAt: docRequestForm.dueAt || null }, "Document request sent");
                  if (ok) setDocRequestForm({ userId: "", category: "POLICE_CHECK", title: "", notes: "", dueAt: "" });
                }}>Send request</Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Compliance Library</CardTitle><CardDescription>Filter, verify, reject, and track requested documents from one screen.</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2"><Label>Category</Label><Select value={docFilters.category} onValueChange={(value) => setDocFilters((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All</SelectItem>{["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"].map((item) => <SelectItem key={item} value={item}>{prettifyLabel(item)}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Staff member</Label><Select value={docFilters.userId} onValueChange={(value) => setDocFilters((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All</SelectItem>{staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Expiry</Label><Select value={docFilters.expiryStatus} onValueChange={(value) => setDocFilters((current) => ({ ...current, expiryStatus: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All</SelectItem><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="EXPIRING_SOON">Expiring soon</SelectItem><SelectItem value="EXPIRED">Expired</SelectItem></SelectContent></Select></div>
              </div>
              {(data?.documentRequests ?? []).length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Document requests</p>
                  {(data?.documentRequests ?? []).slice(0, 8).map((request: any) => (
                    <div key={request.id} className="rounded-2xl border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{request.title}</p>
                        <Badge variant={request.status === "FULFILLED" ? "success" : "warning"}>{prettifyLabel(request.status)}</Badge>
                        <Badge variant="outline">{request.user?.name || request.userId}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Requested by {request.requestedBy?.name || "Admin"}
                        {request.dueAt ? ` · Due ${String(request.dueAt).slice(0, 10)}` : ""}
                        {request.fulfilledDocument ? ` · Fulfilled by ${request.fulfilledDocument.title}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="space-y-4">
                {filteredDocuments.map((doc: any) => (
                  <div key={doc.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{doc.title}</p>
                      <Badge variant="outline">{prettifyLabel(doc.category)}</Badge>
                      <Badge variant={doc.status === "VERIFIED" || doc.status === "SIGNED" ? "success" : doc.status === "REJECTED" || doc.status === "EXPIRED" ? "destructive" : "warning"}>{prettifyLabel(doc.status)}</Badge>
                      {doc.expiryStatus === "EXPIRED" ? <Badge variant="destructive">Expired</Badge> : doc.expiryStatus === "EXPIRING_SOON" ? <Badge variant="warning">Expiring soon</Badge> : null}
                      {doc.requiresSignature ? <Badge variant="outline">Signature required</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{doc.user?.name || doc.userId} · {doc.fileName}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex rounded-full border px-3 py-2 text-xs font-medium">Open file</a>
                      <Button size="sm" variant="outline" onClick={() => void runAction({ action: "REVIEW_DOCUMENT", documentId: doc.id, status: "VERIFIED", notes: doc.notes ?? null, expiresAt: doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : null, requiresSignature: doc.requiresSignature === true }, "Document verified")}>Verify</Button>
                      <Button size="sm" variant="destructive" onClick={() => void runAction({ action: "REVIEW_DOCUMENT", documentId: doc.id, status: "REJECTED", notes: doc.notes ?? null, expiresAt: doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : null, requiresSignature: doc.requiresSignature === true }, "Document reviewed")}>Reject</Button>
                    </div>
                    {(doc.fulfilledRequests?.length ?? 0) > 0 ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        Linked request: {doc.fulfilledRequests.map((request: any) => request.title).join(", ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recognition" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Send Recognition</CardTitle><CardDescription>Celebrate top performers and publish shout-outs to the team.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label>Staff member</Label><Select value={recognitionForm.userId} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{frontline.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Title</Label><Input value={recognitionForm.title} onChange={(event) => setRecognitionForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Guest-ready consistency" /></div>
                <div className="space-y-2"><Label>Message</Label><Textarea value={recognitionForm.message} onChange={(event) => setRecognitionForm((current) => ({ ...current, message: event.target.value }))} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Badge</Label><Select value={recognitionForm.badgeKey} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, badgeKey: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["quality_star", "spotless", "reliable", "client_fave", "safety_first", "initiative", "milestone_10", "milestone_50", "milestone_100"].map((item) => <SelectItem key={item} value={item}>{prettifyLabel(item)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Style</Label><Select value={recognitionForm.celebrationStyle} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, celebrationStyle: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["SPOTLIGHT", "TEAM_SHOUTOUT", "GOLD_STAR", "MILESTONE"].map((item) => <SelectItem key={item} value={item}>{prettifyLabel(item)}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={recognitionForm.isPublic} onCheckedChange={(checked) => setRecognitionForm((current) => ({ ...current, isPublic: checked === true }))} />Share publicly as a team post</label>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={saving || !recognitionForm.userId || !recognitionForm.title.trim()} onClick={() => void runAction({ action: "SEND_RECOGNITION", ...recognitionForm }, "Recognition sent")}>Send recognition</Button>
                  <Button variant="outline" disabled={saving} onClick={() => void runAction({ action: "RUN_RECOGNITION_CHECK" }, "Auto-recognition check complete")}>
                    <Sparkles className="mr-2 h-4 w-4" />Run auto badges now
                  </Button>
                </div>
              </CardContent>
            </Card>
            {data?.recognition?.spotlight ? (
              <Card>
                <CardHeader><CardTitle>Current Spotlight</CardTitle><CardDescription>Pinned public recognition from the last 7 days.</CardDescription></CardHeader>
                <CardContent>
                  <div className="rounded-2xl border bg-amber-50/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Award className="h-5 w-5 text-amber-600" />
                      <p className="font-semibold">{data.recognition.spotlight.title}</p>
                      <Badge variant="warning">{prettifyLabel(data.recognition.spotlight.badgeKey || "spotlight")}</Badge>
                    </div>
                    <p className="mt-2 text-sm">{data.recognition.spotlight.message || "Recognition spotlight"}</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
          <Card>
            <CardHeader><CardTitle>Recognition Board</CardTitle><CardDescription>Promotion signals, leaderboards, and the public wall update from live workforce data.</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <LeaderboardCard title="Top QA" rows={data?.recognition?.leaderboard?.qa ?? []} valueKey="qaAverage" suffix="%" />
                <LeaderboardCard title="Most Jobs This Month" rows={data?.recognition?.leaderboard?.completed ?? []} valueKey="monthJobsCompleted" />
                <LeaderboardCard title="Most Recognised" rows={data?.recognition?.leaderboard?.recognition ?? []} valueKey="recognitionsReceived" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  {(data?.recognition?.board ?? []).map((row: any) => (
                    <div key={row.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{row.name || row.email}</p>
                        {typeof row.qaStars === "number" ? <Badge variant="warning">{row.qaStars.toFixed(1)} / 5</Badge> : null}
                        <Badge variant="outline">{row.readinessLabel}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">QA average: {row.qaAverage ?? "-"}% · Reviews: {row.qaReviewCount} · Public recognitions: {row.publicRecognitionCount}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <p className="text-sm font-semibold">Public wall</p>
                  {(data?.recognition?.publicWall ?? []).map((item: any) => (
                    <div key={item.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{item.user?.name || "Team member"}</p>
                        <Badge variant="outline">{prettifyLabel(item.badgeKey)}</Badge>
                        <Badge variant="secondary">{prettifyLabel(item.celebrationStyle)}</Badge>
                      </div>
                      <p className="mt-2 text-sm">{item.title}</p>
                      {item.message ? <p className="mt-2 text-sm text-muted-foreground">{item.message}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hiring" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader><CardTitle>{editingPositionId ? "Edit Position" : "Create Position"}</CardTitle><CardDescription>Publish a shareable application link with structured screening steps.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Title</Label><Input value={positionForm.title} onChange={(event) => setPositionForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Public slug</Label><Input value={positionForm.slug} onChange={(event) => setPositionForm((current) => ({ ...current, slug: event.target.value }))} placeholder="cleaner-application" /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={positionForm.description} onChange={(event) => setPositionForm((current) => ({ ...current, description: event.target.value }))} placeholder="If blank, the default cleaner application description is used." /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Department</Label><Input value={positionForm.department} onChange={(event) => setPositionForm((current) => ({ ...current, department: event.target.value }))} /></div>
                <div className="space-y-2"><Label>Location</Label><Input value={positionForm.location} onChange={(event) => setPositionForm((current) => ({ ...current, location: event.target.value }))} /></div>
              </div>
              <div className="space-y-2"><Label>Employment type</Label><Input value={positionForm.employmentType} onChange={(event) => setPositionForm((current) => ({ ...current, employmentType: event.target.value }))} /></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={positionForm.isPublished} onCheckedChange={(checked) => setPositionForm((current) => ({ ...current, isPublished: checked === true }))} />Publish immediately</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={saving || !positionForm.title.trim()}
                  onClick={async () => {
                    const payload = {
                      action: editingPositionId ? "UPDATE_POSITION" : "CREATE_POSITION",
                      positionId: editingPositionId || undefined,
                      ...positionForm,
                    };
                    const ok = await runAction(payload, editingPositionId ? "Position updated" : "Position created");
                    if (ok) resetPositionEditor();
                  }}
                >
                  {editingPositionId ? "Save changes" : "Create position"}
                </Button>
                {editingPositionId ? (
                  <Button variant="outline" onClick={resetPositionEditor}>
                    <X className="mr-2 h-4 w-4" />Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Open Roles and Applications</CardTitle><CardDescription>Share the link, review applicants, and move them through the pipeline.</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {(data?.hiring?.positions ?? []).map((position: any) => (
                  <div key={position.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{position.title}</p>
                      <Badge variant={position.isPublished ? "success" : "secondary"}>{position.isPublished ? "Published" : "Draft"}</Badge>
                      <Badge variant="outline">{position._count?.applications ?? 0} applications</Badge>
                      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => startPositionEdit(position)}>
                        <Pencil className="mr-2 h-4 w-4" />Edit
                      </Button>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{position.location || "Location not set"} · {position.department || "Department not set"}</p>
                    <code className="mt-3 block rounded-xl bg-muted px-3 py-2 text-xs break-all">{resolvePublicPositionUrl(position)}</code>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => void copyText(resolvePublicPositionUrl(position), "Public link copied")}>
                        <Copy className="mr-2 h-4 w-4" />Copy link
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href={resolvePublicPositionUrl(position)} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />Open
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <p className="text-sm font-semibold">Pipeline board</p>
                <div className="grid gap-4 xl:grid-cols-4 2xl:grid-cols-7">
                  {hiringStatuses.map((status) => (
                    <div key={status} className="rounded-2xl border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{prettifyLabel(status)}</p>
                        <Badge variant="outline">{(data?.hiring?.applications ?? []).filter((item: any) => item.status === status).length}</Badge>
                      </div>
                      <div className="mt-3 space-y-3">
                        {(data?.hiring?.applications ?? []).filter((item: any) => item.status === status).map((application: any) => (
                          <div key={application.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                            <p className="font-medium">{application.fullName}</p>
                            <p className="text-xs text-muted-foreground">{application.position?.title}</p>
                            {typeof application.screeningScore === "number" ? <Badge className="mt-2" variant="warning">Score {Math.round(application.screeningScore)}</Badge> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                {(data?.hiring?.applications ?? []).map((application: any) => {
                  const review = applicationReview[application.id] ?? {
                    status: application.status,
                    notes: String(application.evaluation?.adminNotes ?? ""),
                    interviewNotes: String(application.interviewNotes ?? ""),
                    interviewDate: application.interviewDate ? new Date(application.interviewDate).toISOString().slice(0, 16) : "",
                    rejectionReason: String(application.rejectionReason ?? ""),
                    offerRole: String(application.offerDetails?.roleTitle ?? ""),
                    offerRate: application.offerDetails?.rate != null ? String(application.offerDetails.rate) : "",
                    offerStartDate: String(application.offerDetails?.startDate ?? ""),
                  };
                  return (
                    <div key={application.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{application.fullName}</p>
                        <Badge variant="outline">{application.position?.title}</Badge>
                        <Badge variant={application.status === "HIRED" ? "success" : application.status === "REJECTED" ? "destructive" : "secondary"}>{application.status}</Badge>
                        {typeof application.screeningScore === "number" ? <Badge variant="warning">Screening {Math.round(application.screeningScore)}</Badge> : null}
                        {application.hiredUser ? <Badge variant="success">Linked user: {application.hiredUser.name || application.hiredUser.email}</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{application.email}{application.phone ? ` · ${application.phone}` : ""}</p>
                      <p className="mt-2 text-sm">{application.evaluation?.fitBand || "Awaiting review"}</p>
                      {application.coverLetter ? <p className="mt-2 rounded-xl border bg-muted/20 p-3 text-sm">{application.coverLetter}</p> : null}
                      {application.resumeUrl ? <a href={application.resumeUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-full border px-3 py-2 text-xs font-medium">Open resume</a> : null}
                      {application.answers && typeof application.answers === "object" ? (
                        <div className="mt-3 rounded-2xl border bg-muted/20 p-4">
                          <p className="text-sm font-semibold">Application answers</p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {Object.entries(application.answers).map(([key, value]) => (
                              <div key={key} className="rounded-xl border bg-white px-3 py-2">
                                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{prettifyLabel(key)}</p>
                                <p className="mt-1 text-sm">{Array.isArray(value) ? value.join(", ") : String(value ?? "-")}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Status</Label>
                          <Select value={review.status} onValueChange={(value) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, status: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["NEW", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Admin notes</Label>
                          <Input value={review.notes} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, notes: event.target.value } }))} placeholder="Admin notes" />
                        </div>
                        <div className="space-y-2">
                          <Label>Interview date</Label>
                          <Input type="datetime-local" value={review.interviewDate} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, interviewDate: event.target.value } }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Interview notes</Label>
                          <Textarea rows={3} value={review.interviewNotes} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, interviewNotes: event.target.value } }))} placeholder="Interview notes" />
                        </div>
                        <div className="space-y-2">
                          <Label>Offer role</Label>
                          <Input value={review.offerRole} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, offerRole: event.target.value } }))} placeholder="Role title" />
                        </div>
                        <div className="space-y-2">
                          <Label>Offer rate</Label>
                          <Input value={review.offerRate} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, offerRate: event.target.value } }))} placeholder="$ / hr" />
                        </div>
                        <div className="space-y-2">
                          <Label>Offer start date</Label>
                          <Input type="date" value={review.offerStartDate} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, offerStartDate: event.target.value } }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Rejection reason</Label>
                          <Input value={review.rejectionReason} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, rejectionReason: event.target.value } }))} placeholder="Only if rejected" />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => void runAction({ action: "REVIEW_APPLICATION", applicationId: application.id, status: review.status, notes: review.notes, interviewNotes: review.interviewNotes, interviewDate: review.interviewDate || null, rejectionReason: review.rejectionReason || null, offerDetails: review.offerRole || review.offerRate || review.offerStartDate ? { roleTitle: review.offerRole || null, rate: review.offerRate || null, startDate: review.offerStartDate || null } : null }, "Application updated")}>Save</Button>
                        <Button variant="outline" onClick={async () => {
                          const template = review.status === "INTERVIEW" ? "interview" : review.status === "OFFER" ? "offer" : review.status === "HIRED" ? "welcome" : "thank_you";
                          const res = await fetch(`/api/admin/workforce/hiring/applications/${application.id}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template }) });
                          const body = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            toast({ title: "Email failed", description: body.error ?? "Could not send hiring email.", variant: "destructive" });
                            return;
                          }
                          toast({ title: "Email sent" });
                        }}>Send email</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeaderboardCard({
  title,
  rows,
  valueKey,
  suffix = "",
}: {
  title: string;
  rows: any[];
  valueKey: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white/80 p-4 shadow-sm">
      <p className="font-semibold">{title}</p>
      <div className="mt-3 space-y-3">
        {rows.length > 0 ? rows.map((row, index) => (
          <div key={row.id} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-medium">{index + 1}. {row.name || row.email}</p>
              <p className="text-xs text-muted-foreground">{row.readinessLabel || prettifyLabel(row.role || "staff")}</p>
            </div>
            <Badge variant="outline">
              {row[valueKey] ?? 0}{suffix}
            </Badge>
          </div>
        )) : <p className="text-sm text-muted-foreground">No data yet.</p>}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

