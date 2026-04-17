// Pure helper for building the SMTP envelope recipient list from a draft's
// parsed `to` / `cc` / `bcc` strings. Extracted so `lib/drafts.ts` —
// which is hard to unit-test because it reaches into the DB, IMAP, and
// SMTP transports — can pass through to a tested function for the
// address-parsing portion of draft-send.
//
// We deliberately extract each email address via the same regex used
// elsewhere in the codebase (`lib/drafts.ts::extractEmails`) rather than
// a full RFC-5322 parser. That helper has been validated against the
// shapes the compose editor actually produces, and the SMTP envelope
// only needs bare addresses (no display names / quoting).

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function extractEmails(value?: string | null): string[] {
  if (!value) return [];
  return value.match(EMAIL_RE) ?? [];
}

export type DraftSendEnvelopeInput = {
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
};

/**
 * Build the SMTP envelope recipient list (unique, lowercased, combining
 * `to` + `cc` + `bcc`). Returns an empty array if no address is parseable
 * — the caller is expected to reject the send in that case.
 */
export function buildDraftSendEnvelopeRecipients(
  draft: DraftSendEnvelopeInput
): string[] {
  const merged = [
    ...extractEmails(draft.to),
    ...extractEmails(draft.cc),
    ...extractEmails(draft.bcc)
  ];
  const dedup = new Set<string>();
  for (const address of merged) {
    dedup.add(address.toLowerCase());
  }
  return Array.from(dedup);
}

/**
 * True when at least one of `to` / `cc` / `bcc` has a parseable address.
 * Checked before send — mirrors `/api/accounts/[accountId]/smtp/send`'s
 * own guard so list-level draft send and compose-editor send reject the
 * same empty-recipient case.
 */
export function draftHasSendableRecipients(draft: DraftSendEnvelopeInput): boolean {
  return buildDraftSendEnvelopeRecipients(draft).length > 0;
}
