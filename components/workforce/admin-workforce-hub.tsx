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
  Bell,
  Briefcase,
  Copy,
  ExternalLink,
  FileCheck2,
  GraduationCap,
  Megaphone,
  MessageCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { WorkforcePostCard } from "@/components/workforce/workforce-post-card";

function splitCsv(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
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
  audienceValue: "",
  pinned: true,
  coverImageUrl: "",
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
  const [applicationReview, setApplicationReview] = useState<Record<string, { status: string; notes: string }>>({});

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
  }

  function resetPostEditor() {
    setEditingPostId("");
    setPostForm(DEFAULT_POST_FORM);
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
  }

  function parsePostAudience(post: any) {
    const audience = post?.audience ?? {};
    if (audience.all) return { audienceType: "all", audienceValue: "" };
    if (Array.isArray(audience.groupIds) && audience.groupIds[0]) return { audienceType: "group", audienceValue: audience.groupIds[0] };
    if (Array.isArray(audience.roles) && audience.roles[0]) return { audienceType: "role", audienceValue: audience.roles[0] };
    if (Array.isArray(audience.userIds) && audience.userIds[0]) return { audienceType: "user", audienceValue: audience.userIds[0] };
    return { audienceType: "all", audienceValue: "" };
  }

  function startPostEdit(post: any) {
    const audience = parsePostAudience(post);
    setEditingPostId(post.id);
    setPostForm({
      title: post.title ?? "",
      body: post.body ?? "",
      audienceType: audience.audienceType,
      audienceValue: audience.audienceValue,
      pinned: post.pinned === true,
      coverImageUrl: post.coverImageUrl ?? "",
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
      const res = await fetch(`/api/workforce/channels/${channelId}`);
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error(body.error ?? "Could not load channel.");
      setMessages(Array.isArray(body) ? body : []);
    } catch (err: any) {
      toast({ title: "Chat load failed", description: err.message ?? "Could not load messages.", variant: "destructive" });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedChannelId) return;
    void loadMessages(selectedChannelId);
    const timer = window.setInterval(() => void loadMessages(selectedChannelId), 8000);
    return () => window.clearInterval(timer);
  }, [selectedChannelId]);

  const staff = useMemo(() => (data?.directory ?? []).filter((row: any) => row.role === "CLEANER" || row.role === "LAUNDRY" || row.role === "OPS_MANAGER" || row.role === "ADMIN"), [data]);
  const frontline = useMemo(() => (data?.directory ?? []).filter((row: any) => row.role === "CLEANER" || row.role === "LAUNDRY"), [data]);
  const groups = data?.groups ?? [];
  const learningPaths = data?.learningPaths ?? [];

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
        <TabsContent value="groups" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{editingGroupId ? "Edit Group" : "Create Group"}</CardTitle>
              <CardDescription>Manual groups or smart groups by role, department, and location.</CardDescription>
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
                      <Checkbox checked={groupForm.roles.includes(role)} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, roles: checked ? [...current.roles, role] : current.roles.filter((item) => item !== role) }))} />
                      {role.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              </div>
              {groupForm.membershipMode === "SMART" ? (
                <>
                  <div className="space-y-2"><Label>Departments</Label><Input placeholder="Cleaning, Laundry" value={groupForm.departments} onChange={(event) => setGroupForm((current) => ({ ...current, departments: event.target.value }))} /></div>
                  <div className="space-y-2"><Label>Locations</Label><Input placeholder="Eastern Suburbs, Parramatta" value={groupForm.locations} onChange={(event) => setGroupForm((current) => ({ ...current, locations: event.target.value }))} /></div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Manual members</Label>
                  <ScrollArea className="h-48 rounded-xl border p-3">
                    <div className="space-y-2">
                      {staff.map((user: any) => (
                        <label key={user.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                          <span>
                            {user.name || user.email}
                            <span className="ml-2 text-xs text-muted-foreground">{user.role.replace(/_/g, " ")}</span>
                          </span>
                          <Checkbox checked={groupForm.memberUserIds.includes(user.id)} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, memberUserIds: checked ? [...current.memberUserIds, user.id] : current.memberUserIds.filter((item) => item !== user.id) }))} />
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={groupForm.createChatChannel} onCheckedChange={(checked) => setGroupForm((current) => ({ ...current, createChatChannel: checked === true }))} />Create linked group chat</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={saving || !groupForm.name.trim()}
                  onClick={async () => {
                    const payload = {
                      action: editingGroupId ? "UPDATE_GROUP" : "CREATE_GROUP",
                      groupId: editingGroupId || undefined,
                      ...groupForm,
                      smartRules: {
                        roles: groupForm.roles,
                        departments: splitCsv(groupForm.departments),
                        locations: splitCsv(groupForm.locations),
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Existing Groups</CardTitle>
              <CardDescription>Use smart rules for automatic membership by role, department, or location.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(groups as any[]).map((group) => (
                <div key={group.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{group.name}</p>
                    <Badge variant="outline">{group.category}</Badge>
                    <Badge variant="secondary">{group.memberCount} members</Badge>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => startGroupEdit(group)}>
                      <Pencil className="mr-2 h-4 w-4" />Edit
                    </Button>
                  </div>
                  {group.description ? <p className="mt-2 text-sm text-muted-foreground">{group.description}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(group.previewMembers ?? []).map((member: any) => (
                      <Badge key={member.id} variant="outline">{member.name || member.id}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="updates" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{editingPostId ? "Edit Update" : "Publish Update"}</CardTitle>
              <CardDescription>Send an announcement to everyone, a group, a role, or one person.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Title</Label><Input value={postForm.title} onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Message</Label><Textarea value={postForm.body} onChange={(event) => setPostForm((current) => ({ ...current, body: event.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Audience type</Label>
                  <Select value={postForm.audienceType} onValueChange={(value) => setPostForm((current) => ({ ...current, audienceType: value, audienceValue: "" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everyone</SelectItem>
                      <SelectItem value="group">Group</SelectItem>
                      <SelectItem value="role">Role</SelectItem>
                      <SelectItem value="user">Specific user</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {postForm.audienceType !== "all" ? (
                  <div className="space-y-2">
                    <Label>Target</Label>
                    <Select value={postForm.audienceValue} onValueChange={(value) => setPostForm((current) => ({ ...current, audienceValue: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger>
                      <SelectContent>
                        {postForm.audienceType === "group"
                          ? groups.map((group: any) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)
                          : postForm.audienceType === "role"
                            ? ["ADMIN", "OPS_MANAGER", "CLEANER", "LAUNDRY"].map((role) => <SelectItem key={role} value={role}>{role.replace(/_/g, " ")}</SelectItem>)
                            : staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
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
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-2xl border bg-slate-100">
                      <img src={postForm.coverImageUrl} alt="Post preview" className="aspect-[16/10] w-full object-cover" />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPostForm((current) => ({ ...current, coverImageUrl: "" }))}>
                        Remove image
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Upload one image to make the update feel more like a team social post.</p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={postForm.pinned} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, pinned: checked === true }))} />Pin on dashboards</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={saving || !postForm.title.trim() || !postForm.body.trim()}
                  onClick={async () => {
                    const payload = {
                      action: editingPostId ? "UPDATE_POST" : "CREATE_POST",
                      postId: editingPostId || undefined,
                      title: postForm.title,
                      body: postForm.body,
                      pinned: postForm.pinned,
                      coverImageUrl: postForm.coverImageUrl,
                      audience:
                        postForm.audienceType === "all"
                          ? { all: true }
                          : postForm.audienceType === "group"
                            ? { groupIds: [postForm.audienceValue] }
                            : postForm.audienceType === "role"
                              ? { roles: [postForm.audienceValue] }
                              : { userIds: [postForm.audienceValue] },
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
            <CardHeader><CardTitle>Recent Updates</CardTitle><CardDescription>Pinned items also appear on staff dashboards and the team hub.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {(data?.posts ?? []).map((post: any) => (
                <div key={post.id} className="space-y-3">
                  <div className="flex justify-end">
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
        <TabsContent value="chat" className="grid gap-4 xl:grid-cols-[340px,1fr]">
          <Card>
            <CardHeader><CardTitle>Channels</CardTitle><CardDescription>Create group chat rooms or direct chats.</CardDescription></CardHeader>
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
              <div className="space-y-2">
                {(data?.channels ?? []).map((channel: any) => (
                  <button key={channel.id} type="button" className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedChannelId === channel.id ? "border-primary bg-primary/5" : "bg-white/80"}`} onClick={() => setSelectedChannelId(channel.id)}>
                    <p className="text-sm font-semibold">{channel.name}</p>
                    <p className="text-xs text-muted-foreground">{channel.description || channel.kind}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Conversation</CardTitle><CardDescription>Internal team messaging with mobile push notifications.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <ScrollArea className="h-[420px] rounded-2xl border bg-white/80 p-4">
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className="rounded-2xl border bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{message.sender?.name || message.sender?.role || "Team"}</span>
                        <span>{new Date(message.createdAt).toLocaleString("en-AU")}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="space-y-2">
                <Textarea value={messageBody} onChange={(event) => setMessageBody(event.target.value)} placeholder="Send a message to this channel" />
                <Button disabled={!selectedChannelId || !messageBody.trim()} onClick={async () => {
                  const res = await fetch(`/api/workforce/channels/${selectedChannelId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: messageBody }) });
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    toast({ title: "Message failed", description: body.error ?? "Could not send message.", variant: "destructive" });
                    return;
                  }
                  setMessageBody("");
                  await loadMessages(selectedChannelId);
                }}>Send message</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="learning" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader><CardTitle>Assign Learning</CardTitle><CardDescription>Use the default assessment and onboarding course or reassign them after coaching.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Learning path</Label><Select value={learningForm.pathId} onValueChange={(value) => setLearningForm((current) => ({ ...current, pathId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{learningPaths.map((path: any) => <SelectItem key={path.id} value={path.id}>{path.title}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Target type</Label><Select value={learningForm.targetType} onValueChange={(value) => setLearningForm((current) => ({ ...current, targetType: value, targetValue: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">Specific user</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="role">Role</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Target</Label><Select value={learningForm.targetValue} onValueChange={(value) => setLearningForm((current) => ({ ...current, targetValue: value }))}><SelectTrigger><SelectValue placeholder="Select target" /></SelectTrigger><SelectContent>{learningForm.targetType === "user" ? frontline.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>) : learningForm.targetType === "group" ? groups.map((group: any) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>) : ["CLEANER", "LAUNDRY"].map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent></Select></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={learningForm.restart} onCheckedChange={(checked) => setLearningForm((current) => ({ ...current, restart: checked === true }))} />Reset previous progress if already assigned</label>
              <Button disabled={saving || !learningForm.pathId || !learningForm.targetValue} onClick={() => void runAction({ action: "ASSIGN_LEARNING", pathId: learningForm.pathId, userIds: learningForm.targetType === "user" ? [learningForm.targetValue] : [], groupIds: learningForm.targetType === "group" ? [learningForm.targetValue] : [], roles: learningForm.targetType === "role" ? [learningForm.targetValue] : [], restart: learningForm.restart }, "Learning assigned")}>Assign</Button>
              <div className="rounded-2xl border bg-amber-50/70 p-4 text-sm text-amber-900">The readiness assessment scores operational judgement, safety, detail, client care, and coaching need. It is not presented as a literal IQ measure.</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Assignment Results</CardTitle><CardDescription>Track completion, scores, and predicted coaching need.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {(data?.learningAssignments ?? []).map((assignment: any) => (
                <div key={assignment.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{assignment.user?.name || assignment.user?.id}</p>
                    <Badge variant="outline">{assignment.path?.title}</Badge>
                    <Badge variant={assignment.status === "COMPLETED" ? "success" : "secondary"}>{assignment.status}</Badge>
                    {typeof assignment.score === "number" ? <Badge variant="warning">{Math.round(assignment.score)}%</Badge> : null}
                  </div>
                  {assignment.evaluation?.band ? <p className="mt-2 text-sm">{assignment.evaluation.band} · {assignment.evaluation.prediction}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader><CardTitle>Upload Staff Document</CardTitle><CardDescription>Store police checks, licences, white cards, CVs, and other compliance records.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Staff member</Label><Select value={docForm.userId} onValueChange={(value) => setDocForm((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{staff.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Category</Label><Select value={docForm.category} onValueChange={(value) => setDocForm((current) => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Expiry date</Label><Input type="date" value={docForm.expiresAt} onChange={(event) => setDocForm((current) => ({ ...current, expiresAt: event.target.value }))} /></div>
              </div>
              <div className="space-y-2"><Label>Title</Label><Input value={docForm.title} onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={docForm.notes} onChange={(event) => setDocForm((current) => ({ ...current, notes: event.target.value }))} /></div>
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
            <CardHeader><CardTitle>Compliance Library</CardTitle><CardDescription>Review and verify staff records in one place.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {(data?.documents ?? []).map((doc: any) => (
                <div key={doc.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{doc.title}</p>
                    <Badge variant="outline">{doc.category.replace(/_/g, " ")}</Badge>
                    <Badge variant={doc.status === "VERIFIED" ? "success" : doc.status === "REJECTED" ? "destructive" : "warning"}>{doc.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{doc.user?.name || doc.userId} · {doc.fileName}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex rounded-full border px-3 py-2 text-xs font-medium">Open file</a>
                    <Button size="sm" variant="outline" onClick={() => void runAction({ action: "REVIEW_DOCUMENT", documentId: doc.id, status: "VERIFIED", notes: doc.notes ?? null, expiresAt: doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : null }, "Document verified")}>Verify</Button>
                    <Button size="sm" variant="destructive" onClick={() => void runAction({ action: "REVIEW_DOCUMENT", documentId: doc.id, status: "REJECTED", notes: doc.notes ?? null, expiresAt: doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : null }, "Document reviewed")}>Reject</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recognition" className="grid gap-4 xl:grid-cols-[420px,1fr]">
          <Card>
            <CardHeader><CardTitle>Send Recognition</CardTitle><CardDescription>Celebrate top performers and publish shout-outs to the team.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Staff member</Label><Select value={recognitionForm.userId} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, userId: value }))}><SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger><SelectContent>{frontline.map((user: any) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Title</Label><Input value={recognitionForm.title} onChange={(event) => setRecognitionForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Guest-ready consistency" /></div>
              <div className="space-y-2"><Label>Message</Label><Textarea value={recognitionForm.message} onChange={(event) => setRecognitionForm((current) => ({ ...current, message: event.target.value }))} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Badge</Label><Select value={recognitionForm.badgeKey} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, badgeKey: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["STAR_PERFORMER", "CONSISTENCY", "CLIENT_CARE", "TEAM_PLAYER", "RISING_TALENT"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Style</Label><Select value={recognitionForm.celebrationStyle} onValueChange={(value) => setRecognitionForm((current) => ({ ...current, celebrationStyle: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["SPOTLIGHT", "TEAM_SHOUTOUT", "GOLD_STAR", "MILESTONE"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={recognitionForm.isPublic} onCheckedChange={(checked) => setRecognitionForm((current) => ({ ...current, isPublic: checked === true }))} />Share publicly as a team post</label>
              <Button disabled={saving || !recognitionForm.userId || !recognitionForm.title.trim()} onClick={() => void runAction({ action: "SEND_RECOGNITION", ...recognitionForm }, "Recognition sent")}>Send recognition</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recognition Board</CardTitle><CardDescription>QA averages are translated into simple 5-star visibility and promotion signals.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
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
                {(data?.hiring?.applications ?? []).map((application: any) => {
                  const review = applicationReview[application.id] ?? { status: application.status, notes: String(application.evaluation?.adminNotes ?? "") };
                  return (
                    <div key={application.id} className="rounded-2xl border bg-white/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{application.fullName}</p>
                        <Badge variant="outline">{application.position?.title}</Badge>
                        <Badge variant={application.status === "HIRED" ? "success" : application.status === "REJECTED" ? "destructive" : "secondary"}>{application.status}</Badge>
                        {typeof application.screeningScore === "number" ? <Badge variant="warning">Screening {Math.round(application.screeningScore)}</Badge> : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{application.email}{application.phone ? ` · ${application.phone}` : ""}</p>
                      <p className="mt-2 text-sm">{application.evaluation?.fitBand || "Awaiting review"}</p>
                      {application.resumeUrl ? <a href={application.resumeUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-full border px-3 py-2 text-xs font-medium">Open resume</a> : null}
                      <div className="mt-3 grid gap-3 sm:grid-cols-[180px,1fr,auto]">
                        <Select value={review.status} onValueChange={(value) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, status: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["NEW", "REVIEWING", "INTERVIEW", "ON_HOLD", "HIRED", "REJECTED"].map((item) => <SelectItem key={item} value={item}>{item.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
                        <Input value={review.notes} onChange={(event) => setApplicationReview((current) => ({ ...current, [application.id]: { ...review, notes: event.target.value } }))} placeholder="Admin notes" />
                        <Button onClick={() => void runAction({ action: "REVIEW_APPLICATION", applicationId: application.id, status: review.status, notes: review.notes }, "Application updated")}>Save</Button>
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

