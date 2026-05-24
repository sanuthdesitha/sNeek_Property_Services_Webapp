import { db } from "@/lib/db";
import {
  type CaseState,
  canTransition,
  validNextStates,
} from "./lifecycle-fsm";

export { type CaseState, canTransition, validNextStates };

export interface TransitionInput {
  caseId: string;
  toState: CaseState;
  actorId: string;
  reason?: string;
}

export async function transitionCase(input: TransitionInput): Promise<void> {
  const c = await db.issueTicket.findUnique({
    where: { id: input.caseId },
    select: { state: true },
  });
  if (!c) throw new Error(`Case ${input.caseId} not found`);
  const from = c.state as CaseState;
  if (!canTransition(from, input.toState)) {
    throw new Error(`Invalid transition from ${from} to ${input.toState}`);
  }
  await db.$transaction([
    db.issueTicket.update({
      where: { id: input.caseId },
      data: { state: input.toState },
    }),
    db.caseTransition.create({
      data: {
        caseId: input.caseId,
        fromState: from,
        toState: input.toState,
        actorId: input.actorId,
        reason: input.reason,
      },
    }),
  ]);
}
