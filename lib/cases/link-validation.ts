/**
 * Checks the job, property and client a new case is linked to.
 *
 * Each id must exist; a job implies its property (the rule `updateCase` already
 * applies when linking later); a chosen property must belong to the chosen
 * client, and a job to the chosen property. The client is never derived from a
 * job silently: who a case is visible to stays the office's explicit choice.
 */
import { db } from "@/lib/db";

export class CaseLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseLinkError";
  }
}

export type CaseLinkInput = { jobId?: string | null; propertyId?: string | null; clientId?: string | null };
export type CaseLinks = { jobId: string | null; propertyId: string | null; clientId: string | null };

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function validateCaseLinks(input: CaseLinkInput): Promise<CaseLinks> {
  const jobId = clean(input.jobId);
  let propertyId = clean(input.propertyId);
  const clientId = clean(input.clientId);

  if (jobId) {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { propertyId: true } });
    if (!job) throw new CaseLinkError("The linked job was not found.");
    if (propertyId && propertyId !== job.propertyId) throw new CaseLinkError("The job is at a different property.");
    propertyId = job.propertyId;
  }
  if (propertyId) {
    const property = await db.property.findUnique({ where: { id: propertyId }, select: { clientId: true } });
    if (!property) throw new CaseLinkError("The linked property was not found.");
    if (clientId && property.clientId && property.clientId !== clientId) {
      throw new CaseLinkError("The property belongs to a different client.");
    }
  }
  if (clientId) {
    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) throw new CaseLinkError("The linked client was not found.");
  }
  return { jobId, propertyId, clientId };
}
