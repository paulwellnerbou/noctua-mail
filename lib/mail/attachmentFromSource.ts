import { simpleParser } from "mailparser";
import type { Attachment } from "@/lib/data";
import { getAttachmentContentBuffer } from "@/lib/mail/syncMessageSanitizer";

type ParsedAttachmentCandidate = {
  filename?: string | null;
  contentType?: string | null;
  contentId?: string | null;
  cid?: string | null;
  content?: Buffer | Uint8Array | ArrayBuffer | null;
  dataUrl?: string | null;
};

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeContentType(value?: string | null) {
  return normalizeText((value ?? "").split(";")[0]);
}

function normalizeCid(value?: string | null) {
  return normalizeText(value).replace(/[<>]/g, "");
}

function cleanCid(value?: string | null) {
  return (value ?? "").trim().replace(/[<>]/g, "");
}

function resolveAttachmentIndex(attachmentId: string) {
  const match = attachmentId.match(/-(\d+)$/);
  if (!match?.[1]) return -1;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

function resolveCandidateBuffer(candidate?: ParsedAttachmentCandidate | null) {
  if (!candidate) return null;
  return getAttachmentContentBuffer(candidate as unknown as Attachment);
}

function filterCandidates(
  parsedAttachments: ParsedAttachmentCandidate[],
  predicate: (candidate: ParsedAttachmentCandidate) => boolean
) {
  return parsedAttachments.filter((candidate) => predicate(candidate) && Boolean(resolveCandidateBuffer(candidate)));
}

function pickParsedAttachment(
  parsedAttachments: ParsedAttachmentCandidate[],
  target: Pick<Attachment, "id" | "filename" | "contentType" | "cid">
) {
  const targetCid = normalizeCid(target.cid);
  if (targetCid) {
    const byCid =
      parsedAttachments.find((item) => normalizeCid(item.contentId ?? item.cid) === targetCid) ?? null;
    if (resolveCandidateBuffer(byCid)) return byCid;
  }

  const targetFilename = normalizeText(target.filename);
  const targetContentType = normalizeContentType(target.contentType);
  const index = resolveAttachmentIndex(target.id);
  const byIndex = index >= 0 && index < parsedAttachments.length ? (parsedAttachments[index] ?? null) : null;

  const chooseCandidate = (
    candidates: ParsedAttachmentCandidate[]
  ) => {
    if (candidates.length === 1) return candidates[0] ?? null;
    if (candidates.length === 0) return null;
    if (byIndex && candidates.includes(byIndex) && resolveCandidateBuffer(byIndex)) {
      return byIndex;
    }
    return null;
  };

  if (targetFilename && targetContentType) {
    const byNameAndType = chooseCandidate(
      filterCandidates(
        parsedAttachments,
        (item) =>
          normalizeText(item.filename) === targetFilename &&
          normalizeContentType(item.contentType) === targetContentType
      )
    );
    if (resolveCandidateBuffer(byNameAndType)) return byNameAndType;
  }

  if (targetFilename) {
    const byName = chooseCandidate(
      filterCandidates(parsedAttachments, (item) => normalizeText(item.filename) === targetFilename)
    );
    if (resolveCandidateBuffer(byName)) return byName;
  }

  if (targetContentType) {
    const byType = chooseCandidate(
      filterCandidates(
        parsedAttachments,
        (item) => normalizeContentType(item.contentType) === targetContentType
      )
    );
    if (resolveCandidateBuffer(byType)) return byType;
  }

  if (resolveCandidateBuffer(byIndex)) return byIndex;

  if (parsedAttachments.length === 1 && resolveCandidateBuffer(parsedAttachments[0])) {
    return parsedAttachments[0];
  }

  return null;
}

export function mergeAttachmentMetadataFromParsedAttachments<
  T extends Pick<Attachment, "id" | "filename" | "contentType" | "cid">
>(attachments: T[], parsedAttachments: ParsedAttachmentCandidate[]) {
  if (attachments.length === 0 || parsedAttachments.length === 0) return attachments;

  return attachments.map((attachment) => {
    const candidate = pickParsedAttachment(parsedAttachments, attachment);
    if (!candidate) return attachment;

    const nextFilename = candidate.filename?.trim() || attachment.filename;
    const nextContentType = candidate.contentType?.trim() || attachment.contentType;
    const nextCid = cleanCid(candidate.contentId ?? candidate.cid) || attachment.cid;

    if (
      nextFilename === attachment.filename &&
      nextContentType === attachment.contentType &&
      nextCid === attachment.cid
    ) {
      return attachment;
    }

    return {
      ...attachment,
      filename: nextFilename,
      contentType: nextContentType,
      cid: nextCid
    } as T;
  });
}

export async function extractAttachmentBufferFromSource(
  source: string,
  target: Pick<Attachment, "id" | "filename" | "contentType" | "cid">
) {
  const parsed = await simpleParser(source);
  const parsedAttachments = (parsed.attachments ?? []) as ParsedAttachmentCandidate[];
  if (parsedAttachments.length === 0) return null;
  const candidate = pickParsedAttachment(parsedAttachments, target);
  return resolveCandidateBuffer(candidate);
}
