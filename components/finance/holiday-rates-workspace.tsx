"use client";
import {
  OperationsPage,
  OperationsButton,
  OperationsNotice,
  OperationsLoading,
} from "@/components/operations/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { operationalTimestamp } from "@/components/operations/presentation";
import type { HolidayPolicy } from "@/lib/finance/holiday-policy";
const field = "ops-field";
const cash = (value: number | null) =>
  value == null ? "not set" : `$${value.toFixed(2)}`;
export function HolidayRatesWorkspace({
  initialJobId = "",
  embedded = false,
  panel = false,
}: {
  initialJobId?: string;
  embedded?: boolean;
  panel?: boolean;
}) {
  const readController = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<any>(null),
    [policy, setPolicy] = useState<HolidayPolicy | null>(null);
  const [jobId, setJobId] = useState(initialJobId),
    [loadedJobId, setLoadedJobId] = useState(initialJobId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null),
    [payload, setPayload] = useState<any>(null);
  const [dayOverride, setDayOverride] = useState("AUTO"),
    [clientMultiplier, setClientMultiplier] = useState(""),
    [clientFinal, setClientFinal] = useState("");
  const [cleanerMultipliers, setCleanerMultipliers] = useState<
    Record<string, number>
  >({});
  const load = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setData(null);
    setPreview(null);
    setPayload(null);
    const res = await fetch(
      `/api/admin/holiday-rates?jobId=${encodeURIComponent(loadedJobId)}`,
      { cache: "no-store", signal: controller.signal },
    );
    const body = await res.json();
    if (controller.signal.aborted) return;
    if (!res.ok) throw Error(body.error);
    setData(body);
    setPolicy(body.policy);
    setPreview(null);
    setPayload(null);
  }, [loadedJobId]);
  useEffect(() => {
    setDayOverride("AUTO");
    setClientMultiplier("");
    setClientFinal("");
    setCleanerMultipliers({});
    setReason("");
    setError("");
    void load().catch((e) => {
      if (e.name !== "AbortError") setError(e.message);
    });
    return () => readController.current?.abort();
  }, [load]);
  async function post(input: any, refresh = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/holiday-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error);
      if (refresh) {
        await load();
        setNotice("Holiday rate update saved.");
      }
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!data || !policy)
    return (
      <OperationsPage
        pending={busy}
        embedded={embedded}
        panel={panel}
        title="Public holiday rates"
        backHref="/v2/admin/settings"
      >
        {error ? (
          <OperationsNotice tone="danger">{error}</OperationsNotice>
        ) : (
          <OperationsLoading />
        )}
        <OperationsButton
          variant="outline"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Retry loading
        </OperationsButton>
      </OperationsPage>
    );
  const updateMap = (
    name: "clients" | "cleaners" | "clientNames",
    key: string,
    value: string,
  ) => {
    const map = { ...policy[name] };
    if (value === "") delete map[key];
    else map[key] = Number(value);
    setPolicy({ ...policy, [name]: map });
  };
  const activeSnapshot = data.snapshot?.state === "APPLIED";
  return (
    <OperationsPage
      pending={busy}
      embedded={embedded}
      panel={panel}
      title="Public holiday rates"
      backHref="/v2/admin/settings"
      backLabel="Back to settings"
    >
      <p>
        Review and apply rates to an individual job. Client and cleaner
        multipliers are independent. GST, extras, discounts, custom payouts and
        existing quotes keep their existing rules. Saving policy alone does not
        reprice jobs or invoices.
      </p>
      {error ? (
        <OperationsNotice tone="danger">{error}</OperationsNotice>
      ) : null}
      {notice ? (
        <OperationsNotice tone="success">{notice}</OperationsNotice>
      ) : null}
      {busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
      <label className="block">
        Reason for changes or job review
        <textarea
          className={field}
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <details className="ops-card">
        <summary className="cursor-pointer font-semibold">
          Organization, client, property and cleaner policy
        </summary>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void post({ action: "policy", policy, reason });
          }}
        >
          <label>
            Organization holiday timezone
            <input
              className={field}
              required
              value={policy.timezone}
              onChange={(e) =>
                setPolicy({ ...policy, timezone: e.target.value })
              }
            />
          </label>
          <label>
            Holiday jurisdiction
            <input
              className={field}
              required
              value={policy.jurisdiction}
              onChange={(e) =>
                setPolicy({ ...policy, jurisdiction: e.target.value })
              }
            />
          </label>
          <label>
            Local area (exact declared area; Sydney excludes regional holidays)
            <input
              className={field}
              required
              value={policy.localArea}
              onChange={(e) =>
                setPolicy({ ...policy, localArea: e.target.value })
              }
            />
          </label>
          <label>
            Maximum calendar age in days
            <input
              className={field}
              type="number"
              min={1}
              max={90}
              value={policy.maxCalendarAgeDays}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  maxCalendarAgeDays: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Other clients multiplier
            <input
              className={field}
              type="number"
              min={1}
              max={5}
              step="0.01"
              value={policy.clientDefault}
              onChange={(e) =>
                setPolicy({ ...policy, clientDefault: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Cleaner default multiplier
            <input
              className={field}
              type="number"
              min={1}
              max={5}
              step="0.01"
              value={policy.cleanerDefault}
              onChange={(e) =>
                setPolicy({ ...policy, cleanerDefault: Number(e.target.value) })
              }
            />
          </label>
          <p>
            Precedence: explicit job choice, then property/client rule for
            client rates; explicit job choice, then cleaner/property rule for
            cleaner pay. Fixed quotes and custom payouts are preserved. A
            multiplier of 1 means no loading.
          </p>
          {Object.entries(policy.clientNames).map(([name, value]) => (
            <label className="block" key={name}>
              Exact client name “{name}” multiplier
              <input
                className={field}
                type="number"
                min={1}
                max={5}
                step="0.01"
                value={value}
                onChange={(e) => updateMap("clientNames", name, e.target.value)}
              />
            </label>
          ))}
          <p>
            Jackson starts at ×1.5 by exact client name. Select its client
            record below if the stored name differs. Blank overrides inherit.
          </p>
          <details>
            <summary>Client overrides</summary>
            {data.clients.map((client: any) => (
              <label className="block" key={client.id}>
                {client.name}
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={5}
                  step="0.01"
                  placeholder="Inherit"
                  value={policy.clients[client.id] ?? ""}
                  onChange={(e) =>
                    updateMap("clients", client.id, e.target.value)
                  }
                />
              </label>
            ))}
          </details>
          <details>
            <summary>Cleaner overrides</summary>
            {data.cleaners.map((cleaner: any) => (
              <label className="block" key={cleaner.id}>
                {cleaner.name || cleaner.id}
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={5}
                  step="0.01"
                  placeholder="Inherit"
                  value={policy.cleaners[cleaner.id] ?? ""}
                  onChange={(e) =>
                    updateMap("cleaners", cleaner.id, e.target.value)
                  }
                />
              </label>
            ))}
          </details>
          <details>
            <summary>Property overrides</summary>
            {data.properties.map((property: any) => (
              <fieldset className="my-2 rounded border p-2" key={property.id}>
                <legend>{property.name}</legend>
                {(["client", "cleaner"] as const).map((key) => (
                  <label key={key}>
                    {key === "client" ? "Client" : "Cleaner"} multiplier
                    <input
                      className={field}
                      type="number"
                      min={1}
                      max={5}
                      step="0.01"
                      placeholder="Inherit"
                      value={policy.properties[property.id]?.[key] ?? ""}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          properties: {
                            ...policy.properties,
                            [property.id]: {
                              ...policy.properties[property.id],
                              [key]:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Declared local area
                  <input
                    className={field}
                    placeholder="Inherit organization area"
                    value={policy.properties[property.id]?.area ?? ""}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        properties: {
                          ...policy.properties,
                          [property.id]: {
                            ...policy.properties[property.id],
                            area: e.target.value || undefined,
                          },
                        },
                      })
                    }
                  />
                </label>
              </fieldset>
            ))}
          </details>
          <OperationsButton disabled={busy || !reason.trim()}>
            Save policy
          </OperationsButton>
        </form>
      </details>
      <section className="ops-card space-y-4">
        <h2 className="font-semibold">Verified calendar</h2>
        {data.calendar ? (
          <>
            <a
              className="underline"
              href={data.calendar.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Official calendar source
            </a>
            <p>
              {data.calendar.jurisdiction} · covers{" "}
              {data.calendar.years.join(", ")} · verified{" "}
              {operationalTimestamp(data.calendar.verifiedAt, policy.timezone)}
            </p>
            <p className="break-all text-xs">Version {data.calendar.version}</p>
          </>
        ) : (
          <p>No verified calendar for this jurisdiction.</p>
        )}
        {data.calendar &&
        Date.now() - Date.parse(data.calendar.verifiedAt) >
          policy.maxCalendarAgeDays * 86400000 ? (
          <p role="status">
            Calendar is stale. Automatic holiday decisions are blocked until
            refreshed; a reasoned office override remains available.
          </p>
        ) : null}
        <p>
          Bank holidays and local event days are excluded. A local public
          holiday applies only to its exact configured area. Part-day loading
          needs actual work times or a reasoned job override.
        </p>
        <OperationsButton
          disabled={busy || policy.jurisdiction !== "AU-NSW"}
          onClick={() => void post({ action: "refresh" })}
        >
          Refresh NSW official calendar
        </OperationsButton>
        <label className="block">
          Import reviewed calendar file (JSON, with source, coverage and
          verification date)
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || !reason.trim()}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 1_000_000)
                  throw Error("Calendar file is too large");
                await post({
                  action: "calendar",
                  calendar: JSON.parse(await file.text()),
                  reason,
                });
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : "Invalid file",
                );
              }
            }}
          />
        </label>
      </section>
      <form
        className="ops-actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (jobId === loadedJobId)
            void load().catch((e) => setError(e.message));
          else setLoadedJobId(jobId);
        }}
      >
        <label className="grow">
          Job ID
          <input
            className={field}
            required
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          />
        </label>
        <OperationsButton disabled={busy}>Load job</OperationsButton>
      </form>
      {data.job ? (
        <section className="ops-card space-y-4">
          <h2 className="font-semibold">
            {data.job.jobNumber} · {data.job.propertyName}
          </h2>
          <p>
            {data.job.clientName} · scheduled{" "}
            {data.job.scheduledDate.slice(0, 10)}
          </p>
          {activeSnapshot ? (
            <>
              <SnapshotView snapshot={data.snapshot} />
              <OperationsButton
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void post({
                    action: "revert",
                    jobId: data.job.id,
                    snapshotId: data.snapshot.id,
                    reason,
                  })
                }
              >
                Revert unbilled holiday snapshot
              </OperationsButton>
              <p>
                Reverting preserves later manual rate edits. Claimed or paid
                work cannot be changed here.
              </p>
            </>
          ) : (
            <form
              className="space-y-3"
              onChange={() => setPreview(null)}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!data.calendar) {
                  setError("Import or refresh the calendar first");
                  return;
                }
                const input = {
                  jobId: data.job.id,
                  expectedUpdatedAt: data.job.updatedAt,
                  policyVersion: data.policy.version,
                  calendarVersion: data.calendar.version,
                  requestId: crypto.randomUUID(),
                  reason,
                  dayOverride,
                  cleanerMultipliers,
                  ...(clientMultiplier
                    ? { clientMultiplier: Number(clientMultiplier) }
                    : {}),
                  ...(clientFinal
                    ? { clientFinalPrice: Number(clientFinal) }
                    : {}),
                };
                const result = await post(
                  { action: "preview", ...input },
                  false,
                );
                if (result) {
                  setPayload({ ...input, reviewHash: result.reviewHash });
                  setPreview(result);
                }
              }}
            >
              <label>
                Holiday decision
                <select
                  className={field}
                  value={dayOverride}
                  onChange={(e) => setDayOverride(e.target.value)}
                >
                  <option value="AUTO">Use verified calendar</option>
                  <option value="HOLIDAY">
                    Explicit full holiday override
                  </option>
                  <option value="ORDINARY">
                    Explicit ordinary-day override
                  </option>
                </select>
              </label>
              <label>
                Client multiplier for this job (blank = policy)
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={5}
                  step="0.01"
                  value={clientMultiplier}
                  onChange={(e) => setClientMultiplier(e.target.value)}
                />
              </label>
              <label>
                Explicit final client price (blank preserves existing quote)
                <input
                  className={field}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={clientFinal}
                  onChange={(e) => setClientFinal(e.target.value)}
                />
              </label>
              {data.job.assignments.map((cleaner: any) => (
                <label className="block" key={cleaner.id}>
                  Job multiplier for {cleaner.name || cleaner.id}
                  <input
                    className={field}
                    type="number"
                    min={1}
                    max={5}
                    step="0.01"
                    placeholder="Inherit cleaner policy"
                    value={cleanerMultipliers[cleaner.id] ?? ""}
                    onChange={(e) => {
                      const copy = { ...cleanerMultipliers };
                      if (e.target.value === "") delete copy[cleaner.id];
                      else copy[cleaner.id] = Number(e.target.value);
                      setCleanerMultipliers(copy);
                    }}
                  />
                </label>
              ))}
              <OperationsButton disabled={busy || !reason.trim()}>
                Preview holiday rates
              </OperationsButton>
            </form>
          )}
          {preview ? (
            <>
              <SnapshotView snapshot={preview} />
              <OperationsButton
                disabled={busy}
                onClick={() => void post({ action: "apply", ...payload })}
              >
                Apply reviewed job rates
              </OperationsButton>
              <p>
                Updates job rates only. Does not create, send or pay an invoice.
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </OperationsPage>
  );
}
function SnapshotView({ snapshot }: { snapshot: any }) {
  return (
    <div className="ops-inset space-y-3">
      <p>
        {snapshot.holidays.join(", ") || "Ordinary day"} ·{" "}
        {snapshot.policy.timezone} · {Math.round(snapshot.clientFraction * 100)}
        % holiday fraction ·{" "}
        {snapshot.clientBasis === "ACTUAL_WORK"
          ? "based on recorded work times"
          : snapshot.clientBasis === "OVERRIDE"
            ? "explicit office decision"
            : "planned from scheduled date; no work attested"}
      </p>
      <p>
        Client normal base {cash(snapshot.client.base)} ·{" "}
        {snapshot.client.source === "EXPLICIT_FINAL_PRICE"
          ? "explicit final price"
          : `multiplier ×${snapshot.client.multiplier}`}{" "}
        · job price {cash(snapshot.client.after)} ·{" "}
        {snapshot.client.source.replaceAll("_", " ").toLowerCase()}
      </p>
      {snapshot.cleaners.map((cleaner: any) => (
        <p key={cleaner.id}>
          {cleaner.name || cleaner.id}:{" "}
          {cleaner.source === "CUSTOM_PAYOUT_PRESERVED" ? (
            "Custom payout preserved; hourly multiplication does not replace it."
          ) : (
            <>
              normal {cash(cleaner.base)}/hr · ×{cleaner.multiplier} over{" "}
              {Math.round(cleaner.fraction * 100)}% holiday fraction ·{" "}
              {cash(cleaner.after)}/hr
            </>
          )}
        </p>
      ))}
      <p className="text-sm">
        Reason: {snapshot.input.reason}. Policy version{" "}
        {snapshot.policy.version}; recorded{" "}
        {operationalTimestamp(snapshot.recordedAt, snapshot.policy.timezone)}.
      </p>
    </div>
  );
}
