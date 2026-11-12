/**
 * Wave F: the rule for a charge line added from a case, checked inside the
 * invoice PATCH under the invoice row lock (so an approval racing the add
 * cannot slip a line onto an issued invoice): the invoice is a DRAFT invoice
 * (not a credit note) of the case's client. The client of a case is its own
 * client, else the client of its property, else of its job's property.
 */
import type { Prisma } from "@prisma/client";

type CaseReader = { issueTicket: Pick<Prisma.TransactionClient["issueTicket"], "findUnique"> };

export async function caseClientId(reader: CaseReader, caseId: string): Promise<string | null | undefined> {
  const row = await reader.issueTicket.findUnique({
    where: { id: caseId },
    select: { clientId: true, property: { select: { clientId: true } }, job: { select: { property: { select: { clientId: true } } } } },
  });
  if (!row) return undefined;
  return row.clientId ?? row.property?.clientId ?? row.job?.property?.clientId ?? null;
}

export async function caseChargeRefusal(reader: CaseReader, invoice: { status: string; kind: string; clientId: string }, caseId: string): Promise<string | null> {
  if (invoice.status !== "DRAFT") return "A case charge can only be added to a draft invoice. This invoice is no longer a draft.";
  if (invoice.kind !== "INVOICE") return "A case charge cannot go on a credit note.";
  const clientId = await caseClientId(reader, caseId);
  if (clientId === undefined) return "That case no longer exists.";
  if (clientId === null) return "This case has no client, so its charge has no invoice to go on. Link the case to a client, property or job first.";
  return clientId === invoice.clientId ? null : "This invoice belongs to a different client than the case.";
}
