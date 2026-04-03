import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserExtendedProfiles, type UserExtendedProfile } from "@/lib/accounts/user-details";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { renderPdfFromHtml } from "@/lib/reports/pdf";
import { getAppSettings } from "@/lib/settings";
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
  logic?: "AND" | "OR";
  roles?: string[];
  departments?: string[];
  locations?: string[];
  rules?: SmartGroupCondition[];
};

type SmartGroupCondition = {
  field: "suburb" | "jobType" | "qaScore" | "role" | "department" | "location";
  operator: "eq" | "gte" | "lte" | "contains";
  value: string | number | boolean | null;
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
  unreadCount: number;
  pinnedCount: number;
};

type FileAttachment = {
  url: string;
  s3Key: string | null;
  fileName: string | null;
  mimeType: string | null;
  label: string | null;
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
    return { logic: "AND", roles: [], departments: [], locations: [], rules: [] };
  }
  const row = value as Record<string, unknown>;
  return {
    logic: row.logic === "OR" ? "OR" : "AND",
    roles: safeArray(row.roles),
    departments: safeArray(row.departments),
    locations: safeArray(row.locations),
    rules: Array.isArray(row.rules)
      ? row.rules
          .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const candidate = entry as Record<string, unknown>;
            const field = String(candidate.field ?? "").trim() as SmartGroupCondition["field"];
            const operator = String(candidate.operator ?? "").trim() as SmartGroupCondition["operator"];
            if (!field || !operator) return null;
            return {
              field,
              operator,
              value:
                typeof candidate.value === "number" || typeof candidate.value === "boolean" || candidate.value === null
                  ? candidate.value
                  : String(candidate.value ?? ""),
            } satisfies SmartGroupCondition;
          })
          .filter((item): item is SmartGroupCondition => Boolean(item))
      : [],
  };
}

function safeAttachments(value: unknown): FileAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: FileAttachment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url) continue;
    attachments.push({
      url,
      s3Key: typeof row.s3Key === "string" ? row.s3Key.trim() : null,
      fileName: typeof row.fileName === "string" ? row.fileName.trim() : null,
      mimeType: typeof row.mimeType === "string" ? row.mimeType.trim() : null,
      label: typeof row.label === "string" ? row.label.trim() : null,
    });
  }
  return attachments;
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
  const advancedRules = rules.rules ?? [];
  const advancedOk =
    advancedRules.length === 0
      ? true
      : (rules.logic === "OR" ? advancedRules.some((rule) => matchesSmartCondition(user, rule)) : advancedRules.every((rule) => matchesSmartCondition(user, rule)));
  return roleOk && deptOk && locationOk && advancedOk;
}

function matchesSmartCondition(
  user: DirectoryUser,
  rule: NonNullable<SmartGroupRule["rules"]>[number]
) {
  const sourceValue = (() => {
    switch (rule.field) {
      case "role":
        return user.role;
      case "department":
        return user.extendedProfile?.department ?? "";
      case "location":
      case "suburb":
        return user.extendedProfile?.baseLocation ?? "";
      case "qaScore":
        return user.qaAverage ?? 0;
      case "jobType":
        return user.extendedProfile?.jobTitle ?? "";
      default:
        return "";
    }
  })();

  if (typeof sourceValue === "number") {
    const numericValue = typeof rule.value === "number" ? rule.value : Number(rule.value ?? 0);
    if (!Number.isFinite(numericValue)) return false;
    if (rule.operator === "gte") return sourceValue >= numericValue;
    if (rule.operator === "lte") return sourceValue <= numericValue;
    if (rule.operator === "eq") return sourceValue === numericValue;
    return false;
  }

  const left = String(sourceValue ?? "").trim().toLowerCase();
  const right = String(rule.value ?? "").trim().toLowerCase();
  if (!right) return true;
  if (rule.operator === "contains") return left.includes(right);
  return left === right;
}

async function loadGroupStatsForUsers(memberIds: string[]) {
  if (memberIds.length === 0) {
    return {
      averageQaScore: null as number | null,
      activeJobsCount: 0,
      recentRecognitions: 0,
    };
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [assignments, activeJobs, recognitions] = await Promise.all([
    db.jobAssignment.findMany({
      where: {
        userId: { in: memberIds },
        removedAt: null,
        job: { qaReviews: { some: { createdAt: { gte: since } } } },
      },
      select: {
        userId: true,
        job: {
          select: {
            qaReviews: {
              where: { createdAt: { gte: since } },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { score: true },
            },
          },
        },
      },
    }),
    db.jobAssignment.count({
      where: {
        userId: { in: memberIds },
        removedAt: null,
        job: { status: { in: ["ASSIGNED", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW"] } },
      },
    }),
    db.staffRecognition.count({
      where: {
        userId: { in: memberIds },
        createdAt: { gte: since },
      },
    }),
  ]);

  const scores = assignments
    .map((row) => row.job.qaReviews[0]?.score ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    averageQaScore: scores.length > 0 ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)) : null,
    activeJobsCount: activeJobs,
    recentRecognitions: recognitions,
  };
}

export async function previewSmartGroupMembers(input: { membershipMode?: string | null; smartRules?: SmartGroupRule | null; memberUserIds?: string[] }) {
  const directory = await loadStaffDirectoryCore();
  if ((input.membershipMode ?? "").toUpperCase() !== "SMART") {
    const selected = new Set(uniq(input.memberUserIds ?? []));
    return directory.filter((user) => selected.has(user.id));
  }
  const rules = parseSmartRules(input.smartRules);
  return directory.filter((user) => matchesSmartGroup(user, rules));
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
      statsPromiseKey: group.id,
      previewMembers: previews,
      members: resolvedMemberIds
        .map((userId) => directoryById.get(userId))
        .filter((item): item is DirectoryUser => Boolean(item))
        .map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.image,
          department: user.extendedProfile?.department ?? null,
          location: user.extendedProfile?.baseLocation ?? null,
          qaAverage: user.qaAverage,
        })),
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
    where: {
      OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
    },
    include: {
      createdBy: { select: { id: true, name: true, role: true, image: true } },
      reads: { where: { userId }, select: { id: true, readAt: true }, take: 1 },
      _count: { select: { reads: true } },
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 40,
  });
  return posts
    .filter((post) => canUserSeeAudience(user, parseAudience(post.audience), groupIds))
    .map((post) => ({
      ...post,
      attachments: safeAttachments(post.attachments),
      isUnread: (post.reads?.length ?? 0) === 0,
      seenCount: post._count?.reads ?? 0,
    }));
}

export async function listAdminWorkforcePosts() {
  const posts = await db.workforcePost.findMany({
    include: {
      createdBy: { select: { id: true, name: true, role: true, image: true } },
      _count: { select: { reads: true } },
    },
    orderBy: [{ pinned: "desc" }, { publishAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return posts.map((post) => ({
    ...post,
    attachments: safeAttachments(post.attachments),
    seenCount: post._count?.reads ?? 0,
  }));
}

export async function markWorkforcePostRead(postId: string, userId: string) {
  await db.workforcePostRead.upsert({
    where: { postId_userId: { postId, userId } },
    create: { postId, userId },
    update: { readAt: new Date() },
  });
  return true;
}

async function dispatchWorkforcePostNotifications(postId: string) {
  const post = await db.workforcePost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      title: true,
      body: true,
      type: true,
      audience: true,
      notificationsDispatchedAt: true,
    },
  });
  if (!post || post.notificationsDispatchedAt) return false;

  const recipientIds = await resolveAudienceUserIds(parseAudience(post.audience));
  if (recipientIds.length > 0) {
    await db.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        channel: "PUSH",
        subject: post.type === "RECOGNITION" ? "Team recognition" : "Team update",
        body: `${post.title} - ${summarizeText(post.body, 120)}`,
        status: "SENT",
        sentAt: new Date(),
      })),
    });
  }

  await db.workforcePost.update({
    where: { id: post.id },
    data: { notificationsDispatchedAt: new Date() },
  });
  return true;
}

export async function dispatchScheduledWorkforcePosts(now = new Date()) {
  const posts = await db.workforcePost.findMany({
    where: {
      notificationsDispatchedAt: null,
      OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: [{ publishAt: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
  let dispatched = 0;
  for (const post of posts) {
    const sent = await dispatchWorkforcePostNotifications(post.id);
    if (sent) dispatched += 1;
  }
  return { dispatched };
}

export async function createWorkforcePost(input: {
  title: string;
  body: string;
  type?: string;
  coverImageUrl?: string | null;
  pinned?: boolean;
  audience?: AudienceRule | null;
  attachments?: Prisma.JsonValue | null;
  publishAt?: string | null;
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
      publishAt: input.publishAt ? new Date(input.publishAt) : null,
      notificationsDispatchedAt:
        input.publishAt && new Date(input.publishAt).getTime() > Date.now() ? null : new Date(),
      createdById: input.createdById,
    },
  });

  if (!input.publishAt || new Date(input.publishAt).getTime() <= Date.now()) {
    await db.workforcePost.update({ where: { id: post.id }, data: { notificationsDispatchedAt: null } });
    await dispatchWorkforcePostNotifications(post.id);
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
  attachments?: Prisma.JsonValue | null;
  publishAt?: string | null;
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
      attachments: (input.attachments ?? null) as Prisma.InputJsonValue,
      publishAt: input.publishAt ? new Date(input.publishAt) : null,
      notificationsDispatchedAt:
        input.publishAt && new Date(input.publishAt).getTime() > Date.now() ? null : undefined,
    },
  });
}

export async function listAccessibleChatChannels(userId: string) {
  const groups = await listTeamGroups();
  const groupIds = groups.filter((group) => group.memberUserIds.includes(userId)).map((group) => group.id);
  const channels = await db.chatChannel.findMany({
    include: {
      reads: {
        where: { userId },
        select: { lastReadAt: true },
        take: 1,
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          body: true,
          createdAt: true,
          isPinned: true,
          sender: { select: { name: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: 100,
  });
  const visibleChannels = channels
    .filter((channel) => {
      if (channel.groupId) return groupIds.includes(channel.groupId);
      const directMembers = safeArray(channel.memberUserIds);
      return directMembers.includes(userId);
    });
  const unreadCounts = await Promise.all(
    visibleChannels.map((channel) =>
      db.chatMessage.count({
        where: {
          channelId: channel.id,
          ...(channel.reads[0]?.lastReadAt ? { createdAt: { gt: channel.reads[0].lastReadAt } } : {}),
        },
      })
    )
  );
  return visibleChannels.map((channel, index) => ({
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
      unreadCount: unreadCounts[index] ?? 0,
      pinnedCount: channel.messages.filter((message) => message.isPinned).length,
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

export async function listChatMessagesForUser(userId: string, channelId: string, afterId?: string | null) {
  const allowed = await canAccessChatChannel(userId, channelId);
  if (!allowed) throw new Error("FORBIDDEN");
  const messages = await db.chatMessage.findMany({
    where: { channelId },
    include: { sender: { select: { id: true, name: true, role: true, image: true } } },
    orderBy: [{ isPinned: "desc" }, { pinnedAt: "desc" }, { createdAt: "asc" }],
    take: 500,
  });
  await markChatChannelRead(channelId, userId);
  if (!afterId?.trim()) return messages;
  const index = messages.findIndex((message) => message.id === afterId);
  return index >= 0 ? messages.slice(index + 1) : messages;
}

export async function markChatChannelRead(channelId: string, userId: string) {
  const allowed = await canAccessChatChannel(userId, channelId);
  if (!allowed) throw new Error("FORBIDDEN");
  await db.chatChannelRead.upsert({
    where: { channelId_userId: { channelId, userId } },
    create: { channelId, userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

export async function createChatMessage(input: {
  channelId: string;
  senderId: string;
  body: string;
  attachments?: Prisma.JsonValue | null;
}) {
  const allowed = await canAccessChatChannel(input.senderId, input.channelId);
  if (!allowed) throw new Error("FORBIDDEN");

  const channel = await db.chatChannel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new Error("NOT_FOUND");

  const message = await db.chatMessage.create({
    data: {
      channelId: input.channelId,
      senderId: input.senderId,
      body: input.body.trim(),
      attachments: (input.attachments ?? null) as Prisma.InputJsonValue,
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

export async function updateChatMessage(input: {
  channelId: string;
  messageId: string;
  userId: string;
  body?: string | null;
  delete?: boolean;
  pin?: boolean | null;
}) {
  const allowed = await canAccessChatChannel(input.userId, input.channelId);
  if (!allowed) throw new Error("FORBIDDEN");
  const message = await db.chatMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, senderId: true, channelId: true },
  });
  if (!message || message.channelId !== input.channelId) throw new Error("NOT_FOUND");
  const actor = await db.user.findUnique({ where: { id: input.userId }, select: { role: true } });
  const canModerate = actor?.role === Role.ADMIN || actor?.role === Role.OPS_MANAGER;
  if (message.senderId !== input.userId && !canModerate) throw new Error("FORBIDDEN");

  if (input.delete === true) {
    await db.chatMessage.delete({ where: { id: input.messageId } });
    return { ok: true, deleted: true };
  }

  return db.chatMessage.update({
    where: { id: input.messageId },
    data: {
      body: input.body !== undefined && input.body !== null ? input.body.trim() : undefined,
      isPinned: canModerate && typeof input.pin === "boolean" ? input.pin : undefined,
      pinnedAt: canModerate && typeof input.pin === "boolean" ? (input.pin ? new Date() : null) : undefined,
    },
    include: { sender: { select: { id: true, name: true, role: true, image: true } } },
  });
}

export async function updateChatChannel(input: {
  channelId: string;
  name?: string | null;
  description?: string | null;
  memberUserIds?: string[];
}) {
  const existing = await db.chatChannel.findUnique({ where: { id: input.channelId } });
  if (!existing) throw new Error("NOT_FOUND");
  return db.chatChannel.update({
    where: { id: input.channelId },
    data: {
      name: input.name?.trim() || existing.name,
      description: input.description !== undefined ? input.description?.trim() || null : existing.description,
      memberUserIds:
        input.memberUserIds !== undefined
          ? (uniq(input.memberUserIds) as Prisma.InputJsonValue)
          : existing.memberUserIds === null
            ? Prisma.JsonNull
            : (existing.memberUserIds as Prisma.InputJsonValue),
    },
  });
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
      mandatory: true,
    },
    {
      slug: DEFAULT_CLEANER_ONBOARDING_SLUG,
      title: "Cleaner Onboarding Foundations",
      type: "COURSE",
      description: "Interactive onboarding for short-stay operations, app workflow, chemical use, bed standards, restocking, and difficult situations.",
      coverImageUrl: "/workforce/airbnb-turnover.svg",
      schema: buildCleanerOnboardingSchema(),
      mandatory: true,
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
        mandatory: path.mandatory === true,
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
        mandatory: path.mandatory === true,
      },
    });
  }
}

async function ensureUniqueLearningSlug(preferred: string, excludeId?: string | null) {
  const slugBase = slugify(preferred);
  let slug = slugBase;
  let attempts = 1;

  while (true) {
    const existing = await db.learningPath.findUnique({
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

export async function autoAssignCleanerLearning(userId: string, assignedById?: string | null) {
  const paths = await db.learningPath.findMany({
    where: { isPublished: true, mandatory: true },
    select: { id: true, audience: true, slug: true },
  });
  const cleanerPaths = paths.filter((path) => {
    if (path.slug === DEFAULT_CLEANER_ASSESSMENT_SLUG || path.slug === DEFAULT_CLEANER_ONBOARDING_SLUG) return true;
    const audience = path.audience && typeof path.audience === "object" && !Array.isArray(path.audience)
      ? (path.audience as Record<string, unknown>)
      : {};
    return safeArray(audience.roles).includes(Role.CLEANER);
  });
  for (const path of cleanerPaths) {
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

async function assignMandatoryLearningForRole(userId: string, role: Role, assignedById?: string | null) {
  const paths = await db.learningPath.findMany({
    where: { isPublished: true, mandatory: true },
    select: { id: true, slug: true, audience: true },
  });
  const matching = paths.filter((path) => {
    if (role === Role.CLEANER && (path.slug === DEFAULT_CLEANER_ASSESSMENT_SLUG || path.slug === DEFAULT_CLEANER_ONBOARDING_SLUG)) {
      return true;
    }
    const audience = path.audience && typeof path.audience === "object" && !Array.isArray(path.audience)
      ? (path.audience as Record<string, unknown>)
      : {};
    const roles = safeArray(audience.roles);
    return roles.length === 0 || roles.includes(role);
  });

  for (const path of matching) {
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

function deriveHiringUserRole(offerDetails: Record<string, unknown> | null | undefined) {
  const roleText = String(offerDetails?.roleTitle ?? "").toLowerCase();
  if (roleText.includes("laundry")) return Role.LAUNDRY;
  if (roleText.includes("ops")) return Role.OPS_MANAGER;
  return Role.CLEANER;
}

async function createOrUpdateHiredStaffAccount(input: {
  applicationId: string;
  email: string;
  fullName: string;
  phone?: string | null;
  reviewedById: string;
  offerDetails?: Record<string, unknown> | null;
  existingUserId?: string | null;
}) {
  const role = deriveHiringUserRole(input.offerDetails);
  const email = input.email.trim().toLowerCase();
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await db.$transaction(async (tx) => {
    const existingById = input.existingUserId
      ? await tx.user.findUnique({ where: { id: input.existingUserId }, select: { id: true, role: true, email: true } })
      : null;
    const existingByEmail = await tx.user.findUnique({
      where: { email },
      select: { id: true, role: true, email: true, name: true },
    });
    const target = existingById ?? existingByEmail;

    if (existingByEmail && existingById && existingByEmail.id !== existingById.id) {
      throw new Error("Another account already uses this email.");
    }
    if (target && target.role === Role.CLIENT) {
      throw new Error("This email is already linked to a client account.");
    }

    const userRow = target
      ? await tx.user.update({
          where: { id: target.id },
          data: {
            name: input.fullName.trim(),
            email,
            phone: input.phone?.trim() || undefined,
            role,
            isActive: true,
            emailVerified: new Date(),
            passwordHash,
          },
          select: { id: true, name: true, email: true, phone: true, role: true },
        })
      : await tx.user.create({
          data: {
            name: input.fullName.trim(),
            email,
            phone: input.phone?.trim() || undefined,
            role,
            isActive: true,
            emailVerified: new Date(),
            passwordHash,
          },
          select: { id: true, name: true, email: true, phone: true, role: true },
        });

    await tx.session.deleteMany({ where: { userId: userRow.id } });
    await tx.hiringApplication.update({
      where: { id: input.applicationId },
      data: { hiredUserId: userRow.id },
    });

    return userRow;
  });

  await upsertAuthUserState(user.id, {
    requiresOnboarding: true,
    requiresPasswordReset: true,
    tutorialSeen: false,
    welcomeEmailSent: false,
    profileCreationNotified: false,
  });

  await assignMandatoryLearningForRole(user.id, user.role, input.reviewedById);

  const requiredDocs =
    user.role === Role.CLEANER
      ? [
          { category: "COMPLIANCE", title: "Police check" },
          { category: "COMPLIANCE", title: "Driver licence" },
          { category: "TRAINING", title: "White card / site card" },
        ]
      : [
          { category: "COMPLIANCE", title: "Police check" },
          { category: "COMPLIANCE", title: "Driver licence" },
        ];

  for (const doc of requiredDocs) {
    const existingRequest = await db.staffDocumentRequest.findFirst({
      where: {
        userId: user.id,
        title: doc.title,
        status: { in: ["REQUESTED", "FULFILLED"] },
      },
      select: { id: true },
    });
    if (!existingRequest) {
      await createStaffDocumentRequest({
        userId: user.id,
        requestedById: input.reviewedById,
        category: doc.category,
        title: doc.title,
        notes: "Please upload this document in your workforce hub during onboarding.",
      });
    }
  }

  const settings = await getAppSettings();
  const template = renderEmailTemplate(settings, "accountInvite", {
    userName: user.name ?? user.email,
    role: user.role,
    email: user.email,
    tempPassword,
    welcomeNote: "Complete your onboarding, upload your required documents, and start your assigned learning in the workforce hub.",
    actionUrl: resolveAppUrl("/login"),
    actionLabel: "Sign in and set your password",
  });
  const emailResult = await sendEmailDetailed({
    to: user.email,
    subject: template.subject,
    html: template.html,
  });
  if (emailResult.ok) {
    await upsertAuthUserState(user.id, { welcomeEmailSent: true });
  }

  if (user.phone) {
    await sendSmsDetailed(user.phone, `Welcome to sNeek. Your account is ready. Sign in, set your password, and complete onboarding in the team hub.`);
  }

  return { user, tempPassword: emailResult.ok ? null : tempPassword, emailSent: emailResult.ok };
}

export async function listLearningPaths(options?: { includeDrafts?: boolean }) {
  return db.learningPath.findMany({
    where: options?.includeDrafts ? undefined : { isPublished: true },
    orderBy: [{ type: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      description: true,
      coverImageUrl: true,
      audience: true,
      isPublished: true,
      mandatory: true,
      schema: true,
      createdAt: true,
    },
  });
}

export async function createLearningPath(input: {
  title: string;
  slug?: string | null;
  type?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  audience?: Record<string, unknown> | null;
  schema?: Record<string, unknown> | null;
  isPublished?: boolean;
  mandatory?: boolean;
  createdById: string;
}) {
  const slug = await ensureUniqueLearningSlug(input.slug?.trim() || input.title);
  return db.learningPath.create({
    data: {
      title: input.title.trim(),
      slug,
      type: input.type?.trim() || "COURSE",
      description: input.description?.trim() || null,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      audience: (input.audience ?? { roles: [Role.CLEANER] }) as Prisma.InputJsonValue,
      schema: (input.schema ?? { version: 1, audienceRoles: [Role.CLEANER], scoringModel: "guided_course_with_checks", modules: [] }) as Prisma.InputJsonValue,
      isPublished: input.isPublished === true,
      mandatory: input.mandatory === true,
      createdById: input.createdById,
    },
  });
}

export async function updateLearningPath(input: {
  pathId: string;
  title?: string | null;
  slug?: string | null;
  type?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  audience?: Record<string, unknown> | null;
  schema?: Record<string, unknown> | null;
  isPublished?: boolean;
  mandatory?: boolean;
}) {
  const current = await db.learningPath.findUnique({ where: { id: input.pathId } });
  if (!current) throw new Error("NOT_FOUND");
  const slug = input.slug !== undefined || input.title !== undefined
    ? await ensureUniqueLearningSlug(input.slug?.trim() || input.title?.trim() || current.slug, current.id)
    : current.slug;
  return db.learningPath.update({
    where: { id: input.pathId },
    data: {
      title: input.title?.trim() || current.title,
      slug,
      type: input.type?.trim() || current.type,
      description: input.description !== undefined ? input.description?.trim() || null : current.description,
      coverImageUrl: input.coverImageUrl !== undefined ? input.coverImageUrl?.trim() || null : current.coverImageUrl,
      audience: input.audience !== undefined ? (input.audience as Prisma.InputJsonValue) : current.audience === null ? Prisma.JsonNull : (current.audience as Prisma.InputJsonValue),
      schema: input.schema !== undefined ? (input.schema as Prisma.InputJsonValue) : (current.schema as Prisma.InputJsonValue),
      isPublished: input.isPublished !== undefined ? input.isPublished : current.isPublished,
      mandatory: input.mandatory !== undefined ? input.mandatory : current.mandatory,
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

export async function listStaffDocumentsForAdmin(filters?: {
  category?: string | null;
  userId?: string | null;
  expiryStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "" | null;
}) {
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return db.staffDocument.findMany({
    where: {
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.userId ? { userId: filters.userId } : {}),
      ...(filters?.expiryStatus === "EXPIRED"
        ? { expiresAt: { lt: now } }
        : filters?.expiryStatus === "EXPIRING_SOON"
          ? { expiresAt: { gte: now, lte: soon } }
          : filters?.expiryStatus === "ACTIVE"
            ? { OR: [{ expiresAt: null }, { expiresAt: { gt: soon } }] }
            : {}),
    },
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      uploadedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
      fulfilledRequests: {
        select: {
          id: true,
          title: true,
          status: true,
          requestedBy: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function listStaffDocumentsForUser(userId: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [documents, requests] = await Promise.all([
    db.staffDocument.findMany({
      where: { userId },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true } },
        fulfilledRequests: {
          select: {
            id: true,
            title: true,
            status: true,
            requestedBy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.staffDocumentRequest.findMany({
      where: { userId, status: { in: ["REQUESTED", "FULFILLED"] } },
      include: {
        requestedBy: { select: { id: true, name: true } },
        fulfilledDocument: { select: { id: true, title: true, url: true, status: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return {
    documents: documents.map((doc) => ({
      ...doc,
      expiryStatus:
        !doc.expiresAt ? "ACTIVE" : doc.expiresAt < now ? "EXPIRED" : doc.expiresAt <= soon ? "EXPIRING_SOON" : "ACTIVE",
    })),
    requests,
  };
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
  requiresSignature?: boolean;
  requestId?: string | null;
}) {
  const document = await db.staffDocument.create({
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
      requiresSignature: input.requiresSignature === true,
    },
  });

  if (input.requestId?.trim()) {
    await db.staffDocumentRequest.updateMany({
      where: { id: input.requestId.trim(), userId: input.userId },
      data: { status: "FULFILLED", fulfilledDocumentId: document.id },
    });
  }

  return document;
}

export async function listStaffDocumentRequestsForAdmin() {
  return db.staffDocumentRequest.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      requestedBy: { select: { id: true, name: true } },
      fulfilledDocument: { select: { id: true, title: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function createStaffDocumentRequest(input: {
  userId: string;
  requestedById: string;
  category: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
}) {
  const request = await db.staffDocumentRequest.create({
    data: {
      userId: input.userId,
      requestedById: input.requestedById,
      category: input.category.trim().toUpperCase(),
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      requestedBy: { select: { id: true, name: true } },
    },
  });

  await db.notification.create({
    data: {
      userId: request.userId,
      channel: "PUSH",
      subject: "Document requested",
      body: `${request.requestedBy.name ?? "Admin"} requested ${request.title}.`,
      status: "SENT",
      sentAt: new Date(),
    },
  });

  if (request.user.email) {
    await sendEmailDetailed({
      to: request.user.email,
      subject: `Document requested - ${request.title}`,
      html: `<p>Hi ${request.user.name ?? "there"},</p><p>Please upload the following document in your team hub: <strong>${request.title}</strong>.</p>${request.notes ? `<p>${request.notes}</p>` : ""}`,
    });
  }
  if (request.user.phone) {
    await sendSmsDetailed(request.user.phone, `Document requested: ${request.title}. Upload it in your sNeek team hub.`);
  }

  return request;
}

export async function signStaffDocument(input: { documentId: string; userId: string }) {
  const document = await db.staffDocument.findUnique({
    where: { id: input.documentId },
    select: { id: true, userId: true, requiresSignature: true },
  });
  if (!document || document.userId !== input.userId) throw new Error("NOT_FOUND");
  if (!document.requiresSignature) throw new Error("This document does not require signature.");
  return db.staffDocument.update({
    where: { id: input.documentId },
    data: {
      status: "SIGNED",
      verifiedAt: new Date(),
      verifiedById: input.userId,
    },
  });
}

export async function reviewStaffDocument(input: {
  documentId: string;
  reviewerId: string;
  status: string;
  notes?: string | null;
  expiresAt?: string | null;
  requiresSignature?: boolean;
}) {
  return db.staffDocument.update({
    where: { id: input.documentId },
    data: {
      status: input.status.trim().toUpperCase(),
      notes: input.notes?.trim() || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      requiresSignature: input.requiresSignature === true,
      verifiedById: input.reviewerId,
      verifiedAt: new Date(),
    },
  });
}

export async function runDocumentExpiryCheck(now = new Date()) {
  const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const rows = await db.staffDocument.findMany({
    where: {
      expiresAt: { not: null, lte: soon },
      status: { not: "EXPIRED" },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    take: 500,
  });

  const admins = await db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, email: true },
  });

  let warned = 0;
  let expired = 0;
  for (const row of rows) {
    const isExpired = !!row.expiresAt && row.expiresAt < now;
    if (isExpired) {
      expired += 1;
      await db.staffDocument.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    } else {
      warned += 1;
    }

    const subject = isExpired ? `Expired document - ${row.title}` : `Document expiring soon - ${row.title}`;
    const body = isExpired
      ? `${row.title} for ${row.user.name ?? "staff"} has expired and needs replacement.`
      : `${row.title} for ${row.user.name ?? "staff"} expires within 14 days.`;

    if (row.user.email) {
      await sendEmailDetailed({
        to: row.user.email,
        subject,
        html: `<p>${body}</p>`,
      });
    }
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          channel: "PUSH",
          subject,
          body,
          status: "SENT",
          sentAt: new Date(),
        })),
      });
    }
  }

  return { warned, expired };
}

export async function getRecognitionBoard() {
  const directory = (await loadStaffDirectoryCore()).filter((user) => FRONTLINE_ROLES.includes(user.role));
  const recentRecognitions = await db.staffRecognition.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      sentBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 36,
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [completedRows, monthRecognitionCounts] = await Promise.all([
    db.jobAssignment.groupBy({
      by: ["userId"],
      where: {
        removedAt: null,
        userId: { in: directory.map((user) => user.id) },
        job: { status: { in: ["COMPLETED", "INVOICED"] }, scheduledDate: { gte: monthStart } },
      },
      _count: { _all: true },
    }),
    db.staffRecognition.groupBy({
      by: ["userId"],
      where: { userId: { in: directory.map((user) => user.id) } },
      _count: { _all: true },
    }),
  ]);

  const completedMap = new Map(completedRows.map((row) => [row.userId, row._count._all]));
  const recognitionMap = new Map(monthRecognitionCounts.map((row) => [row.userId, row._count._all]));

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
      monthJobsCompleted: completedMap.get(user.id) ?? 0,
      recognitionsReceived: recognitionMap.get(user.id) ?? 0,
    }))
    .sort((left, right) => {
      const rightScore = right.qaAverage ?? -1;
      const leftScore = left.qaAverage ?? -1;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return right.publicRecognitionCount - left.publicRecognitionCount;
    });

  const qaLeaderboard = [...board]
    .filter((row) => typeof row.qaAverage === "number")
    .sort((a, b) => (b.qaAverage ?? 0) - (a.qaAverage ?? 0))
    .slice(0, 5);
  const completedLeaderboard = [...board]
    .sort((a, b) => (b.monthJobsCompleted ?? 0) - (a.monthJobsCompleted ?? 0))
    .slice(0, 5);
  const recognitionLeaderboard = [...board]
    .sort((a, b) => (b.recognitionsReceived ?? 0) - (a.recognitionsReceived ?? 0))
    .slice(0, 5);
  const spotlight = recentRecognitions.find((item) => item.celebrationStyle === "SPOTLIGHT" && item.createdAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) ?? null;
  const publicWall = recentRecognitions.filter((item) => item.isPublic);

  return {
    board,
    recentRecognitions,
    spotlight,
    publicWall,
    leaderboard: {
      qa: qaLeaderboard,
      completed: completedLeaderboard,
      recognition: recognitionLeaderboard,
    },
  };
}

async function hasRecentRecognition(userId: string, badgeKey: string, since: Date) {
  const existing = await db.staffRecognition.findFirst({
    where: {
      userId,
      badgeKey,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function runRecognitionCheck(now = new Date()) {
  const systemAdmin = await db.user.findFirst({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!systemAdmin) return { created: 0 };

  const cleaners = (await loadStaffDirectoryCore()).filter((row) => row.role === Role.CLEANER);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let created = 0;

  const completedCounts = await db.jobAssignment.groupBy({
    by: ["userId"],
    where: {
      removedAt: null,
      userId: { in: cleaners.map((row) => row.id) },
      job: { status: { in: ["COMPLETED", "INVOICED"] } },
    },
    _count: { _all: true },
  });
  const completedMap = new Map(completedCounts.map((row) => [row.userId, row._count._all]));

  for (const cleaner of cleaners) {
    const completed = completedMap.get(cleaner.id) ?? 0;
    for (const milestone of [10, 50, 100]) {
      const badgeKey = `milestone_${milestone}`;
      if (completed >= milestone && !(await hasRecentRecognition(cleaner.id, badgeKey, new Date("2000-01-01")))) {
        await sendRecognition({
          userId: cleaner.id,
          sentById: systemAdmin.id,
          badgeKey,
          title: `${milestone} jobs completed`,
          message: `${cleaner.name ?? "This cleaner"} has completed ${milestone}+ jobs and hit an important milestone.`,
          celebrationStyle: "MILESTONE",
          isPublic: true,
        });
        created += 1;
      }
    }
  }

  const recentQaAssignments = await db.jobAssignment.findMany({
    where: {
      removedAt: null,
      userId: { in: cleaners.map((row) => row.id) },
      job: {
        qaReviews: { some: { createdAt: { gte: monthAgo } } },
      },
    },
    select: {
      userId: true,
      job: {
        select: {
          scheduledDate: true,
          qaReviews: {
            where: { createdAt: { gte: monthAgo } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { score: true },
          },
          issueTickets: {
            where: { clientVisible: true, status: { not: "RESOLVED" } },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { job: { scheduledDate: "desc" } },
  });

  const qaByUser = new Map<string, number[]>();
  const unresolvedByUser = new Map<string, number>();
  for (const row of recentQaAssignments) {
    const latest = row.job.qaReviews[0]?.score;
    if (typeof latest === "number") {
      const bucket = qaByUser.get(row.userId) ?? [];
      bucket.push(latest);
      qaByUser.set(row.userId, bucket);
    }
    if (row.job.issueTickets.length > 0) {
      unresolvedByUser.set(row.userId, (unresolvedByUser.get(row.userId) ?? 0) + row.job.issueTickets.length);
    }
  }

  for (const cleaner of cleaners) {
    const scores = qaByUser.get(cleaner.id) ?? [];
    if (scores.length >= 5 && scores.slice(0, 5).every((score) => score >= 90) && !(await hasRecentRecognition(cleaner.id, "quality_star", monthAgo))) {
      await sendRecognition({
        userId: cleaner.id,
        sentById: systemAdmin.id,
        badgeKey: "quality_star",
        title: "Punctuality & Presence",
        message: "Five strong QA outcomes in a row. Reliable guest-ready execution is being noticed.",
        celebrationStyle: "SPOTLIGHT",
        isPublic: true,
      });
      created += 1;
    }
    if (scores.length >= 3 && (unresolvedByUser.get(cleaner.id) ?? 0) === 0 && !(await hasRecentRecognition(cleaner.id, "client_fave", monthAgo))) {
      await sendRecognition({
        userId: cleaner.id,
        sentById: systemAdmin.id,
        badgeKey: "client_fave",
        title: "Client Favourite",
        message: "Strong recent job outcomes with no active client-visible complaints in the last 30 days.",
        celebrationStyle: "TEAM_SHOUTOUT",
        isPublic: true,
      });
      created += 1;
    }
  }

  const spotlessWinner = cleaners
    .map((cleaner) => ({ cleaner, average: (() => {
      const scores = qaByUser.get(cleaner.id) ?? [];
      return scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : -1;
    })() }))
    .filter((row) => row.average >= 0)
    .sort((a, b) => b.average - a.average)[0];
  if (spotlessWinner && !(await hasRecentRecognition(spotlessWinner.cleaner.id, "spotless", monthAgo))) {
    await sendRecognition({
      userId: spotlessWinner.cleaner.id,
      sentById: systemAdmin.id,
      badgeKey: "spotless",
      title: "Clean of the Month",
      message: "Top QA average across the last 30 days.",
      celebrationStyle: "SPOTLIGHT",
      isPublic: true,
    });
    created += 1;
  }

  const reliabilityRows = await db.jobAssignment.groupBy({
    by: ["userId"],
    where: {
      userId: { in: cleaners.map((row) => row.id) },
      removedAt: null,
      job: { scheduledDate: { gte: monthAgo }, status: { in: ["COMPLETED", "INVOICED"] } },
    },
    _count: { _all: true },
  });
  for (const row of reliabilityRows) {
    const removedCount = await db.jobAssignment.count({
      where: {
        userId: row.userId,
        removedAt: { gte: monthAgo },
      },
    });
    if (row._count._all >= 5 && removedCount === 0 && !(await hasRecentRecognition(row.userId, "reliable", monthAgo))) {
      await sendRecognition({
        userId: row.userId,
        sentById: systemAdmin.id,
        badgeKey: "reliable",
        title: "Reliability Champion",
        message: "Five or more recent completed jobs with no assignment removals this month.",
        celebrationStyle: "TEAM_SHOUTOUT",
        isPublic: true,
      });
      created += 1;
    }
  }

  return { created };
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
        hiredUser: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return { positions, applications };
}

export async function listHiringPositions() {
  return db.hiringPosition.findMany({
    orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
    include: { createdBy: { select: { id: true, name: true } }, _count: { select: { applications: true } } },
  });
}

export async function renderLearningCertificatePdf(assignmentId: string, userId: string) {
  const assignment = await db.learningAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      path: { select: { title: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!assignment || assignment.userId !== userId) throw new Error("NOT_FOUND");
  if (assignment.status !== "COMPLETED" || !assignment.completedAt) throw new Error("Certificate is only available after completion.");

  const settings = await getAppSettings();
  const companyName = settings.companyName?.trim() || "sNeek Property Services";
  const logoUrl = settings.logoUrl?.trim() || "";
  const staffName = assignment.user.name?.trim() || assignment.user.email;
  const completedOn = assignment.completedAt.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const html = `
    <html>
      <body style="margin:0;font-family:Arial,sans-serif;background:#f5f8f7;color:#0f172a;">
        <div style="padding:40px 28px;">
          <div style="max-width:900px;margin:0 auto;background:white;border:1px solid #dbe4e1;border-radius:28px;padding:56px 48px;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;">
              <div>
                <div style="font-size:12px;letter-spacing:0.28em;text-transform:uppercase;color:#0f766e;font-weight:700;">Certificate of Completion</div>
                <h1 style="margin:14px 0 0;font-size:40px;line-height:1.08;">${companyName}</h1>
              </div>
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="height:72px;max-width:180px;object-fit:contain;" />` : ""}
            </div>
            <div style="margin-top:56px;border-radius:24px;background:linear-gradient(135deg,#f0fdfa,#fff7ed);padding:36px;border:1px solid #dbe4e1;">
              <p style="margin:0;font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#475569;">Awarded to</p>
              <h2 style="margin:14px 0 0;font-size:38px;line-height:1.1;">${staffName}</h2>
              <p style="margin:18px 0 0;font-size:18px;line-height:1.7;">For successfully completing <strong>${assignment.path.title}</strong> on ${completedOn}.</p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.7;color:#475569;">This confirms the staff member completed the assigned course in the workforce learning hub.</p>
            </div>
            <div style="margin-top:46px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;">
              <div>
                <div style="font-size:13px;color:#64748b;">Completion score</div>
                <div style="margin-top:6px;font-size:28px;font-weight:700;">${typeof assignment.score === "number" ? `${Math.round(assignment.score)}%` : "Completed"}</div>
              </div>
              <div style="text-align:right;">
                <div style="border-top:1px solid #94a3b8;padding-top:8px;font-size:13px;color:#64748b;">Issued automatically by ${companyName}</div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  return renderPdfFromHtml(html, "learning certificate");
}

export async function listHiringApplications() {
  return db.hiringApplication.findMany({
    include: {
      position: { select: { id: true, title: true, slug: true } },
      reviewedBy: { select: { id: true, name: true } },
      hiredUser: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
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
  interviewNotes?: string | null;
  interviewDate?: string | null;
  offerDetails?: Record<string, unknown> | null;
  rejectionReason?: string | null;
}) {
  const current = await db.hiringApplication.findUnique({ where: { id: input.applicationId } });
  if (!current) throw new Error("NOT_FOUND");
  const nextStatus = input.status.trim().toUpperCase();
  const evaluation = current.evaluation && typeof current.evaluation === "object" && !Array.isArray(current.evaluation)
    ? { ...(current.evaluation as Record<string, unknown>) }
    : {};
  evaluation.adminNotes = input.notes?.trim() || null;
  const updated = await db.hiringApplication.update({
    where: { id: input.applicationId },
    data: {
      status: nextStatus,
      reviewedById: input.reviewedById,
      evaluation: evaluation as Prisma.InputJsonValue,
      interviewNotes: input.interviewNotes?.trim() || null,
      interviewDate: input.interviewDate ? new Date(input.interviewDate) : null,
      offerDetails: (input.offerDetails ?? null) as Prisma.InputJsonValue,
      rejectionReason: input.rejectionReason?.trim() || null,
    },
  });

  if (nextStatus === "HIRED") {
    await createOrUpdateHiredStaffAccount({
      applicationId: updated.id,
      email: current.email,
      fullName: current.fullName,
      phone: current.phone,
      reviewedById: input.reviewedById,
      offerDetails: input.offerDetails ?? (current.offerDetails as Record<string, unknown> | null),
      existingUserId: current.hiredUserId,
    });
  }

  return db.hiringApplication.findUnique({
    where: { id: updated.id },
    include: {
      position: { select: { id: true, title: true, slug: true } },
      reviewedBy: { select: { id: true, name: true } },
      hiredUser: { select: { id: true, name: true, email: true, role: true } },
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
  const [directory, groups, posts, channels, learningPaths, documents, documentRequests, recognition, hiring] = await Promise.all([
    listStaffDirectory(),
    listTeamGroups(),
    listAdminWorkforcePosts(),
    listAccessibleChatChannels(currentUserId),
    listLearningPaths({ includeDrafts: true }),
    listStaffDocumentsForAdmin(),
    listStaffDocumentRequestsForAdmin(),
    getRecognitionBoard(),
    listHiringPositionsWithApplications(),
  ]);
  const groupStats = await Promise.all(groups.map((group) => loadGroupStatsForUsers(group.memberUserIds)));
  const groupsWithStats = groups.map((group, index) => ({
    ...group,
    stats: groupStats[index],
  }));

  const learningAssignments = await db.learningAssignment.findMany({
    include: {
      user: { select: { id: true, name: true, role: true, image: true } },
      path: { select: { id: true, title: true, slug: true, type: true, mandatory: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return {
    directory,
    groups: groupsWithStats,
    posts,
    channels,
    learningPaths,
    learningAssignments,
    documents,
    documentRequests,
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
    documents: documents.documents,
    documentRequests: documents.requests,
    recognitions: myRecognitions,
    recognitionBoard,
  };
}

export async function getWorkforceDashboardPosts(userId: string, limit = 3) {
  const posts = await listVisibleWorkforcePosts(userId);
  return posts.slice(0, limit);
}




