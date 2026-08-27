// Raw-MIME surgery: remove a single attachment part from an RFC 2822 message
// while leaving every other byte untouched. We splice the raw bytes rather than
// re-serialising a parsed tree so the surviving parts keep their original
// headers, encodings and boundary text — anything that rebuilds the MIME would
// subtly rewrite the message (and it has to break DKIM anyway once a part is
// gone, so there's no upside to a lossy round-trip).
//
// Bytes are handled through a latin1 string so one character maps to exactly
// one byte; string offsets are therefore byte offsets and slicing the original
// Buffer by them is exact for binary attachment payloads too.

import {
  normalizeCid,
  normalizeContentType,
  normalizeText,
  resolveAttachmentIndex
} from "@/lib/mail/attachmentMatch";

type AttachmentTarget = {
  id?: string | null;
  filename?: string | null;
  contentType?: string | null;
  cid?: string | null;
};

type LeafPart = {
  // Byte range of the part itself (headers + body), excluding its delimiter.
  start: number;
  end: number;
  // Byte range to remove: the opening `--boundary` line through to (but not
  // including) the next boundary delimiter, so the surrounding structure stays
  // valid after the splice.
  deleteStart: number;
  deleteEnd: number;
  contentType: string;
  filename: string;
  cid: string;
  isAttachmentLike: boolean;
};

// Finds the blank line that separates a part's headers from its body. Handles
// both CRLF and bare-LF sources; returns the offset where the body begins.
function findHeaderBodySplit(text: string, start: number, end: number) {
  const crlf = text.indexOf("\r\n\r\n", start);
  if (crlf !== -1 && crlf < end) {
    return { headerEnd: crlf, bodyStart: crlf + 4 };
  }
  const lf = text.indexOf("\n\n", start);
  if (lf !== -1 && lf < end) {
    return { headerEnd: lf, bodyStart: lf + 2 };
  }
  return { headerEnd: end, bodyStart: end };
}

// Unfolds RFC 5322 header continuation lines and returns the raw value for the
// first occurrence of `name` (case-insensitive).
function readHeader(headerBlock: string, name: string) {
  const lines = headerBlock.split(/\r\n|\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  const lower = name.toLowerCase();
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() === lower) {
      return line.slice(colon + 1).trim();
    }
  }
  return "";
}

// Pulls a parameter (e.g. boundary, name, filename) out of a structured header
// value, tolerating quotes and the `param*=` RFC 2231 continuation spelling.
function readHeaderParam(headerValue: string, param: string) {
  const pattern = new RegExp(`;\\s*${param}\\*?\\s*=\\s*("([^"]*)"|([^;]*))`, "i");
  const match = headerValue.match(pattern);
  if (!match) return "";
  return (match[2] ?? match[3] ?? "").trim();
}

type Delimiter = { index: number; contentStart: number; isClose: boolean };

// Scans a multipart body for its boundary delimiter lines. A delimiter is
// `--boundary` (optionally closed by a trailing `--`) standing at the start of a
// line. `bodyStart` itself counts as a line start, since the header/body split
// can land the body cursor directly on the first delimiter with no newline
// before it.
function scanDelimiters(
  text: string,
  boundary: string,
  bodyStart: number,
  end: number
): Delimiter[] {
  const token = `--${boundary}`;
  const delimiters: Delimiter[] = [];
  let from = bodyStart;
  while (from < end) {
    const index = text.indexOf(token, from);
    if (index === -1 || index >= end) break;
    const atLineStart = index === bodyStart || index === 0 || text[index - 1] === "\n";
    if (!atLineStart) {
      from = index + token.length;
      continue;
    }
    let cursor = index + token.length;
    const isClose = text[cursor] === "-" && text[cursor + 1] === "-";
    if (isClose) cursor += 2;
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
    // The token only forms a delimiter when the rest of the line is empty.
    if (text[cursor] === "\r" && text[cursor + 1] === "\n") cursor += 2;
    else if (text[cursor] === "\n") cursor += 1;
    else if (cursor !== end) {
      from = index + token.length;
      continue;
    }
    delimiters.push({ index, contentStart: cursor, isClose });
    if (isClose) break;
    from = cursor;
  }
  return delimiters;
}

type ParsedPart = {
  contentType: string;
  filename: string;
  cid: string;
  disposition: string;
  boundary: string;
  bodyStart: number;
};

function parsePartMeta(text: string, start: number, end: number): ParsedPart {
  const { headerEnd, bodyStart } = findHeaderBodySplit(text, start, end);
  const headerBlock = text.slice(start, headerEnd);
  const contentTypeRaw = readHeader(headerBlock, "content-type");
  const dispositionRaw = readHeader(headerBlock, "content-disposition");
  const cidRaw = readHeader(headerBlock, "content-id");
  const filename =
    readHeaderParam(dispositionRaw, "filename") || readHeaderParam(contentTypeRaw, "name");
  return {
    contentType: normalizeContentType(contentTypeRaw),
    filename,
    cid: normalizeCid(cidRaw),
    disposition: normalizeText(dispositionRaw.split(";")[0]),
    boundary: readHeaderParam(contentTypeRaw, "boundary"),
    bodyStart
  };
}

// Depth-first walk collecting every leaf part, recursing through nested
// multiparts. Each leaf records the byte range to delete (its opening delimiter
// through the start of the next delimiter) so removal keeps the container well
// formed.
function collectLeaves(
  text: string,
  start: number,
  end: number,
  parentMeta: ParsedPart,
  leaves: LeafPart[]
) {
  if (parentMeta.boundary) {
    const delimiters = scanDelimiters(text, parentMeta.boundary, parentMeta.bodyStart, end);
    for (let i = 0; i < delimiters.length - 1; i += 1) {
      const current = delimiters[i]!;
      if (current.isClose) break;
      const next = delimiters[i + 1]!;
      const childStart = current.contentStart;
      const childEnd = next.index;
      const childMeta = parsePartMeta(text, childStart, childEnd);
      if (childMeta.boundary) {
        collectLeaves(text, childStart, childEnd, childMeta, leaves);
      } else {
        const isTextPlain = childMeta.contentType === "text/plain";
        const isTextHtml = childMeta.contentType === "text/html";
        leaves.push({
          start: childStart,
          end: childEnd,
          deleteStart: current.index,
          deleteEnd: next.index,
          contentType: childMeta.contentType,
          filename: childMeta.filename,
          cid: childMeta.cid,
          // Mirror shouldTreatAsAttachment in lib/mail/imap/parser.ts exactly:
          // the parser's attachment index (which the `att-<N>` id fallback keys
          // into) counts any non-text part with a content type, even without a
          // filename/cid/disposition. Diverging here would offset the index and
          // splice the wrong leaf.
          isAttachmentLike:
            childMeta.disposition === "attachment" ||
            Boolean(childMeta.filename) ||
            (Boolean(childMeta.cid) && !isTextPlain && !isTextHtml) ||
            (childMeta.contentType.length > 0 && !isTextPlain && !isTextHtml)
        });
      }
    }
  }
}

// Applies the same precedence as the attachment-buffer extractor: content-id
// first (the only reliable key for inline images), then filename+type, then
// filename, then a unique content-type, then positional index among the
// attachment-like leaves.
function pickLeaf(leaves: LeafPart[], target: AttachmentTarget): LeafPart | null {
  const targetCid = normalizeCid(target.cid);
  if (targetCid) {
    const byCid = leaves.filter((leaf) => leaf.cid === targetCid);
    if (byCid.length === 1) return byCid[0]!;
    if (byCid.length > 1) {
      // Fall through to positional disambiguation below.
    }
  }

  const targetFilename = normalizeText(target.filename);
  const targetContentType = normalizeContentType(target.contentType);
  const attachmentLike = leaves.filter((leaf) => leaf.isAttachmentLike);
  const index = resolveAttachmentIndex(target.id);
  const byIndex = index >= 0 && index < attachmentLike.length ? attachmentLike[index]! : null;

  const choose = (candidates: LeafPart[]) => {
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length === 0) return null;
    if (byIndex && candidates.includes(byIndex)) return byIndex;
    return null;
  };

  if (targetFilename && targetContentType) {
    const hit = choose(
      leaves.filter(
        (leaf) => leaf.filename.toLowerCase() === targetFilename && leaf.contentType === targetContentType
      )
    );
    if (hit) return hit;
  }
  if (targetFilename) {
    const hit = choose(leaves.filter((leaf) => leaf.filename.toLowerCase() === targetFilename));
    if (hit) return hit;
  }
  if (targetContentType) {
    const hit = choose(leaves.filter((leaf) => leaf.contentType === targetContentType));
    if (hit) return hit;
  }
  if (byIndex) return byIndex;
  return null;
}

export type RemoveAttachmentPartResult = {
  raw: Buffer;
  removed: boolean;
};

/**
 * Removes the MIME part backing `target` from a raw message. Returns the
 * original buffer untouched with `removed: false` when the part can't be
 * located, so callers never append a copy identical to the original.
 */
export function removeAttachmentPartFromRawMessage(
  rawMessage: Buffer | string,
  target: AttachmentTarget
): RemoveAttachmentPartResult {
  const buffer = Buffer.isBuffer(rawMessage) ? rawMessage : Buffer.from(rawMessage, "utf8");
  const text = buffer.toString("latin1");

  const rootMeta = parsePartMeta(text, 0, text.length);
  if (!rootMeta.boundary) {
    return { raw: buffer, removed: false };
  }

  const leaves: LeafPart[] = [];
  collectLeaves(text, 0, text.length, rootMeta, leaves);
  if (leaves.length === 0) {
    return { raw: buffer, removed: false };
  }

  const leaf = pickLeaf(leaves, target);
  if (!leaf) {
    return { raw: buffer, removed: false };
  }

  const nextText = text.slice(0, leaf.deleteStart) + text.slice(leaf.deleteEnd);
  return { raw: Buffer.from(nextText, "latin1"), removed: true };
}
