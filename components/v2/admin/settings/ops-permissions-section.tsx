"use client";

import { useEffect, useState } from "react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import {
  OPS_BUILTIN_PRESETS,
  OPS_FEATURES,
  OPS_LEVEL_LABELS,
  allOpsLevels,
  type OpsFeature,
  type OpsLevel,
} from "@/lib/rbac/ops-catalog";
import {
  opsPolicySchema,
  resolveOpsLevels,
  resolveSensitiveGrants,
  type OpsPolicy,
} from "@/lib/rbac/ops-policy";

import {
  SENSITIVE_ACTIONS,
  type SensitiveAction,
} from "@/lib/security/sensitive-actions";

type Manager = { id: string; name: string | null; email: string };
const control =
  "min-h-11 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base text-[hsl(var(--e-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--e-accent-portal))]";

export function OpsPermissionsSection() {
  const [policy, setPolicy] = useState<OpsPolicy | null>(null);
  const [saved, setSaved] = useState("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selected, setSelected] = useState("");
  const [packId, setPackId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPolicy(null);
    fetch("/api/admin/ops-permissions", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Could not load permissions.");
        const next = opsPolicySchema.parse(data.policy);
        if (controller.signal.aborted) return;
        setPolicy(next);
        setSaved(JSON.stringify(next));
        setManagers(data.managers);
        setSelected(data.managers[0]?.id ?? "");
        setPackId("");
        setConflict(false);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause.message || "Could not load permissions.");
      });
    return () => controller.abort();
  }, [reload]);

  async function save() {
    if (!policy || pending || conflict) return;
    const parsed = opsPolicySchema.safeParse(policy);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the permission pack.");
      return;
    }
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/ops-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(data.error || "Could not save permissions.");
      }
      const next = opsPolicySchema.parse(data.policy);
      setPolicy(next);
      setSaved(JSON.stringify(next));
      setNotice(
        "Permissions saved. New requests use these permissions immediately.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save permissions.",
      );
    } finally {
      setPending(false);
    }
  }

  const packs = [...OPS_BUILTIN_PRESETS, ...(policy?.presets ?? [])];
  const assignment = policy?.assignments[selected] ?? {
    presetId: "existing",
    overrides: {},
  };
  const pack = policy?.presets.find((item) => item.id === packId);
  const effective = policy
    ? resolveOpsLevels(policy, selected)
    : allOpsLevels("off");
  function setLevel(feature: OpsFeature, value: string) {
    if (!policy) return;
    if (pack) {
      setPolicy({
        ...policy,
        presets: policy.presets.map((item) =>
          item.id === packId
            ? {
                ...item,
                levels: { ...item.levels, [feature]: value as OpsLevel },
              }
            : item,
        ),
      });
    } else {
      const overrides = { ...assignment.overrides };
      if (value === "inherit") delete overrides[feature];
      else overrides[feature] = value as OpsLevel;
      setPolicy({
        ...policy,
        assignments: {
          ...policy.assignments,
          [selected]: { ...assignment, overrides },
        },
      });
    }
    setNotice("");
  }
  const visible = OPS_FEATURES.filter((feature) =>
    `${feature.label} ${feature.group} ${feature.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const dirty = policy !== null && saved !== JSON.stringify(policy);
  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Operations manager permissions</ECardTitle>
        <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
          Choose a permission pack for each manager, then override individual
          features. Off blocks access; View only blocks changes; Manage allows
          actions already available to their role. Admin-only security,
          credentials and approvals remain protected.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-5">
        {error && (
          <p role="alert" className="text-sm text-[hsl(var(--e-danger))]">
            {error}
          </p>
        )}
        {!policy && !error && <p role="status">Loading permissions…</p>}
        {((!policy && error) || conflict) && (
          <EButton
            variant="outline"
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Discard these unsaved permission changes and reload?",
                )
              )
                setReload((value) => value + 1);
            }}
          >
            Reload permissions
          </EButton>
        )}
        {policy && (
          <fieldset
            disabled={pending || conflict}
            className="min-w-0 space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="min-w-0 space-y-2 text-sm font-medium">
                <span>Operations manager</span>
                <select
                  className={control}
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPackId("");
                  }}
                >
                  {managers.length === 0 && (
                    <option value="">No active operations managers</option>
                  )}
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name || manager.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 space-y-2 text-sm font-medium">
                <span id="ops-assigned-pack-label">
                  Assigned permission pack
                </span>
                <select
                  className={control}
                  aria-labelledby="ops-assigned-pack-label"
                  aria-describedby="ops-assigned-pack-help"
                  disabled={!selected}
                  value={assignment.presetId}
                  onChange={(event) => {
                    setPackId("");
                    setPolicy({
                      ...policy,
                      assignments: {
                        ...policy.assignments,
                        [selected]: {
                          presetId: event.target.value,
                          overrides: {},
                        },
                      },
                    });
                    setNotice("");
                  }}
                >
                  {packs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <p
                  id="ops-assigned-pack-help"
                  className="text-xs font-normal text-[hsl(var(--e-muted-foreground))]"
                >
                  Selecting a pack replaces this manager’s feature overrides.
                  Changes take effect when saved.
                </p>
              </label>
            </div>
            <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
              <summary className="cursor-pointer py-2 font-medium">
                Reusable permission packs
              </summary>
              <div className="mt-3 space-y-4">
                <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
                  Create a pack from the selected manager’s current levels.
                  Editing a pack updates every assigned manager, except their
                  individual overrides.
                </p>
                <EButton
                  variant="outline"
                  disabled={policy.presets.length >= 100}
                  onClick={() => {
                    const id = `custom-${crypto.randomUUID()}`;
                    setPolicy({
                      ...policy,
                      presets: [
                        ...policy.presets,
                        {
                          id,
                          name: "New permission pack",
                          description: "",
                          levels: effective,
                          sensitive: resolveSensitiveGrants(policy, selected),
                        },
                      ],
                    });
                    setPackId(id);
                  }}
                >
                  Create permission pack
                </EButton>
                <label className="block space-y-2 text-sm font-medium">
                  <span>Edit custom pack</span>
                  <select
                    className={control}
                    value={packId}
                    onChange={(event) => setPackId(event.target.value)}
                  >
                    <option value="">Edit selected manager’s overrides</option>
                    {policy.presets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {pack && (
                  <>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>Pack name</span>
                      <input
                        className={control}
                        maxLength={80}
                        value={pack.name}
                        onChange={(event) =>
                          setPolicy({
                            ...policy,
                            presets: policy.presets.map((item) =>
                              item.id === packId
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>Pack description</span>
                      <input
                        className={control}
                        maxLength={300}
                        value={pack.description}
                        onChange={(event) =>
                          setPolicy({
                            ...policy,
                            presets: policy.presets.map((item) =>
                              item.id === packId
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            </details>
            {(selected || pack) && (
              <section className="space-y-4" aria-label="Feature permissions">
                <h3 className="font-semibold">
                  {pack
                    ? `Editing pack: ${pack.name}`
                    : `Feature overrides: ${managers.find((manager) => manager.id === selected)?.name || managers.find((manager) => manager.id === selected)?.email}`}
                </h3>
                <label className="block space-y-2 text-sm font-medium">
                  <span>Find a feature</span>
                  <input
                    type="search"
                    className={control}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    data-history-disabled
                  />
                </label>
                {visible.length === 0 && <p>No matching features.</p>}
                {Array.from(
                  new Set(visible.map((feature) => feature.group)),
                ).map((group) => (
                  <div key={group} className="space-y-2">
                    <h4 className="text-sm font-semibold text-[hsl(var(--e-muted-foreground))]">
                      {group}
                    </h4>
                    {visible
                      .filter((feature) => feature.group === group)
                      .map((feature) => (
                        <div
                          key={feature.key}
                          className="grid min-w-0 gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]"
                        >
                          <div>
                            <label
                              htmlFor={`ops-feature-${feature.key}`}
                              className="text-sm font-medium"
                            >
                              {feature.label}
                            </label>
                            <p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">
                              {feature.description}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <select
                              id={`ops-feature-${feature.key}`}
                              className={control}
                              value={
                                pack
                                  ? (pack.levels[feature.key] ?? "off")
                                  : (assignment.overrides[feature.key] ??
                                    "inherit")
                              }
                              onChange={(event) =>
                                setLevel(feature.key, event.target.value)
                              }
                            >
                              {!pack && (
                                <option value="inherit">Use pack</option>
                              )}
                              {Object.entries(OPS_LEVEL_LABELS).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                            {!pack && (
                              <p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">
                                Effective:{" "}
                                {OPS_LEVEL_LABELS[effective[feature.key]]}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                ))}
              </section>
            )}
            <section className="space-y-3 rounded-lg border border-[hsl(var(--e-border))] p-4">
              <h3 className="font-semibold">Sensitive actions</h3>
              <p className="text-sm">
                Explicit grants, off by default. The manager also needs Manage
                access to the feature and must confirm with their own PIN or
                password. They set their PIN in Profile → Security.
              </p>
              {Object.entries(SENSITIVE_ACTIONS).map(([key, label]) => {
                const action = key as SensitiveAction;
                const grants = pack
                  ? pack.sensitive
                  : resolveSensitiveGrants(policy, selected);
                return (
                  <label key={key} className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      disabled={!selected && !pack}
                      checked={grants?.[action] === true}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setPolicy(
                          pack
                            ? {
                                ...policy,
                                presets: policy.presets.map((item) =>
                                  item.id === pack.id
                                    ? {
                                        ...item,
                                        sensitive: {
                                          ...item.sensitive,
                                          [action]: enabled,
                                        },
                                      }
                                    : item,
                                ),
                              }
                            : {
                                ...policy,
                                assignments: {
                                  ...policy.assignments,
                                  [selected]: {
                                    ...assignment,
                                    sensitive: {
                                      ...assignment.sensitive,
                                      [action]: enabled,
                                    },
                                  },
                                },
                              },
                        );
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </section>
            <div className="flex flex-wrap items-center gap-3">
              <EButton disabled={!dirty} onClick={() => void save()}>
                {pending ? "Saving…" : "Save permissions"}
              </EButton>
              <span className="text-sm text-[hsl(var(--e-muted-foreground))]">
                {dirty ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
          </fieldset>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </ECardBody>
    </ECard>
  );
}
