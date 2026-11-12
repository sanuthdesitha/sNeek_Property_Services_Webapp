import {
  SENSITIVE_ACTIONS,
  type SensitiveAction,
} from "@/lib/security/sensitive-actions";
import { z } from "zod";
import {
  OPS_BUILTIN_PRESETS,
  OPS_FEATURE_KEYS,
  allOpsLevels,
  type AccessLevel,
  type AccessLevels,
  type OpsFeature,
  type OpsLevels,
} from "./ops-catalog";
import { CAPABILITY_KEYS, GRANT_CAPABILITY_KEYS, type CapabilityKey } from "./capabilities";

const sensitive = z
  .record(
    z.enum(
      Object.keys(SENSITIVE_ACTIONS) as [SensitiveAction, ...SensitiveAction[]],
    ),
    z.boolean(),
  )
  .optional();
/** "full" = Manage plus the area's sensitive capabilities (2026-11 access redesign). */
const level = z.enum(["off", "read", "manage", "full"]);
const features = z.record(
  z.enum(OPS_FEATURE_KEYS as [OpsFeature, ...OpsFeature[]]),
  level,
);
/**
 * Fine-grained capability switches. Only `false` narrows today's access; a
 * `true` never widens past the area level (see access-evaluator.ts).
 */
const capabilities = z
  .record(z.enum(CAPABILITY_KEYS as [CapabilityKey, ...CapabilityKey[]]), z.boolean())
  .optional();
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
            capabilities,
            /** Which list the people using it appear in on the access screen. */
            audience: z.enum(["manager", "assistant"]).optional(),
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
          capabilities,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((policy, context) => {
    const ids = [
      ...OPS_BUILTIN_PRESETS.map((preset) => preset.id as string),
      ...policy.presets.map((preset) => preset.id),
    ];
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Permission presets must have unique IDs.",
      });
    // Administrator capabilities are granted to a person, never through a preset.
    for (const preset of policy.presets) {
      if (GRANT_CAPABILITY_KEYS.some((key) => preset.capabilities?.[key] !== undefined))
        context.addIssue({
          code: "custom",
          message: "Administrator capabilities are granted per person, not in a preset.",
        });
    }
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
export type OpsAssignment = OpsPolicy["assignments"][string];
export type OpsCustomPreset = OpsPolicy["presets"][number];
export type CapabilityOverrides = Partial<Record<CapabilityKey, boolean>>;
export const EMPTY_OPS_POLICY: OpsPolicy = {
  revision: 0,
  presets: [],
  assignments: {},
};

/** A built-in or custom preset, normalised for reading. */
export type OpsPresetView = {
  id: string;
  name: string;
  description: string;
  levels: Partial<AccessLevels>;
  sensitive?: Partial<Record<SensitiveAction, boolean>>;
  capabilities?: CapabilityOverrides;
  audience: "manager" | "assistant";
  builtIn: boolean;
};

export function listPresets(policy: OpsPolicy): OpsPresetView[] {
  return [
    ...OPS_BUILTIN_PRESETS.map((preset) => ({ ...preset, levels: preset.levels as Partial<AccessLevels>, builtIn: true })),
    ...policy.presets.map((preset) => ({ ...preset, audience: preset.audience ?? "manager", builtIn: false })),
  ];
}

export function findPreset(policy: OpsPolicy, presetId: string): OpsPresetView | undefined {
  return listPresets(policy).find((preset) => preset.id === presetId);
}

/**
 * The stored level per area, including "full". An unassigned manager keeps the
 * backwards-compatible default: every area at Manage.
 */
export function resolveAccessLevels(policy: OpsPolicy, userId: string): AccessLevels {
  const assignment = policy.assignments[userId];
  if (!assignment) return allOpsLevels("manage");
  const preset = findPreset(policy, assignment.presetId);
  return { ...allOpsLevels("off"), ...preset?.levels, ...assignment.overrides };
}

/** Route-level view used by middleware, navigation and path guards: Full routes as Manage. */
export function collapseAccessLevel(value: AccessLevel): OpsLevels[OpsFeature] {
  return value === "full" ? "manage" : value;
}

export function resolveOpsLevels(policy: OpsPolicy, userId: string): OpsLevels {
  const detailed = resolveAccessLevels(policy, userId);
  return Object.fromEntries(
    OPS_FEATURE_KEYS.map((key) => [key, collapseAccessLevel(detailed[key])]),
  ) as OpsLevels;
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

/** Explicit sensitive grants only (custom preset, then the person). Full is applied by the evaluator. */
export function resolveSensitiveGrants(policy: OpsPolicy, userId: string) {
  const assignment = policy.assignments[userId];
  if (!assignment) return {};
  const preset = policy.presets.find((item) => item.id === assignment.presetId);
  return { ...preset?.sensitive, ...assignment.sensitive };
}

/** Capability switches: the preset's, then the person's. */
export function resolveCapabilityOverrides(policy: OpsPolicy, userId: string): CapabilityOverrides {
  const assignment = policy.assignments[userId];
  if (!assignment) return {};
  const preset = policy.presets.find((item) => item.id === assignment.presetId);
  return { ...preset?.capabilities, ...assignment.capabilities };
}
