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

  if (targetFilename && targetContentType) {
    const byNameAndType =
      parsedAttachments.find(
        (item) =>
          normalizeText(item.filename) === targetFilename &&
          normalizeContentType(item.contentType) === targetContentType
      ) ?? null;
    if (resolveCandidateBuffer(byNameAndType)) return byNameAndType;
  }

  if (targetFilename) {
    const byName =
      parsedAttachments.find((item) => normalizeText(item.filename) === targetFilename) ?? null;
    if (resolveCandidateBuffer(byName)) return byName;
  }

  if (targetContentType) {
    const byType =
      parsedAttachments.find((item) => normalizeContentType(item.contentType) === targetContentType) ?? null;
    if (resolveCandidateBuffer(byType)) return byType;
  }

  const byIndex = (() => {
    const index = resolveAttachmentIndex(target.id);
    if (index < 0 || index >= parsedAttachments.length) return null;
    return parsedAttachments[index] ?? null;
  })();
  if (resolveCandidateBuffer(byIndex)) return byIndex;

  if (parsedAttachments.length === 1 && resolveCandidateBuffer(parsedAttachments[0])) {
    return parsedAttachments[0];
  }

  return null;
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
