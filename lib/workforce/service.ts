import { randomUUID } from "crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserExtendedProfiles, type UserExtendedProfile } from "@/lib/accounts/user-details";
import {
  buildCleanerAssessmentSchema,
  buildCleanerOnboardingSchema,
  buildDefaultCleanerHiringDescription,
  buildDefaultHiringSchema,
  type LearningModule,
  type LearningQuestion,
  type LearningSchema,
} from "@/lib/workforce/learning-defaults";

const STAFF_ROLES = [Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY] as const;
const FRONTLINE_ROLES: Role[] = [Role.CLEANER, Role.LAUNDRY];
const DEFAULT_CLEANER_ASSESSMENT_SLUG = "cleaner-readiness-assessment";
const DEFAULT_CLEANER_ONBOARDING_SLUG = "cleaner-onboarding-foundations";

type AudienceRule = {
  all?: boolean;
  roles?: string[];
  groupIds?: string[];
  userIds?: string[];
};

type SmartGroupRule = {
  roles?: string[];
  departments?: string[];
  locations?: string[];
};

type DirectoryUser = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: Role;
  image: string | null;
  createdAt: Date;
  extendedProfile: UserExtendedProfile | null;
  qaAverage: number | null;
  qaStars: number | null;
  qaReviewCount: number;
  publicRecognitionCount: number;
  pendingDocumentCount: number;
  verifiedDocumentCount: number;
};

type ChannelSummary = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberUserIds: string[];
  lastMessage: {
    body: string;
    createdAt: string;
    senderName: string | null;
  } | null;
};

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function safeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map((entry) => (typeof entry === "string" ? entry : "")));
}

function parseSmartRules(value: unknown): SmartGroupRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { roles: [], departments: [], locations: [] };
  }
  const row = value as Record<string, unknown>;
  return {
    roles: safeArray(row.roles),
    departments: safeArray(row.departments),
    locations: safeArray(row.locations),
  };
}

function parseAudience(value: unknown): AudienceRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { all: true, roles: [], groupIds: [], userIds: [] };
  }
  const row = value as Record<string, unknown>;
  return {
    all: row.all === true,
    roles: safeArray(row.roles),
    groupIds: safeArray(row.groupIds),
    userIds: safeArray(row.userIds),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || randomUUID().slice(0, 8);
}

async function ensureUniqueHiringSlug(preferred: string, excludeId?: string | null) {
  const slugBase = slugify(preferred);
  let slug = slugBase;
  let attempts = 1;

  while (true) {
    const existing = await db.hiringPosition.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) {
      return slug;
    }
    attempts += 1;
    slug = `${slugBase}-${attempts}`;
  }
}

function summarizeText(value: string, max = 120) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shortAnswerScore(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words >= 18) return 1;
  if (words >= 10) return 0.8;
  if (words >= 5) return 0.6;
  return 0.4;
}

function isTruthySelection(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function questionWeight(question: LearningQuestion) {
  return Number.isFinite(question.weight) && Number(question.weight) > 0 ? Number(question.weight) : 1;
}

function flattenQuestions(schema: LearningSchema) {
  const questions: Array<{ module: LearningModule; question: LearningQuestion }> = [];
  for (const module of schema.modules) {
    for (const question of module.questions ?? []) {
      questions.push({ module, question });
    }
  }
  return questions;
}

function evaluateLearningAnswers(schema: LearningSchema, answersRaw: unknown) {
  const answers = answersRaw && typeof answersRaw === "object" && !Array.isArray(answersRaw)
    ? (answersRaw as Record<string, unknown>)
    : {};
  const categoryTotals = new Map<string, { earned: number; possible: number }>();
  const questionResults: Array<{
    id: string;
    prompt: string;
    category: string;
    score: number;
    possible: number;
    answer: unknown;
    explanation?: string;
  }> = [];

  let earned = 0;
  let possible = 0;

  for (const { question } of flattenQuestions(schema)) {
    const rawAnswer = answers[question.id];
    const weight = questionWeight(question);
    possible += weight;

    let questionScore = 0;
    if (question.type === "single") {
      if (typeof rawAnswer === "string" && rawAnswer.trim() === question.correct) {
        questionScore = weight;
      }
    } else if (question.type === "multi") {
      const expected = Array.isArray(question.correct) ? question.correct.map(String).sort() : [];
      const actual = Array.isArray(rawAnswer)
        ? rawAnswer.map(String).filter(Boolean).sort()
        : typeof rawAnswer === "string"
          ? rawAnswer.split(",").map((value) => value.trim()).filter(Boolean).sort()
          : [];
      if (expected.length > 0 && actual.length > 0) {
        const matches = actual.filter((value) => expected.includes(value)).length;
        const wrong = actual.filter((value) => !expected.includes(value)).length;
        const coverage = matches / expected.length;
        const penalty = wrong > 0 ? 0.25 * wrong : 0;
        questionScore = Math.max(0, Math.min(1, coverage - penalty)) * weight;
      }
    } else if (question.type === "short") {
      questionScore = shortAnswerScore(typeof rawAnswer === "string" ? rawAnswer : "") * weight;
    }

    earned += questionScore;
    const category = question.category || "general";
    const bucket = categoryTotals.get(category) ?? { earned: 0, possible: 0 };
    bucket.earned += questionScore;
    bucket.possible += weight;
    categoryTotals.set(category, bucket);

    questionResults.push({
      id: question.id,
      prompt: question.prompt,
      category,
      score: Number(questionScore.toFixed(2)),
      possible: weight,
      answer: rawAnswer,
      explanation: question.explanation,
    });
  }

  const percentage = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const categoryScores = Array.from(categoryTotals.entries()).map(([category, totals]) => ({
    category,
    score: totals.possible > 0 ? Math.round((totals.earned / totals.possible) * 100) : 0,
  }));

  const lowAreas = categoryScores.filter((entry) => entry.score < 65).map((entry) => entry.category);
  const strengths = categoryScores.filter((entry) => entry.score >= 80).map((entry) => entry.category);

  let band = "Needs structured onboarding";
  let prediction = "High supervision recommended for the first month.";
  if (percentage >= 85) {
    band = "High readiness";
    prediction = "Can likely handle independent jobs sooner, with spot coaching on local standards.";
  } else if (percentage >= 70) {
    band = "Promising with coaching";
    prediction = "Good field potential, but should complete onboarding and receive targeted coaching in weaker areas.";
  } else if (percentage >= 55) {
    band = "Coachable but needs structure";
    prediction = "Should shadow proven staff first and complete extra practice before higher-risk turnovers.";
  }

  return {
    percentage,
    band,
    starRating: Number((Math.max(1, Math.min(5, percentage / 20))).toFixed(1)),
    strengths,
    lowAreas,
    prediction,
    categoryScores,
    questionResults,
    answeredCount: questionResults.filter((item) => isTruthySelection(item.answer)).length,
    totalQuestions: questionResults.length,
  };
}

async function loadStaffDirectoryCore() {
  const users = await db.user.findMany({
    where: { role: { in: [...STAFF_ROLES] }, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      image: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const userIds = users.map((user) => user.id);
  const [extendedMap, assignmentRows, recognitionRows, documentRows] = await Promise.all([
    getUserExtendedProfiles(userIds),
    db.jobAssignment.findMany({
      where: {
        removedAt: null,
        userId: { in: userIds },
        job: { qaReviews: { some: {} } },
      },
      select: {
        userId: true,
        job: {
          select: {
            qaReviews: {
              select: { score: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    }),
    db.staffRecognition.findMany({
      where: { userId: { in: userIds }, isPublic: true },
      select: { userId: true },
    }),
    db.staffDocument.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, status: true },
    }),
  ]);

  const qaBuckets = new Map<string, { total: number; count: number }>();
  for (const row of assignmentRows) {
    const latest = row.job.qaReviews[0];
    if (!latest) continue;
    const bucket = qaBuckets.get(row.userId) ?? { total: 0, count: 0 };
    bucket.total += Number(latest.score ?? 0);
    bucket.count += 1;
    qaBuckets.set(row.userId, bucket);
  }

  const recognitionCounts = new Map<string, number>();
  for (const row of recognitionRows) {
    recognitionCounts.set(row.userId, (recognitionCounts.get(row.userId) ?? 0) + 1);
  }

  const documentCounts = new Map<string, { pending: number; verified: number }>();
  for (const row of documentRows) {
    const bucket = documentCounts.get(row.userId) ?? { pending: 0, verified: 0 };
    if (row.status === "VERIFIED") bucket.verified += 1;
    else if (row.status === "PENDING") bucket.pending += 1;
    documentCounts.set(row.userId, bucket);
  }

  return users.map((user) => {
    const qa = qaBuckets.get(user.id);
    const average = qa?.count ? Number((qa.total / qa.count).toFixed(1)) : null;
    const docCounts = documentCounts.get(user.id) ?? { pending: 0, verified: 0 };
    return {
      ...user,
      extendedProfile: extendedMap.get(user.id) ?? null,
      qaAverage: average,
      qaStars: average === null ? null : Number((average / 20).toFixed(1)),
      qaReviewCount: qa?.count ?? 0,
      publicRecognitionCount: recognitionCounts.get(user.id) ?? 0,
      pendingDocumentCount: docCounts.pending,
      verifiedDocumentCount: docCounts.verified,
    } satisfies DirectoryUser;
  });
}

export async function listStaffDirectory() {
  return loadStaffDirectoryCore();
}

function matchesSmartGroup(user: DirectoryUser, rules: SmartGroupRule) {
  const roleOk = !rules.roles?.length || rules.roles.includes(user.role);
  const deptOk =
    !rules.departments?.length || rules.departments.includes(user.extendedProfile?.department ?? "");
  const locationOk =
    !rules.locations?.length || rules.locations.includes(user.extendedProfile?.baseLocation ?? "");
  return roleOk && deptOk && locationOk;
}

async function resolveGroupUserIdsByRows(groups: Array<{ id: string; membershipMode: string; smartRules: Prisma.JsonValue | null; members?: Array<{ userId: string }> }>) {
  const directory = await loadStaffDirectoryCore();
  const output = new Map<string, string[]>();
  for (const group of groups) {
    if (group.membershipMode === "SMART") {
      const rules = parseSmartRules(group.smartRules);
      output.set(group.id, directory.filter((user) => matchesSmartGroup(user, rules)).map((user) => user.id));
      continue;
    }
    output.set(group.id, uniq((group.members ?? []).map((member) => member.userId)));
  }
  return output;
}

export async function listTeamGroups() {
  const groups = await db.teamGroup.findMany({
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      members: { select: { userId: true, user: { select: { id: true, name: true, role: true, image: true } } } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const memberIdsByGroup = await resolveGroupUserIdsByRows(groups);
  const directory = await loadStaffDirectoryCore();
  const directoryById = new Map(directory.map((user) => [user.id, user]));
  return groups.map((group) => {
    const resolvedMemberIds = memberIdsByGroup.get(group.id) ?? [];
    const previews = resolvedMemberIds
      .map((userId) => directoryById.get(userId))
      .filter((item): item is DirectoryUser => Boolean(item))
      .slice(0, 6)
      .map((user) => ({
        id: user.id,
        name: user.name,
        role: user.role,
        image: user.image,
        department: user.extendedProfile?.department ?? null,
        location: user.extendedProfile?.baseLocation ?? null,
      }));

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      category: group.category,
      membershipMode: group.membershipMode,
      smartRules: parseSmartRules(group.smartRules),
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      memberCount: resolvedMemberIds.length,
      previewMembers: previews,
      memberUserIds: resolvedMemberIds,
    };
  });
}

export async function createTeamGroup(input: {
  name: string;
  description?: string | null;
  category?: string | null;
  membershipMode?: string | null;
  smartRules?: SmartGroupRule | null;
  memberUserIds?: string[];
  createChatChannel?: boolean;
  createdById: string;
}) {
  const memberUserIds = uniq(input.memberUserIds ?? []);
  const group = await db.teamGroup.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: (input.category?.trim() || "CUSTOM").toUpperCase(),
      membershipMode: (input.membershipMode?.trim() || "MANUAL").toUpperCase(),
      smartRules: (input.membershipMode?.toUpperCase() === "SMART" ? input.smartRules : null) as Prisma.InputJsonValue,
      createdById: input.createdById,
      members:
        input.membershipMode?.toUpperCase() === "SMART"
          ? undefined
          : memberUserIds.length > 0
            ? { createMany: { data: memberUserIds.map((userId) => ({ userId })) } }
            : undefined,
    },
  });

  if (input.createChatChannel) {
    await db.chatChannel.create({
      data: {
        name: group.name,
        description: group.description,
        kind: "GROUP",
        groupId: group.id,
        createdById: input.createdById,
      },
    });
  }

  return group;
}

export async function updateTeamGroup(input: {
  groupId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  membershipMode?: string | null;
  smartRules?: SmartGroupRule | null;
  memberUserIds?: string[];
}) {
  const mode = (input.membershipMode?.trim() || "MANUAL").toUpperCase();
  const memberUserIds = uniq(input.memberUserIds ?? []);
  await db.$transaction(async (tx) => {
    await tx.teamGroup.update({
      where: { id: input.groupId },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: (input.category?.trim() || "CUSTOM").toUpperCase(),
        membershipMode: mode,
        smartRules: (mode === "SMART" ? input.smartRules : null) as Prisma.InputJsonValue,
      },
    });
    await tx.teamGroupMember.deleteMany({ where: { groupId: input.groupId } });
    if (mode !== "SMART" && memberUserIds.length > 0) {
      await tx.teamGroupMember.createMany({
        data: memberUserIds.map((userId) => ({ groupId: input.groupId, userId })),
        skipDuplicates: true,
      });
    }
  });
}

async function resolveAudienceUserIds(audienceRaw: AudienceRule | null | undefined) {
  const audience = audienceRaw ?? { all: true };
  const directory = await loadStaffDirectoryCore();
  const selected = new Set<string>();
  if (audience.all || (!audience.roles?.length && !audience.groupIds?.length && !audience.userIds?.length)) {
    for (const user of directory) selected.add(user.id);
  }
  if (audience.roles?.length) {
    for (const user of directory) {
      if (audience.roles.includes(user.role)) selected.add(user.id);
    }
  }
  if (audience.userIds?.length) {
    for (const userId of audience.userIds) selected.add(userId);
  }
  if (audience.groupIds?.length) {
    const groups = await db.teamGroup.findMany({
      where: { id: { in: audience.groupIds } },
      include: { members: { select: { userId: true } } },
    });
    const groupMembers = await resolveGroupUserIdsByRows(groups);
    for (const groupId of audience.groupIds) {
      for (const userId of groupMembers.get(groupId) ?? []) {
        selected.add(userId);
      }
    }
  }
  return Array.from(selected);
}

function canUserSeeAudience(user: { id: string; role: Role }, audience: AudienceRule, groupIds: string[]) {
  if (audience.all || (!audience.roles?.length && !audience.groupIds?.length && !audience.userIds?.length)) {
    return true;
  }
  if (audience.userIds?.includes(user.id)) return true;
  if (audience.roles?.includes(user.role)) return true;
  if (audience.groupIds?.some((groupId) => groupIds.includes(groupId))) return true;
  return false;
}

export async function listVisibleWorkforcePosts(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return [];
  const groups = await listTeamGroups();
  const groupIds = groups.filter((group) => group.memberUserIds.includes(userId)).map((group) => group.id);
  const posts = await db.workforcePost.findMany({
    include: { createdBy: { select: { id: true, name: true, role: true, image: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 40,
  });
  return posts.filter((post) => canUserSeeAudience(user, parseAudience(post.audience), groupIds));
}

export async function createWorkforcePost(input: {
  title: string;
  body: string;
  type?: string;
  coverImageUrl?: string | null;
  pinned?: boolean;
  audience?: AudienceRule | null;
  attachments?: Prisma.JsonValue | null;
  createdById: string;
}) {
  const audience = input.audience ?? { all: true };
  const post = await db.workforcePost.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      type: input.type?.trim() || "ANNOUNCEMENT",
      coverImageUrl: input.coverImageUrl?.trim() || null,
      pinned: input.pinned === true,
      attachments: (input.attachments ?? null) as Prisma.InputJsonValue,
      audience: audience as Prisma.InputJsonValue,
      createdById: input.createdById,
    },
  });

  const recipientIds = await resolveAudienceUserIds(audience);
  if (recipientIds.length > 0) {
    await db.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        channel: "PUSH",
        subject: input.type === "RECOGNITION" ? "Team recognition" : "Team update",
        body: `${post.title} - ${summarizeText(post.body, 120)}`,
        status: "SENT",
        sentAt: new Date(),
      })),
    });
  }

  return post;
}

export async function updateWorkforcePost(input: {
  postId: string;
  title: string;
  body: string;
  type?: string;
  coverImageUrl?: string | null;
  pinned?: boolean;
  audience?: AudienceRule | null;
}) {
  const audience = input.audience ?? { all: true };
  return db.workforcePost.update({
    where: { id: input.postId },
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      type: input.type?.trim() || "ANNOUNCEMENT",
      coverImageUrl: input.coverImageUrl?.trim() || null,
      pinned: input.pinned === true,
      audience: audience as Prisma.InputJsonValue,
    },
  });
}

export async function listAccessibleChatChannels(userId: string) {
  const groups = await listTeamGroups();
  const groupIds = groups.filter((group) => group.memberUserIds.includes(userId)).map((group) => group.id);
  const channels = await db.chatChannel.findMany({
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          body: true,
          createdAt: true,
          sender: { select: { name: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: 100,
  });
  return channels
    .filter((channel) => {
      if (channel.groupId) return groupIds.includes(channel.groupId);
      const directMembers = safeArray(channel.memberUserIds);
      return directMembers.includes(userId);
    })
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      kind: channel.kind,
      groupId: channel.groupId,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      memberUserIds: safeArray(channel.memberUserIds),
      lastMessage: channel.messages[0]
        ? {
            body: channel.messages[0].body,
            createdAt: channel.messages[0].createdAt.toISOString(),
            senderName: channel.messages[0].sender.name,
          }
        : null,
    } satisfies ChannelSummary));
}

export async function createChatChannel(input: {
  name: string;
  description?: string | null;
  kind?: string | null;
  groupId?: string | null;
  memberUserIds?: string[];
  createdById: string;
}) {
  const kind = (input.kind?.trim() || (input.groupId ? "GROUP" : "DIRECT")).toUpperCase();
  const memberUserIds = uniq(input.memberUserIds ?? []);
  return db.chatChannel.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      kind,
      groupId: kind === "GROUP" ? input.groupId ?? null : null,
      memberUserIds: (kind === "DIRECT" ? memberUserIds : null) as Prisma.InputJsonValue,
      createdById: input.createdById,
    },
  });
}

export async function openDirectChat(userId: string, otherUserId: string) {
  const pair = [userId, otherUserId].sort();
  const channels = await db.chatChannel.findMany({ where: { kind: "DIRECT" } });
  const existing = channels.find((channel) => {
    const members = safeArray(channel.memberUserIds).sort();
    return members.length === 2 && members[0] === pair[0] && members[1] === pair[1];
  });
  if (existing) return existing;
  const users = await db.user.findMany({
    where: { id: { in: pair } },
    select: { id: true, name: true },
  });
  const other = users.find((row) => row.id === otherUserId);
  return createChatChannel({
    name: other?.name?.trim() ? `Direct: ${other.name}` : "Direct chat",
    kind: "DIRECT",
    memberUserIds: pair,
    createdById: userId,
  });
}

export async function canAccessChatChannel(userId: string, channelId: string) {
  const channels = await listAccessibleChatChannels(userId);
  return channels.some((channel) => channel.id === channelId);
}

export async function listChatMessagesForUser(userId: string, channelId: string) {
  const allowed = await canAccessChatChannel(userId, channelId);
  if (!allowed) throw new Error("FORBIDDEN");
  return db.chatMessage.findMany({
    where: { channelId },
    include: { sender: { select: { id: true, name: true, role: true, image: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
}

export async function createChatMessage(input: { channelId: string; senderId: string; body: string }) {
  const allowed = await canAccessChatChannel(input.senderId, input.channelId);
  if (!allowed) throw new Error("FORBIDDEN");

  const channel = await db.chatChannel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new Error("NOT_FOUND");

  const message = await db.chatMessage.create({
    data: {
      channelId: input.channelId,
      senderId: input.senderId,
      body: input.body.trim(),
    },
    include: { sender: { select: { id: true, name: true, role: true, image: true } } },
  });

  const recipients = channel.groupId
    ? (await listTeamGroups()).find((group) => group.id === channel.groupId)?.memberUserIds ?? []
    : safeArray(channel.memberUserIds);
  const notifyIds = recipients.filter((userId) => userId !== input.senderId);
  if (notifyIds.length > 0) {
    await db.notification.createMany({
      data: notifyIds.map((userId) => ({
        userId,
        channel: "PUSH",
        subject: `Chat: ${channel.name}`,
        body: summarizeText(message.body, 120),
        status: "SENT",
        sentAt: new Date(),
      })),
    });
  }

  return message;
}

export async function ensureDefaultLearningPaths(createdById: string) {
  const paths = [
    {
      slug: DEFAULT_CLEANER_ASSESSMENT_SLUG,
      title: "Cleaner Readiness Assessment",
      type: "ASSESSMENT",
      description: "Scenario-based screening that measures safety judgement, workflow discipline, detail, and client care.",
      coverImageUrl: "/workforce/onboarding-overview.svg",
      schema: buildCleanerAssessmentSchema(),
    },
    {
      slug: DEFAULT_CLEANER_ONBOARDING_SLUG,
      title: "Cleaner Onboarding Foundations",
      type: "COURSE",
      description: "Interactive onboarding for short-stay operations, app workflow, chemical use, bed standards, restocking, and difficult situations.",
      coverImageUrl: "/workforce/airbnb-turnover.svg",
      schema: buildCleanerOnboardingSchema(),
    },
  ];

  for (const path of paths) {
    await db.learningPath.upsert({
      where: { slug: path.slug },
      create: {
        slug: path.slug,
        title: path.title,
        type: path.type,
        description: path.description,
        coverImageUrl: path.coverImageUrl,
        audience: { roles: [Role.CLEANER] } as Prisma.InputJsonValue,
        schema: path.schema as Prisma.InputJsonValue,
        isPublished: true,
        createdById,
      },
      update: {
        title: path.title,
        type: path.type,
        description: path.description,
        coverImageUrl: path.coverImageUrl,
        audience: { roles: [Role.CLEANER] } as Prisma.InputJsonValue,
        schema: path.schema as Prisma.InputJsonValue,
        isPublished: true,
      },
    });
  }
}

export async function autoAssignCleanerLearning(userId: string, assignedById?: string | null) {
  const paths = await db.learningPath.findMany({
    where: { slug: { in: [DEFAULT_CLEANER_ASSESSMENT_SLUG, DEFAULT_CLEANER_ONBOARDING_SLUG] } },
    select: { id: true },
  });
  for (const path of paths) {
    await db.learningAssignment.upsert({
      where: { pathId_userId: { pathId: path.id, userId } },
      create: {
        pathId: path.id,
        userId,
        assignedById: assignedById ?? undefined,
        status: "ASSIGNED",
      },
      update: {},
    });
  }
}

export async function listLearningPaths() {
  return db.learningPath.findMany({
    where: { isPublished: true },
    orderBy: [{ type: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      description: true,
      coverImageUrl: true,
      schema: true,
      createdAt: true,
    },
  });
}

export async function listLearningAssignmentsForUser(userId: string) {
  return db.learningAssignment.findMany({
    where: { userId },
    include: {
      path: { select: { id: true, title: true, slug: true, type: true, description: true, coverImageUrl: true, schema: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function assignLearningPath(input: {
  pathId: string;
  userIds?: string[];
  groupIds?: string[];
  roles?: string[];
  assignedById: string;
  restart?: boolean;
}) {
  const directory = await loadStaffDirectoryCore();
  const userIds = new Set<string>();
  for (const id of uniq(input.userIds ?? [])) userIds.add(id);
  if ((input.roles ?? []).length > 0) {
    for (const user of directory) {
      if ((input.roles ?? []).includes(user.role)) userIds.add(user.id);
    }
  }
  if ((input.groupIds ?? []).length > 0) {
    const groups = await listTeamGroups();
    for (const group of groups) {
      if ((input.groupIds ?? []).includes(group.id)) {
        for (const memberId of group.memberUserIds) userIds.add(memberId);
      }
    }
  }

  for (const userId of Array.from(userIds)) {
    await db.learningAssignment.upsert({
      where: { pathId_userId: { pathId: input.pathId, userId } },
      create: {
        pathId: input.pathId,
        userId,
        assignedById: input.assignedById,
        status: "ASSIGNED",
      },
      update: input.restart
        ? {
            status: "ASSIGNED",
            score: null,
            starRating: null,
            answers: Prisma.JsonNull,
            evaluation: Prisma.JsonNull,
            startedAt: null,
            completedAt: null,
          }
        : {},
    });
  }
}

export async function startLearningAssignment(assignmentId: string, userId: string) {
  await db.learningAssignment.updateMany({
    where: { id: assignmentId, userId, status: { not: "COMPLETED" } },
    data: {
      startedAt: new Date(),
      status: "IN_PROGRESS",
    },
  });
}

export async function saveLearningProgress(input: { assignmentId: string; userId: string; answers: Record<string, unknown> }) {
  const assignment = await db.learningAssignment.findUnique({
    where: { id: input.assignmentId },
    select: { id: true, userId: true, status: true, startedAt: true },
  });
  if (!assignment || assignment.userId !== input.userId) throw new Error("NOT_FOUND");

  return db.learningAssignment.update({
    where: { id: input.assignmentId },
    data: {
      answers: input.answers as Prisma.InputJsonValue,
      startedAt: assignment.startedAt ?? new Date(),
      status: assignment.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
    },
  });
}

export async function restartLearningAssignment(assignmentId: string, userId: string) {
  const assignment = await db.learningAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, userId: true },
  });
  if (!assignment || assignment.userId !== userId) throw new Error("NOT_FOUND");

  return db.learningAssignment.update({
    where: { id: assignmentId },
    data: {
      status: "IN_PROGRESS",
      score: null,
      starRating: null,
      answers: Prisma.JsonNull,
      evaluation: Prisma.JsonNull,
      startedAt: new Date(),
      completedAt: null,
    },
  });
}

export async function submitLearningAssignment(input: { assignmentId: string; userId: string; answers: Record<string, unknown> }) {
  const assignment = await db.learningAssignment.findUnique({
    where: { id: input.assignmentId },
    include: { path: true },
  });
  if (!assignment || assignment.userId !== input.userId) throw new Error("NOT_FOUND");
  const schema = assignment.path.schema as unknown as LearningSchema;
  const evaluation = evaluateLearningAnswers(schema, input.answers);

  return db.learningAssignment.update({
    where: { id: input.assignmentId },
    data: {
      answers: input.answers as Prisma.InputJsonValue,
      evaluation: evaluation as Prisma.InputJsonValue,
      status: "COMPLETED",
      score: evaluation.percentage,
      starRating: evaluation.starRating,
      startedAt: assignment.startedAt ?? new Date(),
      completedAt: new Date(),
    },
    include: {
      path: { select: { id: true, title: true, slug: true, type: true, description: true, coverImageUrl: true, schema: true } },
    },
  });
}

export async function listStaffDocumentsForAdmin() {
  return db.staffDocument.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      uploadedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function listStaffDocumentsForUser(userId: string) {
  return db.staffDocument.findMany({
    where: { userId },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function createStaffDocument(input: {
  userId: string;
  uploadedById: string;
  category: string;
  title: string;
  fileName: string;
  url: string;
  s3Key: string;
  mimeType?: string | null;
  notes?: string | null;
  expiresAt?: string | null;
}) {
  return db.staffDocument.create({
    data: {
      userId: input.userId,
      uploadedById: input.uploadedById,
      category: input.category.trim().toUpperCase(),
      title: input.title.trim(),
      fileName: input.fileName.trim(),
      url: input.url.trim(),
      s3Key: input.s3Key.trim(),
      mimeType: input.mimeType?.trim() || null,
      notes: input.notes?.trim() || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      status: "PENDING",
    },
  });
}

export async function reviewStaffDocument(input: {
  documentId: string;
  reviewerId: string;
  status: string;
  notes?: string | null;
  expiresAt?: string | null;
}) {
  return db.staffDocument.update({
    where: { id: input.documentId },
    data: {
      status: input.status.trim().toUpperCase(),
      notes: input.notes?.trim() || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      verifiedById: input.reviewerId,
      verifiedAt: new Date(),
    },
  });
}

export async function getRecognitionBoard() {
  const directory = (await loadStaffDirectoryCore()).filter((user) => FRONTLINE_ROLES.includes(user.role));
  const recentRecognitions = await db.staffRecognition.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      sentBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const board = directory
    .map((user) => ({
      ...user,
      readinessLabel:
        user.qaAverage === null
          ? "Awaiting QA data"
          : user.qaAverage >= 92 && user.qaReviewCount >= 5
            ? "Promotion or spotlight candidate"
            : user.qaAverage >= 85
              ? "High performer"
              : user.qaAverage >= 75
                ? "Stable contributor"
                : "Needs coaching attention",
    }))
    .sort((left, right) => {
      const rightScore = right.qaAverage ?? -1;
      const leftScore = left.qaAverage ?? -1;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.publicRecognitionCount - left.publicRecognitionCount;
    });

  return { board, recentRecognitions };
}

export async function sendRecognition(input: {
  userId: string;
  sentById: string;
  title: string;
  message?: string | null;
  badgeKey: string;
  celebrationStyle?: string | null;
  isPublic?: boolean;
}) {
  const recognition = await db.staffRecognition.create({
    data: {
      userId: input.userId,
      sentById: input.sentById,
      title: input.title.trim(),
      message: input.message?.trim() || null,
      badgeKey: input.badgeKey.trim() || "STAR",
      celebrationStyle: input.celebrationStyle?.trim() || "SPOTLIGHT",
      isPublic: input.isPublic !== false,
    },
    include: {
      user: { select: { id: true, name: true } },
      sentBy: { select: { id: true, name: true } },
    },
  });

  await db.notification.create({
    data: {
      userId: input.userId,
      channel: "PUSH",
      subject: "Recognition received",
      body: `${recognition.sentBy.name ?? "Admin"} sent you recognition: ${recognition.title}`,
      status: "SENT",
      sentAt: new Date(),
    },
  });

  if (recognition.isPublic) {
    await createWorkforcePost({
      title: recognition.title,
      body: recognition.message || `${recognition.user.name ?? "Team member"} was recognised for strong work and consistency.`,
      type: "RECOGNITION",
      audience: { all: true },
      createdById: input.sentById,
    });
  }

  return recognition;
}

function evaluateHiringAnswers(answersRaw: unknown) {
  const answers = answersRaw && typeof answersRaw === "object" && !Array.isArray(answersRaw)
    ? (answersRaw as Record<string, unknown>)
    : {};
  let score = 0;
  const strengths: string[] = [];
  const risks: string[] = [];

  const rightToWork = String(answers.rightToWork ?? "");
  if (rightToWork === "Yes") {
    score += 20;
    strengths.push("Work rights confirmed");
  } else {
    risks.push("Work rights not confirmed");
  }

  const vehicle = String(answers.hasVehicle ?? "");
  if (vehicle === "Own vehicle") score += 15;
  else if (vehicle === "Depends on location") score += 7;
  else risks.push("Transport flexibility may be limited");

  const licence = String(answers.licenseStatus ?? "");
  if (licence === "Full licence") score += 12;
  else if (licence === "Provisional licence") score += 6;
  else risks.push("No licence");

  const experience = String(answers.cleaningExperience ?? "");
  if (experience === "3+ years") score += 18;
  else if (experience === "1-3 years") score += 12;
  else if (experience === "Less than 1 year") score += 6;
  else risks.push("No formal cleaning experience");

  const propertyTypes = Array.isArray(answers.propertyTypes) ? answers.propertyTypes.map(String) : [];
  if (propertyTypes.includes("Airbnb / short-stay")) score += 10;
  if (propertyTypes.includes("Deep cleans")) score += 6;
  if (propertyTypes.includes("Laundry / linen")) score += 4;

  const scenarioLateGuest = String(answers.scenarioLateGuest ?? "");
  if (/admin|escalat|notify|report|guest|late/i.test(scenarioLateGuest)) score += 9;
  else risks.push("Late-checkout scenario answer lacks escalation detail");

  const scenarioMissingStock = String(answers.scenarioMissingStock ?? "");
  if (/stock|shop|notify|admin|restock|report/i.test(scenarioMissingStock)) score += 9;
  else risks.push("Missing-stock scenario answer lacks readiness process");

  const fitBand = score >= 75 ? "Strong fit" : score >= 55 ? "Worth interviewing" : "Needs screening review";
  return {
    score,
    fitBand,
    strengths,
    risks,
  };
}

export async function ensureDefaultHiringPosition(createdById: string) {
  const slug = "cleaner-application";
  const existing = await db.hiringPosition.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (existing) return;

  await db.hiringPosition.create({
    data: {
      slug,
      title: "Cleaner / Turnover Specialist",
      description: buildDefaultCleanerHiringDescription(),
      department: "Cleaning",
      location: "Greater Sydney",
      employmentType: "Casual / Contract",
      applicationSchema: buildDefaultHiringSchema() as Prisma.InputJsonValue,
      screeningSchema: { model: "default_cleaner_screening_v1" } as Prisma.InputJsonValue,
      isPublished: true,
      createdById,
    },
  });
}

export async function listHiringPositionsWithApplications() {
  const [positions, applications] = await Promise.all([
    db.hiringPosition.findMany({
      orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { applications: true } } },
    }),
    db.hiringApplication.findMany({
      include: {
        position: { select: { id: true, title: true, slug: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return { positions, applications };
}

export async function createHiringPosition(input: {
  title: string;
  slug?: string | null;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  employmentType?: string | null;
  isPublished?: boolean;
  createdById: string;
}) {
  const slug = await ensureUniqueHiringSlug(input.slug?.trim() || input.title);
  return db.hiringPosition.create({
    data: {
      title: input.title.trim(),
      slug,
      description: input.description?.trim() || buildDefaultCleanerHiringDescription(),
      department: input.department?.trim() || null,
      location: input.location?.trim() || null,
      employmentType: input.employmentType?.trim() || null,
      applicationSchema: buildDefaultHiringSchema() as Prisma.InputJsonValue,
      screeningSchema: { model: "default_cleaner_screening_v1" } as Prisma.InputJsonValue,
      isPublished: input.isPublished !== false,
      createdById: input.createdById,
    },
  });
}

export async function updateHiringPosition(input: {
  positionId: string;
  title: string;
  slug?: string | null;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  employmentType?: string | null;
  isPublished?: boolean;
}) {
  const slug = await ensureUniqueHiringSlug(input.slug?.trim() || input.title, input.positionId);
  return db.hiringPosition.update({
    where: { id: input.positionId },
    data: {
      title: input.title.trim(),
      slug,
      description: input.description?.trim() || buildDefaultCleanerHiringDescription(),
      department: input.department?.trim() || null,
      location: input.location?.trim() || null,
      employmentType: input.employmentType?.trim() || null,
      isPublished: input.isPublished !== false,
    },
  });
}

export async function updateHiringApplication(input: {
  applicationId: string;
  reviewedById: string;
  status: string;
  notes?: string | null;
}) {
  const current = await db.hiringApplication.findUnique({ where: { id: input.applicationId } });
  if (!current) throw new Error("NOT_FOUND");
  const evaluation = current.evaluation && typeof current.evaluation === "object" && !Array.isArray(current.evaluation)
    ? { ...(current.evaluation as Record<string, unknown>) }
    : {};
  evaluation.adminNotes = input.notes?.trim() || null;
  return db.hiringApplication.update({
    where: { id: input.applicationId },
    data: {
      status: input.status.trim().toUpperCase(),
      reviewedById: input.reviewedById,
      evaluation: evaluation as Prisma.InputJsonValue,
    },
  });
}

export async function getPublicHiringPosition(slug: string) {
  return db.hiringPosition.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      department: true,
      location: true,
      employmentType: true,
      isPublished: true,
      applicationSchema: true,
    },
  });
}

export async function submitHiringApplication(input: {
  slug: string;
  fullName: string;
  email: string;
  phone?: string | null;
  answers: Record<string, unknown>;
  resumeUrl?: string | null;
  resumeKey?: string | null;
  coverLetter?: string | null;
}) {
  const position = await db.hiringPosition.findUnique({ where: { slug: input.slug } });
  if (!position || !position.isPublished) throw new Error("NOT_FOUND");

  const evaluation = evaluateHiringAnswers(input.answers);
  const application = await db.hiringApplication.create({
    data: {
      positionId: position.id,
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      answers: input.answers as Prisma.InputJsonValue,
      screeningScore: evaluation.score,
      evaluation: evaluation as Prisma.InputJsonValue,
      resumeUrl: input.resumeUrl?.trim() || null,
      resumeKey: input.resumeKey?.trim() || null,
      coverLetter: input.coverLetter?.trim() || null,
      status: "NEW",
    },
  });

  const admins = await db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true },
  });
  if (admins.length > 0) {
    await db.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        channel: "PUSH",
        subject: "New hiring application",
        body: `${input.fullName.trim()} applied for ${position.title}`,
        status: "SENT",
        sentAt: new Date(),
      })),
    });
  }

  return application;
}

export async function getAdminWorkforceOverview(currentUserId: string) {
  await ensureDefaultLearningPaths(currentUserId);
  await ensureDefaultHiringPosition(currentUserId);
  const [directory, groups, posts, channels, learningPaths, documents, recognition, hiring] = await Promise.all([
    listStaffDirectory(),
    listTeamGroups(),
    db.workforcePost.findMany({
      include: { createdBy: { select: { id: true, name: true, role: true, image: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 40,
    }),
    listAccessibleChatChannels(currentUserId),
    listLearningPaths(),
    listStaffDocumentsForAdmin(),
    getRecognitionBoard(),
    listHiringPositionsWithApplications(),
  ]);

  const learningAssignments = await db.learningAssignment.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      path: { select: { id: true, title: true, slug: true, type: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return {
    directory,
    groups,
    posts,
    channels,
    learningPaths,
    learningAssignments,
    documents,
    recognition,
    hiring,
  };
}

export async function getStaffWorkforceOverview(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, image: true } });
  if (!user) throw new Error("NOT_FOUND");

  const [directory, groups, posts, channels, assignments, documents, recognitionBoard] = await Promise.all([
    listStaffDirectory(),
    listTeamGroups(),
    listVisibleWorkforcePosts(userId),
    listAccessibleChatChannels(userId),
    listLearningAssignmentsForUser(userId),
    listStaffDocumentsForUser(userId),
    getRecognitionBoard(),
  ]);

  const myGroups = groups.filter((group) => group.memberUserIds.includes(userId));
  const myRecognitions = recognitionBoard.recentRecognitions.filter((item) => item.user.id === userId);
  const me = recognitionBoard.board.find((item) => item.id === userId) ?? null;

  return {
    me,
    directory,
    groups: myGroups,
    posts,
    channels,
    assignments,
    documents,
    recognitions: myRecognitions,
  };
}

export async function getWorkforceDashboardPosts(userId: string, limit = 3) {
  const posts = await listVisibleWorkforcePosts(userId);
  return posts.slice(0, limit);
}

