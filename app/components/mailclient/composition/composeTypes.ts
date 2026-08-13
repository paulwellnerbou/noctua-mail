import type { Attachment } from "@/lib/data";
import type { ComposeInviteDraft, ComposeInvitePayload } from "@/lib/composeInvite";

export type ComposeView = "inline" | "modal" | "minimized";

export type ComposeMode =
  | "new"
  | "reply"
  | "replyAll"
  | "forward"
  | "edit"
  | "editAsNew";

export type ComposeTab = "text" | "html" | "markdown";

export type ComposeReplyHeaders = {
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
};

export type ComposeQuotedParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

export type ComposeSize = {
  width: number;
  height: number | null;
};

export type ComposeResizeState = {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

// Dropped image files awaiting the user's embed-vs-attach choice, anchored at
// the drop position (viewport coordinates) for the choice popover.
export type PendingImageDrop = {
  files: File[];
  x: number;
  y: number;
  // Editor drops capture their Lexical insertion point before the choice menu
  // takes focus. Keeping the insertion operation with the pending drop avoids
  // losing that exact position while the user chooses Embed or Attach.
  insertInlineImages?: (files: File[]) => void;
};

export type ComposeSelectionState = {
  start: number;
  end: number;
  value: string;
};

export type ComposeSignatureState = {
  id: string;
  text: string;
  html: string;
};

export type DraftSavePayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  markdown?: string;
  html?: string;
  composeFormat?: string;
  quotedHtmlEdited?: boolean;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
  invite?: ComposeInviteDraft;
  attachments?: Attachment[];
};

export type SendInvitePayload = ComposeInvitePayload;
