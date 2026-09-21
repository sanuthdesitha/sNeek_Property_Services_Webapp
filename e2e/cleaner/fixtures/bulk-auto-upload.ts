// Only the upload transport is replaced. Proposals and strict evidence moves use fetch.
export async function prepareAndUploadFiles(files: File[]) {
  return { results: files.map(file => ({ key: file.name, name: file.name, kind: "image", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%238eaaa3'/%3E%3C/svg%3E" })), failedCount: 0 };
}
