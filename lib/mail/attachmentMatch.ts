// Shared normalizers for matching an attachment record against a parsed MIME
// part. Both the mailparser-based extractor (attachmentFromSource.ts) and the
// raw-MIME surgery (mime/removeAttachmentPart.ts) compare cids, filenames and
// content types the same way and read the trailing `-<N>` index out of an
// attachment id, so the rules live here to stay in sync.

export function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeContentType(value?: string | null) {
  return normalizeText((value ?? "").split(";")[0]);
}

export function normalizeCid(value?: string | null) {
  return normalizeText(value).replace(/[<>]/g, "");
}

// Attachment ids are minted as `att-<account>-<uid>-<index>`; the trailing
// index is the positional fallback when cid/filename/type can't disambiguate.
export function resolveAttachmentIndex(attachmentId?: string | null) {
  const match = (attachmentId ?? "").match(/-(\d+)$/);
  if (!match?.[1]) return -1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : -1;
}
