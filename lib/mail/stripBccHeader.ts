// Remove the `Bcc:` header (and any folded continuation lines) from a raw
// MIME blob so it can be safely transmitted over SMTP.
//
// Drafts produced by `saveDraftForAccount` are built with
// `MailComposer(..., keepBcc: true)` so the `Bcc:` header is written into
// the raw bytes. That is correct for the locally-stored draft — the user
// wants to see "who was I about to bcc" when they reopen it — but if we
// relay that raw blob to an SMTP server unchanged, every `To:` / `Cc:`
// recipient would receive a `Bcc:` header in their copy of the message,
// exposing the addresses that are supposed to be blind.
//
// The SMTP envelope (`RCPT TO`) still delivers to the bcc addresses —
// that's handled by `sendRawSmtpMessage`'s `envelope.to` list. This helper
// only touches the headers embedded in the message body.

type MimeBytes = Buffer | string;

/**
 * Return the input with any top-level `Bcc:` header (plus its folded
 * continuation lines) removed. Matching is case-insensitive. The body
 * portion is returned byte-for-byte unchanged — a `Bcc:`-shaped string
 * inside the message body (e.g. in a quoted previous message) is NOT
 * affected because we only scan lines before the first blank line.
 *
 * Accepts and returns the same type as the input (`Buffer` → `Buffer`,
 * `string` → `string`). When a `Buffer` is supplied we round-trip through
 * `latin1` because every byte maps 1:1 to a single code unit there, so
 * binary body content (base64 attachments, encoded Content-Transfer-Encoding
 * regions) is preserved exactly.
 */
export function stripBccHeader(raw: Buffer): Buffer;
export function stripBccHeader(raw: string): string;
export function stripBccHeader(raw: MimeBytes): MimeBytes;
export function stripBccHeader(raw: MimeBytes): MimeBytes {
  if (Buffer.isBuffer(raw)) {
    const asString = raw.toString("latin1");
    const stripped = stripInText(asString);
    return Buffer.from(stripped, "latin1");
  }
  return stripInText(raw);
}

/**
 * Walk the header section one physical line at a time, preserving each
 * kept line's original terminator (CRLF or LF) exactly. When we hit an
 * empty line (end-of-headers) we emit everything from that point — the
 * blank-line separator plus the body — as-is.
 */
function stripInText(raw: string): string {
  const out: string[] = [];
  let cursor = 0;
  let skipping = false;
  while (cursor < raw.length) {
    const { lineText, terminatorLen, nextCursor } = readLine(raw, cursor);
    // Empty line → end of headers; emit the rest verbatim (separator + body).
    if (lineText.length === 0) {
      out.push(raw.slice(cursor));
      return out.join("");
    }
    const terminator = raw.slice(cursor + lineText.length, cursor + lineText.length + terminatorLen);
    const fullLine = lineText + terminator;
    const isFoldedContinuation = lineText[0] === " " || lineText[0] === "\t";
    if (isFoldedContinuation) {
      if (!skipping) out.push(fullLine);
    } else if (isBccHeaderLine(lineText)) {
      skipping = true;
    } else {
      skipping = false;
      out.push(fullLine);
    }
    cursor = nextCursor;
  }
  return out.join("");
}

type LineScan = {
  lineText: string;
  terminatorLen: number;
  nextCursor: number;
};

function readLine(raw: string, from: number): LineScan {
  const crlfAt = raw.indexOf("\r\n", from);
  const lfAt = raw.indexOf("\n", from);
  // Pick whichever line terminator comes first. `\r\n` wins a tie because
  // both indexOfs point at the same `\n` but the `\r\n` one is 1 char shorter
  // in the "distance to the meaningful break".
  let lineEnd = -1;
  let terminatorLen = 0;
  if (crlfAt >= 0 && (lfAt < 0 || crlfAt <= lfAt)) {
    lineEnd = crlfAt;
    terminatorLen = 2;
  } else if (lfAt >= 0) {
    lineEnd = lfAt;
    terminatorLen = 1;
  }
  if (lineEnd < 0) {
    return { lineText: raw.slice(from), terminatorLen: 0, nextCursor: raw.length };
  }
  return {
    lineText: raw.slice(from, lineEnd),
    terminatorLen,
    nextCursor: lineEnd + terminatorLen
  };
}

function isBccHeaderLine(line: string): boolean {
  // Header line starts with `Bcc:` (case-insensitive). There must be no
  // whitespace before the colon per RFC 5322 §2.2.
  if (line.length < 4) return false;
  const name = line.slice(0, 3).toLowerCase();
  return name === "bcc" && line[3] === ":";
}

/**
 * Prepend `To: undisclosed-recipients:;` to the input's header block.
 *
 * Intended for the BCC-only case: after `stripBccHeader` removes the
 * `Bcc:` header and the draft had no `To:` or `Cc:` to begin with, the
 * wire copy would carry no recipient header at all — technically valid
 * SMTP (the envelope still has `RCPT TO` addresses) but several MUAs
 * display such messages awkwardly. `/api/accounts/[accountId]/smtp/send`
 * already handles this case the same way (see the `outboundTo` fallback
 * in that route); this helper mirrors the behavior for draft-send.
 *
 * No-op when the input already has a `To:` or `Cc:` header (only kicks
 * in when there truly are no recipient headers). Line terminator of the
 * inserted header is `\r\n` regardless of the rest of the blob's line
 * style — RFC 5322 uses CRLF, and mixing within a header block is fine.
 */
export function injectUndisclosedRecipientsToHeader(raw: Buffer): Buffer;
export function injectUndisclosedRecipientsToHeader(raw: string): string;
export function injectUndisclosedRecipientsToHeader(raw: MimeBytes): MimeBytes;
export function injectUndisclosedRecipientsToHeader(raw: MimeBytes): MimeBytes {
  if (Buffer.isBuffer(raw)) {
    const asString = raw.toString("latin1");
    const out = injectInText(asString);
    return Buffer.from(out, "latin1");
  }
  return injectInText(raw);
}

function injectInText(raw: string): string {
  // If the header block already has a To: or Cc:, do nothing.
  if (headerBlockContainsRecipient(raw)) return raw;
  const insertion = "To: undisclosed-recipients:;\r\n";
  return insertion + raw;
}

function headerBlockContainsRecipient(raw: string): boolean {
  let cursor = 0;
  while (cursor < raw.length) {
    const { lineText, nextCursor } = readLine(raw, cursor);
    if (lineText.length === 0) return false; // Reached end of headers.
    if (lineText[0] !== " " && lineText[0] !== "\t") {
      // Non-continuation line → a header name lives here.
      const lower = lineText.toLowerCase();
      if (lower.startsWith("to:") || lower.startsWith("cc:")) return true;
    }
    cursor = nextCursor;
  }
  return false;
}
