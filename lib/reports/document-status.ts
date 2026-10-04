/** A generated PDF is not evidence that a cleaner submitted or QA approved a form. */
export function reportDocumentStatus(submission: { id?: unknown; createdAt?: unknown } | null | undefined) {
 return submission?.id ? "Submitted form record — QA approval is separate" : "Draft preview — no submitted form; saved drafts are not included";
}
