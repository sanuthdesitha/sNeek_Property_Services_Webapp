"use client";
import {
  OperationsPage,
  OperationsButton,
  OperationsNotice,
  OperationsLoading,
} from "@/components/operations/ui";
import {
  operationalDay,
  operationalLabel,
  operationalTimestamp,
} from "@/components/operations/presentation";
import { useCallback, useEffect, useState } from "react";
const field = "ops-field";
type CareProps = { propertyId: string; timeZone?: string; panel?: boolean };
export function PropertyCareWorkspace(props: CareProps) {
  return <PropertyCareEditor key={props.propertyId} {...props} />;
}
function PropertyCareEditor({
  propertyId,
  timeZone = "Australia/Sydney",
  panel = false,
}: CareProps) {
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  const [asset, setAsset] = useState<any>(null),
    [selected, setSelected] = useState("curtains");
  const [memory, setMemory] = useState(""),
    [kind, setKind] = useState("MEMORY");
  const [special, setSpecial] = useState({
    title: "",
    description: "",
    priority: "NORMAL",
    due: "",
    minutes: 5,
  });
  const [requestId, setRequestId] = useState("");
  const [budget, setBudget] = useState({
    jobId: "",
    minutes: 0,
    normalMinutes: 60,
    ready: false,
  });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(
        `/api/property-care?propertyId=${encodeURIComponent(propertyId)}`,
        { cache: "no-store", signal },
      );
      const body = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw Error(body.error);
      setData(body);
    },
    [propertyId],
  );
  useEffect(() => {
    if (!propertyId) return;
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    setRequestId(crypto.randomUUID());
    return () => controller.abort();
  }, [load, propertyId]);
  async function post(input: any) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch("/api/property-care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, ...input }),
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error);
      await load();
      setNotice("Property care update saved.");
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!propertyId)
    return (
      <OperationsPage
        panel={panel}
        pending={busy}
        title="Property memory and care"
        backHref="/v2"
      >
        <OperationsNotice>
          Open a property and select its memory and care workspace.
        </OperationsNotice>
      </OperationsPage>
    );
  if (!data)
    return (
      <OperationsPage
        panel={panel}
        pending={busy}
        title="Property memory and care"
        backHref="/v2"
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
  function downloadCoverage() {
    const rows = [
      [
        "Property",
        "Template",
        "Catalog item",
        "Recommended inspection",
        "Recommended cleaning",
        "Coverage review",
        "Matched fields",
      ],
      ...data.coverage.map((row: any) => [
        data.property.name,
        data.template.name || "No resolved template",
        row.title,
        row.inspection,
        row.cleaning,
        row.status,
        row.matches.map((m: any) => `${m.id}: ${m.label}`).join("; "),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        [
          rows
            .map((row: any[]) =>
              row
                .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "property-care-coverage.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  function chooseAsset(id: string) {
    const item = data.catalog.find((item: any) => item.id === id);
    setSelected(id);
    setAsset({
      id: crypto.randomUUID(),
      catalogId: id,
      location: "",
      applicability: "UNKNOWN",
      enabled: false,
      safeAccess: false,
      productsReady: false,
      inspectionDays: item.inspection.days ?? null,
      cleaningDays: item.cleaning.days ?? null,
      inspectionMinutes: item.inspection_minutes_estimate || 1,
      cleaningMinutes: Number(
        String(item.cleaning_minutes_estimate).match(/\d+/)?.[0] || 5,
      ),
      firstCleaningDue: null,
      cleaningNeeded: false,
      manualUrl: "",
      product: "",
      reason: "",
    });
  }
  const config = (extra: any) => ({
    action: "configure",
    version: data.config.version,
    reason,
    ...extra,
  });
  return (
    <OperationsPage
      panel={panel}
      pending={busy}
      title={<>{data.property.name} — memory and care</>}
      accent={data.admin ? "admin" : "client"}
      backHref={`/v2/${data.admin ? "admin" : "client"}/properties/${propertyId}`}
      backLabel="Back to property"
    >
      <p className="text-sm">History times shown in {timeZone}.</p>
      <p>
        Planned work is separate from completed work. Inspection does not mean
        cleaning. Missing photo evidence stays visible for review.
      </p>
      {error ? (
        <OperationsNotice tone="danger">{error}</OperationsNotice>
      ) : null}
      {notice ? (
        <OperationsNotice tone="success">{notice}</OperationsNotice>
      ) : null}
      {busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
      {data.admin ? (
        <>
          <label>
            Reason for this change
            <input
              className={field}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <section className="ops-card space-y-4">
            <h2>Property memory and code ideas</h2>
            <p>
              Office notes are private. Code ideas are tracked separately and
              never assigned as cleaner work.
            </p>
            <label>
              Note type
              <select
                aria-label="Note type"
                className={field}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="MEMORY">Property memory</option>
                <option value="CODE_IDEA">Code change idea</option>
              </select>
            </label>
            <label>
              Property memory note
              <textarea
                aria-label="Property memory note"
                className={field}
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
              />
            </label>
            <OperationsButton
              disabled={busy || !reason || !memory}
              onClick={async () => {
                if (await post(config({ memory: { kind, text: memory } })))
                  setMemory("");
              }}
            >
              Record note
            </OperationsButton>
            {data.config.memory.map((note: any) => (
              <p key={note.id}>
                {note.kind === "CODE_IDEA" ? "Code idea" : "Memory"}:{" "}
                {note.text} · {operationalTimestamp(note.recordedAt, timeZone)}
              </p>
            ))}
          </section>
          <section className="ops-card space-y-4">
            <h2>Special task — To do</h2>
            <p>
              Capture the actual instruction, property, priority and due date
              when known. All special tasks request photos.
            </p>
            <label>
              Task title
              <input
                className={field}
                value={special.title}
                onChange={(e) =>
                  setSpecial({ ...special, title: e.target.value })
                }
              />
            </label>
            <label>
              Instructions
              <textarea
                className={field}
                value={special.description}
                onChange={(e) =>
                  setSpecial({ ...special, description: e.target.value })
                }
              />
            </label>
            <label>
              Priority
              <select
                className={field}
                value={special.priority}
                onChange={(e) =>
                  setSpecial({ ...special, priority: e.target.value })
                }
              >
                {["NORMAL", "HIGH", "URGENT"].map((p) => (
                  <option key={p} value={p}>
                    {operationalLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date if known
              <input
                type="date"
                className={field}
                value={special.due}
                onChange={(e) =>
                  setSpecial({ ...special, due: e.target.value })
                }
              />
            </label>
            <label>
              Required paid minutes
              <input
                type="number"
                min={1}
                className={field}
                value={special.minutes}
                onChange={(e) =>
                  setSpecial({ ...special, minutes: Number(e.target.value) })
                }
              />
            </label>
            <OperationsButton
              disabled={busy || !special.title}
              onClick={async () => {
                if (
                  await post({
                    action: "special",
                    ...special,
                    due: special.due || null,
                    requestId,
                  })
                ) {
                  setRequestId(crypto.randomUUID());
                  setSpecial({
                    title: "",
                    description: "",
                    priority: "NORMAL",
                    due: "",
                    minutes: 5,
                  });
                }
              }}
            >
              Save special task
            </OperationsButton>
          </section>
          <section className="ops-card space-y-4">
            <h2>Recurring care assets</h2>
            <p>
              All intervals are adjustable recommendations. Nothing is enabled
              by default. Unknown history starts with an inspection. New
              every-clean additions require a separate owner-approved checklist
              proposal; this screen never adds them as daily extras.
            </p>
            <label>
              Catalog item
              <select
                className={field}
                value={selected}
                onChange={(e) => chooseAsset(e.target.value)}
              >
                {data.catalog.map((item: any) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <OperationsButton
              variant="outline"
              onClick={() => chooseAsset(selected)}
            >
              Configure new asset or area
            </OperationsButton>
            {data.assets.map((row: any) => (
              <article className="rounded border p-3" key={row.id}>
                <p>
                  {data.catalog.find((item: any) => item.id === row.catalogId)
                    ?.title ?? operationalLabel(row.catalogId)}{" "}
                  — {row.location} · {operationalLabel(row.applicability)} ·{" "}
                  {row.enabled ? "Enabled" : "Disabled"}
                </p>
                <p>
                  Last inspected:{" "}
                  {operationalTimestamp(row.clock.inspectedAt, timeZone)}; last
                  cleaned: {operationalTimestamp(row.clock.cleanedAt, timeZone)}
                </p>
                <p>
                  Inspection due:{" "}
                  {operationalDay(row.due.INSPECT, "Not scheduled")}; cleaning
                  due:{" "}
                  {operationalDay(
                    row.due.CLEAN,
                    "Needs initial inspection / owner decision",
                  )}
                </p>
                <OperationsButton
                  variant="outline"
                  onClick={() => {
                    const { clock, due, conditionSince, ...value } = row;
                    setAsset(value);
                  }}
                >
                  Edit this asset
                </OperationsButton>
              </article>
            ))}
            {asset ? (
              <form
                className="ops-form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await post(config({ asset: { ...asset, reason } })))
                    setAsset(null);
                }}
              >
                <h3>
                  {
                    data.catalog.find(
                      (item: any) => item.id === asset.catalogId,
                    )?.title
                  }
                </h3>
                <p>
                  {
                    data.catalog.find(
                      (item: any) => item.id === asset.catalogId,
                    )?.procedure
                  }
                </p>
                <label>
                  Named asset/location
                  <input
                    className={field}
                    required
                    value={asset.location}
                    onChange={(e) =>
                      setAsset({ ...asset, location: e.target.value })
                    }
                  />
                </label>
                <label>
                  Applicability
                  <select
                    className={field}
                    value={asset.applicability}
                    onChange={(e) =>
                      setAsset({ ...asset, applicability: e.target.value })
                    }
                  >
                    {["UNKNOWN", "APPLICABLE", "NOT_APPLICABLE"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {operationalLabel(value)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {(
                  [
                    ["inspectionDays", "Inspection interval days"],
                    ["cleaningDays", "Cleaning interval days"],
                    ["inspectionMinutes", "Inspection paid minutes"],
                    ["cleaningMinutes", "Cleaning paid minutes"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="block" key={key}>
                    {label}
                    <input
                      className={field}
                      type="number"
                      min={1}
                      value={asset[key] ?? ""}
                      onChange={(e) =>
                        setAsset({
                          ...asset,
                          [key]: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Owner-approved first cleaning due (does not invent past
                  cleaning)
                  <input
                    className={field}
                    type="date"
                    value={asset.firstCleaningDue ?? ""}
                    onChange={(e) =>
                      setAsset({
                        ...asset,
                        firstCleaningDue: e.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  Actual manual URL
                  <input
                    className={field}
                    value={asset.manualUrl}
                    onChange={(e) =>
                      setAsset({ ...asset, manualUrl: e.target.value })
                    }
                  />
                </label>
                <label>
                  Approved product / care instructions
                  <input
                    className={field}
                    value={asset.product}
                    onChange={(e) =>
                      setAsset({ ...asset, product: e.target.value })
                    }
                  />
                </label>
                {(
                  [
                    ["enabled", "Enable this periodic care"],
                    [
                      "safeAccess",
                      "Safe reachable access confirmed; no specialist work",
                    ],
                    [
                      "productsReady",
                      "Approved products and applicable instructions available",
                    ],
                    [
                      "cleaningNeeded",
                      "Observed condition needs cleaning (office reviewed)",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label className="block" key={key}>
                    <input
                      type="checkbox"
                      checked={asset[key]}
                      onChange={(e) =>
                        setAsset({ ...asset, [key]: e.target.checked })
                      }
                    />{" "}
                    {label}
                  </label>
                ))}
                <OperationsButton disabled={busy || !reason}>
                  Save asset care
                </OperationsButton>
              </form>
            ) : null}
          </section>
          <section className="ops-card space-y-4">
            <h2>Approved booked time and readiness</h2>
            <p>
              A turnover, general clean or commercial recurring job must have a
              future start/end window, enough booked paid minutes for normal
              work plus care, safe access and products ready. No budget means no
              automatic attachment. Quarterly deep-clean dates are not created
              here.
            </p>
            <label>
              Future job
              <select
                className={field}
                value={budget.jobId}
                onChange={(e) => {
                  const existing = data.config.budgets.find(
                    (b: any) => b.jobId === e.target.value,
                  );
                  setBudget(
                    existing
                      ? {
                          jobId: existing.jobId,
                          minutes: existing.minutes,
                          normalMinutes: existing.normalMinutes,
                          ready: existing.ready,
                        }
                      : { ...budget, jobId: e.target.value },
                  );
                }}
              >
                <option value="">Choose job</option>
                {data.jobs.map((job: any) => (
                  <option value={job.id} key={job.id}>
                    {job.jobNumber} · {operationalDay(job.scheduledDate)} ·{" "}
                    {job.estimatedHours ?? "unknown"} booked hours
                  </option>
                ))}
              </select>
            </label>
            <label>
              Normal work minutes
              <input
                className={field}
                type="number"
                min={1}
                value={budget.normalMinutes}
                onChange={(e) =>
                  setBudget({
                    ...budget,
                    normalMinutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Paid care budget minutes
              <input
                className={field}
                type="number"
                min={0}
                value={budget.minutes}
                onChange={(e) =>
                  setBudget({ ...budget, minutes: Number(e.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={budget.ready}
                onChange={(e) =>
                  setBudget({ ...budget, ready: e.target.checked })
                }
              />{" "}
              Access, supplies and paid booking approved for these tasks
            </label>
            <OperationsButton
              disabled={busy || !reason || !budget.jobId}
              onClick={() =>
                void post(config({ budget: { ...budget, reason } }))
              }
            >
              Save booked care time
            </OperationsButton>
            <OperationsButton
              variant="outline"
              className="mt-3 sm:ml-3 sm:mt-0"
              disabled={busy}
              onClick={() => void post({ action: "plan" })}
            >
              Attach due care to suitable jobs
            </OperationsButton>
          </section>
          <details className="ops-card">
            <summary>49-item coverage comparison</summary>
            <OperationsButton variant="outline" onClick={downloadCoverage}>
              Download coverage CSV
            </OperationsButton>
            <p>
              Resolved template: {data.template.name || "None"} (
              {operationalLabel(data.template.source)}). Matches are candidates
              for office review, not proof of equivalent scope. Property
              overrides, including P11, remain unchanged.
            </p>
            <div
              className="ops-table-scroll"
              role="region"
              aria-label="Care coverage comparison"
              tabIndex={0}
            >
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Recommended inspection / cleaning</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverage.map((row: any) => (
                    <tr key={row.id}>
                      <td>{row.title}</td>
                      <td>
                        {row.inspection} / {row.cleaning}
                      </td>
                      <td>
                        {operationalLabel(row.status)}
                        <br />
                        {row.matches.map((m: any) => m.label).join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
      {(
        [
          "To do / planned",
          "Completed with photos",
          "Work reported complete — evidence missing",
          "Earlier attempts",
        ] as const
      ).map((title, index) => (
        <section className="ops-card space-y-4" key={title}>
          <h2 className="font-semibold">{title}</h2>
          {!data.tasks.some((task: any) =>
            index === 0
              ? task.executionStatus === "OPEN"
              : index === 1
                ? task.executionStatus === "COMPLETED" &&
                  task.evidence === "PHOTO_RECORDED"
                : index === 2
                  ? task.executionStatus === "COMPLETED" &&
                    task.evidence === "EVIDENCE_MISSING"
                  : ["NOT_COMPLETED", "CANCELLED"].includes(
                      task.executionStatus,
                    ),
          ) ? (
            <p>No tasks in this group.</p>
          ) : null}
          {data.tasks
            .filter((task: any) =>
              index === 0
                ? task.executionStatus === "OPEN"
                : index === 1
                  ? task.executionStatus === "COMPLETED" &&
                    task.evidence === "PHOTO_RECORDED"
                  : index === 2
                    ? task.executionStatus === "COMPLETED" &&
                      task.evidence === "EVIDENCE_MISSING"
                    : ["NOT_COMPLETED", "CANCELLED"].includes(
                        task.executionStatus,
                      ),
            )
            .map((task: any) => (
              <article key={task.id}>
                <p>
                  {task.title}
                  {task.metadata?.priority
                    ? ` · ${operationalLabel(task.metadata.priority)}`
                    : ""}
                </p>
                {task.jobId ? (
                  <a
                    className="underline"
                    href={`/v2/${data.admin ? "admin" : "client"}/jobs/${task.jobId}`}
                  >
                    View job and evidence
                  </a>
                ) : null}
                <p>
                  Due: {operationalDay(task.due, "Not specified")}; planned:{" "}
                  {operationalDay(
                    task.plannedDate,
                    "Needs scheduling, time or access",
                  )}
                  ; completed:{" "}
                  {operationalTimestamp(
                    task.completedAt,
                    timeZone,
                    "Not recorded",
                  )}
                </p>
                {data.admin ? (
                  <details>
                    <summary>Audit history</summary>
                    {task.events.map((event: any) => (
                      <p key={event.id}>
                        {operationalLabel(event.action)}: {event.note}
                      </p>
                    ))}
                  </details>
                ) : null}
              </article>
            ))}
        </section>
      ))}
    </OperationsPage>
  );
}
