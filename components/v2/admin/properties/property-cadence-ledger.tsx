"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export function PropertyCadenceLedger({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    fetch(`/api/admin/properties/${propertyId}/cadence-ledger`, { cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => { if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [propertyId]);
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Cadence evidence review">
    <h3 className="font-semibold">Cadence evidence review</h3>
    <p className="text-sm">Planning preview only. Deep clean: every 3 calendar months. Detail work: each Monday–Sunday week in Sydney. This does not schedule work or change charges.</p>
    <p className="text-xs">Dates below come from completed jobs with matching task/checklist evidence. Open the job to verify coverage; matching a photo does not prove every room was done. No match means unverified, not completed.</p>
    {error ? <p role="alert">The ledger could not be loaded. Do not treat missing results as up to date.</p> : !data ? <p>Loading evidence…</p> : <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Work</th><th>Last evidence</th><th>Next due / week starts</th><th>Review status</th></tr></thead><tbody>
        {data.rows.map((row: any) => <tr key={row.key} className="border-t"><td className="py-2">{row.label}</td><td>{row.lastEvidence ? <Link className="underline" href={`/admin/jobs/${row.lastEvidence.jobId}`} title={row.lastEvidence.basis}>{row.lastEvidence.day}</Link> : "No verified date"}</td><td>{row.dueDay ?? "Review baseline"}</td><td>{row.status === "UNVERIFIED" ? "Unverified" : row.status === "OVERDUE" ? "Overdue — review" : row.status === "DUE" ? "Due — review" : "Current evidence"}</td></tr>)}
      </tbody></table></div>
      <p className="text-xs">Reviewed {data.reviewedJobs} completed jobs.{data.limited ? " Only the latest 500 jobs were examined; older evidence may exist." : ""} Evidence matches are candidates, not verified completion. Use Deep-clean planning to verify a baseline and review undated proposals. Weekly detail remains a preview.</p>
    </>}
  </section>;
}
