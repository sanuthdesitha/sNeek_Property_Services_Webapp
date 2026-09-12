import { z } from "zod";
import { unionMedia } from "./draft-merge";

export const evidenceDestinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("formField"), fieldId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("bulkPool") }),
  z.object({ type: z.literal("jobTask"), taskId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("laundry") }),
  z.object({ type: z.literal("carryForwardNew") }),
]);
export type EvidenceDestination = z.infer<typeof evidenceDestinationSchema>;
export type BoundEvidence = { key: string; fieldId: string; destination?: EvidenceDestination; detached?: boolean };
export function destinationOf(value: { fieldId: string; destination?: EvidenceDestination }): EvidenceDestination {
  return value.destination ?? { type: "formField", fieldId: value.fieldId };
}
export function destinationKey(destination: EvidenceDestination) {
  return JSON.stringify(destination.type === "formField" ? [destination.type, destination.fieldId] : destination.type === "jobTask" ? [destination.type, destination.taskId] : [destination.type]);
}
export function destinationMedia(state: Record<string, any>, destination: EvidenceDestination): any[] {
  const media = destination.type === "formField" ? state.uploads?.[destination.fieldId] : destination.type === "jobTask" ? state.taskDrafts?.[destination.taskId]?.proof : destination.type === "bulkPool" ? state.bulkPool : destination.type === "laundry" ? state.laundry?.photo : state.carryForward?.photos;
  return Array.isArray(media) ? media : [];
}
export function setDestinationMedia(state: Record<string, any>, destination: EvidenceDestination, media: any[]): Record<string, any> {
  if (destination.type === "formField") return { ...state, uploads: { ...state.uploads, [destination.fieldId]: media } };
  if (destination.type === "jobTask") return { ...state, taskDrafts: { ...state.taskDrafts, [destination.taskId]: { ...state.taskDrafts?.[destination.taskId], proof: media } } };
  if (destination.type === "bulkPool") return { ...state, bulkPool: media };
  if (destination.type === "laundry") return { ...state, laundry: { ...state.laundry, photo: media } };
  return { ...state, carryForward: { ...state.carryForward, photos: media } };
}
export function removeEvidenceKeys(state: Record<string, any>, keys: Set<string>) {
  let next = { ...state };
  const destinations: EvidenceDestination[] = [
    ...Object.keys(state.uploads ?? {}).map(fieldId => ({ type: "formField" as const, fieldId })),
    ...Object.keys(state.taskDrafts ?? {}).map(taskId => ({ type: "jobTask" as const, taskId })),
    { type: "bulkPool" }, { type: "laundry" }, { type: "carryForwardNew" },
  ];
  for (const destination of destinations) next = setDestinationMedia(next, destination, destinationMedia(next, destination).filter(media => !keys.has(media?.key)));
  return next;
}
/** Generic saves may edit answers, never move or discard acknowledged evidence. */
export function reconcileEvidenceState(incoming: Record<string, any>, previous: Record<string, any>, receipts: Record<string, BoundEvidence>) {
  let next = removeEvidenceKeys(incoming, new Set(Object.values(receipts).map(receipt => receipt.key)));
  for (const receipt of Object.values(receipts)) {
    if (receipt.detached) continue;
    const destination = destinationOf(receipt);
    next = setDestinationMedia(next, destination, unionMedia(destinationMedia(next, destination), destinationMedia(previous, destination).filter(media => media?.key === receipt.key)));
  }
  return next;
}
export function evidenceSubmissionChanged(receipts: Record<string, BoundEvidence>, uploads: Record<string, string[]>, tasks: Array<{ id: string; proofKeys?: string[] }>, carry: Record<string, string[]>) {
  const locations: Array<{ destination: EvidenceDestination; keys: string[] }> = [
    ...Object.entries(uploads).map(([fieldId, keys]) => ({ destination: fieldId === "laundry_photo" ? { type: "laundry" as const } : { type: "formField" as const, fieldId }, keys })),
    ...tasks.map(task => ({ destination: { type: "jobTask" as const, taskId: task.id }, keys: task.proofKeys ?? [] })),
    ...Object.entries(carry).map(([id, keys]) => ({ destination: id === "__carryForwardNew" ? { type: "carryForwardNew" as const } : { type: "jobTask" as const, taskId: id }, keys })),
  ];
  return Object.values(receipts).some(receipt => {
    const matches = locations.filter(location => location.keys.includes(receipt.key));
    if (receipt.detached) return matches.length > 0;
    const destination = destinationOf(receipt);
    // Legacy template fields named laundry_photo preserve their original mapping.
    const expected = destination.type === "formField" && destination.fieldId === "laundry_photo" ? { type: "laundry" as const } : destination;
    return matches.length !== 1 || destinationKey(matches[0].destination) !== destinationKey(expected);
  });
}
