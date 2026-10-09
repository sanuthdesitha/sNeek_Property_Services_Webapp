"use client";
import {
  OperationsPage,
  OperationsButton,
  OperationsNotice,
  OperationsLoading,
} from "@/components/operations/ui";
import { useEffect, useState } from "react";
import { operationalLabel, operationalTimestamp } from "./presentation";
import type { readTurnoverProfit } from "@/lib/finance/turnover-profit";
import { costCategories } from "@/lib/finance/turnover-profit-policy";
const money = (value: number | null) =>
  value === null ? "Unknown" : `$${value.toFixed(2)}`;
export function TurnoverProfit({
  initialJobId = "",
  panel = false,
}: {
  panel?: boolean;
  initialJobId?: string;
}) {
  const [timeZone, setTimeZone] = useState("Australia/Sydney");
  const [loading, setLoading] = useState(true),
    [notice, setNotice] = useState("");
  const [jobId, setJob] = useState(initialJobId),
    [jobs, setJobs] = useState<
      Awaited<ReturnType<typeof readTurnoverProfit>>["jobs"]
    >([]),
    [detail, setDetail] =
      useState<Awaited<ReturnType<typeof readTurnoverProfit>>["detail"]>(null),
    [error, setError] = useState(""),
    [costs, setCosts] = useState<
      Record<string, { amount: string; reference: string }>
    >({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    const response = await fetch(
      `/api/admin/turnover-profit${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (signal?.aborted) return;
    if (!response.ok) throw Error(body.error);
    setTimeZone(body.timeZone ?? "Australia/Sydney");
    setJobs(body.jobs);
    setDetail(body.detail);
    setCosts(
      Object.fromEntries(
        costCategories.map((key) => [
          key,
          {
            amount:
              body.detail?.costReview?.costs?.[key]?.amount?.toString() ?? "",
            reference: body.detail?.costReview?.costs?.[key]?.reference ?? "",
          },
        ]),
      ),
    );
    setConfirmed(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setNotice("");
    setDetail(null);
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/turnover-profit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          expectedVersion: detail?.costReview?.version ?? 0,
          confirmed,
          costs: Object.fromEntries(
            costCategories.map((key) => [
              key,
              costs[key].amount === ""
                ? null
                : {
                    amount: Number(costs[key].amount),
                    reference: costs[key].reference,
                  },
            ]),
          ),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      await load();
      setNotice("Cost review saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save review.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <OperationsPage
      panel={panel}
      pending={busy}
      title="Turnover profit review"
      backHref="/v2/admin/finance"
      backLabel="Back to finance"
    >
      <p>
        Administrator-only financial review. Missing costs remain unknown. This
        view does not change invoices, pricing, cleaner pay, or payment records.
      </p>
      {error ? (
        <OperationsNotice tone="danger">{error}</OperationsNotice>
      ) : null}
      {loading ? <OperationsLoading /> : null}
      {notice ? (
        <OperationsNotice tone="success">{notice}</OperationsNotice>
      ) : null}
      {busy ? <OperationsNotice>Saving changes…</OperationsNotice> : null}
      <label>
        Turnover
        <select
          className="block w-full border p-2"
          value={jobId}
          onChange={(e) => setJob(e.target.value)}
        >
          <option value="">Choose turnover</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.jobNumber} · {job.property.name} ·{" "}
              {String(job.scheduledDate).slice(0, 10)}
            </option>
          ))}
        </select>
      </label>
      {!loading && !detail && !error ? (
        <OperationsNotice>
          Choose a turnover to review its revenue and documented costs.
        </OperationsNotice>
      ) : null}
      {detail ? (
        <>
          <p>{detail.note}</p>
          <dl className="grid gap-3 sm:grid-cols-2 [&>div]:rounded-lg [&>div]:border [&>div]:border-[hsl(var(--e-border))] [&>div]:bg-[hsl(var(--e-surface))] [&>div]:p-4">
            <div>
              Approved/issued invoice revenue (ex GST):{" "}
              {money(detail.revenue.invoiced)}
            </div>
            <div>
              Cash specifically attributable to this turnover:{" "}
              {money(detail.revenue.cash)}
            </div>
            <div>
              Agreed job price estimate (not invoiced revenue):{" "}
              {money(detail.agreedPriceEstimate)}
            </div>
            <div>
              Documented cost subtotal: {money(detail.documentedCostSubtotal)}
            </div>
            <div>Total costs: {money(detail.totalCost)}</div>
            <div className="font-semibold">
              Profit on documented accrual basis: {money(detail.profit)}
            </div>
          </dl>
          <p>
            Missing cost categories: {detail.missingCosts.join(", ") || "None"}.
            Recorded laundry charge for review:{" "}
            {money(detail.laundryRecordedCharge)}; receipt attached:{" "}
            {detail.laundryReceiptPresent ? "Yes" : "No"}.
          </p>
          {detail.revenue.sources.map((row) => (
            <p key={row.id}>
              {row.number} · {row.status}: turnover charges{" "}
              {money(row.invoiced)}; total invoice receipts{" "}
              {money(row.invoicePaid)}; turnover cash allocation{" "}
              {money(row.cashAllocated)}. Payment date:{" "}
              {row.paidDate ?? "Unknown"}.
            </p>
          ))}
          <form
            className="ops-card space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2 className="font-semibold">
              Verify actual turnover costs against documents
            </h2>
            <p>
              Amounts in AUD excluding recoverable GST. Include all
              labour/transport/QA in Cleaner, all consumables in Supplies, and
              overhead or other attributable costs in Other. Leave an unverified
              category blank; an explicit zero also requires evidence.
            </p>
            {costCategories.map((key) => (
              <fieldset
                className="ops-form-grid rounded-lg border p-4"
                key={key}
              >
                <legend>{key}</legend>
                <label>
                  Amount
                  <input
                    aria-label={`${key} amount`}
                    className="block border p-2"
                    type="number"
                    min="0"
                    step="0.01"
                    value={costs[key]?.amount ?? ""}
                    onChange={(e) =>
                      setCosts({
                        ...costs,
                        [key]: { ...costs[key], amount: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Document reference / explanation
                  <input
                    aria-label={`${key} reference`}
                    className="block w-full border p-2"
                    required={!!costs[key]?.amount}
                    value={costs[key]?.reference ?? ""}
                    onChange={(e) =>
                      setCosts({
                        ...costs,
                        [key]: { ...costs[key], reference: e.target.value },
                      })
                    }
                  />
                </label>
              </fieldset>
            ))}
            <label>
              <input
                required
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I reviewed the stated costs and evidence, including any explicit
              zero amounts
            </label>
            <OperationsButton className="w-full sm:w-auto" disabled={busy}>
              Save audited cost review
            </OperationsButton>
          </form>
          {detail.costReview ? (
            <p>
              Source: {operationalLabel(detail.costReview.source)}; reviewed{" "}
              {operationalTimestamp(detail.costReview.reviewedAt, timeZone)};
              revision {detail.costReview.version}.
            </p>
          ) : null}
        </>
      ) : null}
    </OperationsPage>
  );
}
