import {
  SENSITIVE_ACTIONS,
  type SensitiveAction,
} from "@/lib/security/sensitive-actions";
import { z } from "zod";
import {
  OPS_BUILTIN_PRESETS,
  OPS_FEATURE_KEYS,
  allOpsLevels,
  type OpsLevels,
} from "./ops-catalog";

const sensitive = z
  .record(
    z.enum(
      Object.keys(SENSITIVE_ACTIONS) as [SensitiveAction, ...SensitiveAction[]],
    ),
    z.boolean(),
  )
  .optional();
const level = z.enum(["off", "read", "manage"]);
const features = z.record(
  z.enum(
    OPS_FEATURE_KEYS as [
      (typeof OPS_FEATURE_KEYS)[number],
      ...(typeof OPS_FEATURE_KEYS)[number][],
    ],
  ),
  level,
);
export const opsPolicySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    presets: z
      .array(
        z
          .object({
            id: z.string().regex(/^custom-[a-zA-Z0-9_-]{1,70}$/),
            name: z.string().trim().min(1).max(80),
            description: z.string().trim().max(300),
            levels: features,
            sensitive,
          })
          .strict(),
      )
      .max(100),
    assignments: z.record(
      z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      z
        .object({
          presetId: z.string().max(80),
          overrides: features,
          sensitive,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((policy, context) => {
    const ids = [
      ...OPS_BUILTIN_PRESETS.map((preset) => preset.id),
      ...policy.presets.map((preset) => preset.id),
    ];
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Permission presets must have unique IDs.",
      });
    if (Object.keys(policy.assignments).length > 2000)
      context.addIssue({ code: "custom", message: "Too many assignments." });
    for (const assignment of Object.values(policy.assignments)) {
      if (!ids.includes(assignment.presetId))
        context.addIssue({
          code: "custom",
          message: "Every manager must reference an existing preset.",
        });
    }
  });
export type OpsPolicy = z.infer<typeof opsPolicySchema>;
export const EMPTY_OPS_POLICY: OpsPolicy = {
  revision: 0,
  presets: [],
  assignments: {},
};
export function resolveOpsLevels(policy: OpsPolicy, userId: string): OpsLevels {
  const assignment = policy.assignments[userId];
  if (!assignment) return allOpsLevels("manage");
  const preset = [...OPS_BUILTIN_PRESETS, ...policy.presets].find(
    (preset) => preset.id === assignment.presetId,
  );
  return { ...allOpsLevels("off"), ...preset?.levels, ...assignment.overrides };
}
export function isOpsSubject(user: {
  role: string;
  heldRoles?: string[];
}): boolean {
  // An effective ADMIN never inherits a manager feature pack. Impersonation
  // replaces both role and heldRoles with the target before this check.
  if (user.role === "ADMIN") return false;
  const roles = user.heldRoles ?? [user.role];
  return !roles.includes("ADMIN") && roles.includes("OPS_MANAGER");
}

export function resolveSensitiveGrants(policy: OpsPolicy, userId: string) {
  const assignment = policy.assignments[userId];
  if (!assignment) return {};
  const preset = policy.presets.find((item) => item.id === assignment.presetId);
  return { ...preset?.sensitive, ...assignment.sensitive };
}
