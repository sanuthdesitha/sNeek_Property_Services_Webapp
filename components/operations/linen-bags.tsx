"use client";
import {
  OperationsPage,
  OperationsButton,
  OperationsNotice,
  OperationsLoading,
} from "@/components/operations/ui";
import { useEffect, useRef, useState } from "react";
import {
  operationalDay,
  operationalLabel,
  operationalTimestamp,
} from "./presentation";
import type { BagRecord, listBagCustody } from "@/lib/laundry/bag-custody";
type CustodyTask = Omit<
  Awaited<ReturnType<typeof listBagCustody>>["tasks"][number],
  "pickupDate" | "returnDate"
> & { pickupDate: string; returnDate: string };
export function LinenBags({
  initialTaskId = "",
  role,
  timeZone = "Australia/Sydney",
  panel = false,
}: {
  panel?: boolean;
  initialTaskId?: string;
  role: string;
  timeZone?: string;
}) {
  const [historyTimeZone, setHistoryTimeZone] = useState(timeZone);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true),
    [notice, setNotice] = useState("");
  const [taskId, setTask] = useState(initialTaskId),
    [tasks, setTasks] = useState<CustodyTask[]>([]),
    [events, setEvents] = useState<BagRecord[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [bagId, setBag] = useState(""),
    [status, setStatus] = useState("REGISTERED"),
    [at, setAt] = useState(""),
    [location, setLocation] = useState(""),
    [contents, setContents] = useState(""),
    [count, setCount] = useState(""),
    [note, setNote] = useState("");
  const requests = useRef(new Map<string, string>());
  async function load(signal?: AbortSignal) {
    const response = await fetch(
      `/api/laundry/bag-custody${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (signal?.aborted) return;
    if (!response.ok) throw Error(body.error);
    setTasks(body.tasks);
    setEvents(body.events);
    setHistoryTimeZone(body.timeZone ?? timeZone);
    setReady(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReady(false);
    setError("");
    setNotice("");
    setEvents([]);
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const latest = events
        .filter((row) => row.bagId === bagId.trim().toUpperCase())
        .sort((a, b) => b.version - a.version)[0];
      const input = {
        taskId,
        bagId,
        status,
        observedAt: new Date(at).toISOString(),
        location,
        contents: contents.trim() || null,
        itemCount: count === "" ? null : Number(count),
        note,
        expectedVersion: latest?.version ?? 0,
      };
      const fingerprint = JSON.stringify(input),
        requestId = requests.current.get(fingerprint) ?? crypto.randomUUID();
      requests.current.set(fingerprint, requestId);
      const response = await fetch("/api/laundry/bag-custody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, requestId }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      await load();
      setNotice("Bag observation recorded.");
      requests.current.delete(fingerprint);
      setNote("");
      setContents("");
      setCount("");
      setAt("");
      setLocation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record custody.");
    } finally {
      setBusy(false);
    }
  }
  const field = "ops-field";
  return (
    <OperationsPage
      panel={panel}
      pending={busy}
      title="Individual bag tracking"
      accent={
        role === "CLEANER"
          ? "cleaner"
          : role === "LAUNDRY"
            ? "laundry"
            : "admin"
      }
      backHref={
        role === "CLEANER"
          ? "/v2/cleaner"
          : role === "LAUNDRY"
            ? "/v2/laundry"
            : "/v2/admin/laundry"
      }
      backLabel="Back to laundry workspace"
    >
      <p>
        Use this optional log when bags have individual physical labels and you
        need to trace a missing bag. Record the label, where you saw it, and when.
        For normal pickups and deliveries, use the laundry run actions. This log
        does not update the run status or confirm that someone accepted a bag.
        Contents and item counts remain unknown unless recorded.
      </p>
      {error ? (
        <OperationsNotice tone="danger">{error}</OperationsNotice>
      ) : null}
      {loading ? <OperationsLoading /> : null}
      {notice ? (
        <OperationsNotice tone="success">{notice}</OperationsNotice>
      ) : null}
      {busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
      <label className="print:hidden">
        Laundry run
        <select
          className={field}
          value={taskId}
          onChange={(e) => {
            setTask(e.target.value);
            setBag("");
            setNote("");
            setContents("");
            setCount("");
            setAt("");
            setLocation("");
            setStatus("REGISTERED");
          }}
        >
          <option value="">Choose run</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.property} · {task.job} · planned pickup{" "}
              {operationalDay(task.pickupDate)} / return{" "}
              {operationalDay(task.returnDate)}
            </option>
          ))}
        </select>
      </label>
      {tasks
        .filter((task) => task.id === taskId)
        .map((task) => (
          <p className="hidden print:block break-words" key={task.id}>
            Property: {task.property}. Job: {task.job}. Laundry run: {task.id}.
            Planned pickup: {operationalDay(task.pickupDate)}. Planned return:{" "}
            {operationalDay(task.returnDate)}.
          </p>
        ))}
      {taskId && ready ? (
        <form
          className="ops-card ops-form-grid print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Physical bag ID
            <input
              className={field}
              required
              maxLength={80}
              value={bagId}
              onChange={(e) => setBag(e.target.value)}
            />
          </label>
          <label>
            Observation
            <select
              className={field}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="REGISTERED">Link bag to this run</option>
              {role !== "CLEANER" ? (
                <option value="PICKED_UP">Pickup observed</option>
              ) : null}
              <option value="RETURNED">Return observed</option>
              <option value="UNKNOWN">Custody uncertain</option>
            </select>
          </label>
          <label>
            Observed at (your local time)
            <input
              className={field}
              required
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <label>
            Holder or location (write Unknown if uncertain)
            <input
              className={field}
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Contents (blank = unknown)
            <input
              className={field}
              value={contents}
              onChange={(e) => setContents(e.target.value)}
            />
          </label>
          <label>
            Number of items inside (blank = unknown)
            <input
              className={field}
              type="number"
              min="0"
              max="10000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </label>
          <label>
            Observation note / evidence reference
            <textarea
              className={field}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <OperationsButton disabled={busy}>
            Record bag observation
          </OperationsButton>
        </form>
      ) : null}
      <section className="ops-card space-y-3">
        <h2 className="font-semibold">Bag observation history</h2>
        <p className="text-sm">
          History times shown in {historyTimeZone}. Observation entry uses your
          device’s local time.
        </p>
        {events.length ? (
          events.map((row, index) => (
            <article
              key={`${row.bagId}-${row.version}-${index}`}
              className="border-t py-3"
            >
              <strong>
                {row.bagId} ·{" "}
                {row.status === "UNKNOWN"
                  ? "Custody uncertain"
                  : operationalLabel(row.status)}
              </strong>
              <p>
                Observed {operationalTimestamp(row.observedAt, historyTimeZone)}
                ; recorded{" "}
                {operationalTimestamp(row.recordedAt, historyTimeZone)};{" "}
                {operationalLabel(row.source)}.
              </p>
              <p>
                Location/holder: {row.location}. Contents:{" "}
                {row.contents || "Unknown"}. Item count:{" "}
                {row.itemCount ?? "Unknown"}.
              </p>
              <p>{row.note}</p>
            </article>
          ))
        ) : !loading && !error ? (
          <p>
            No individual bag observations recorded. Legacy laundry records
            remain available in the laundry workspace.
          </p>
        ) : null}
      </section>
      <OperationsButton
        variant="outline"
        className="print:hidden"
        type="button"
        onClick={() => window.print()}
      >
        Print / save bag history as PDF
      </OperationsButton>
    </OperationsPage>
  );
}
