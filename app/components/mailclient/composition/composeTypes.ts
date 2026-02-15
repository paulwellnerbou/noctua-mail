import type { Attachment } from "@/lib/data";

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
  html?: string;
  composeFormat?: string;
  quotedHtmlEdited?: boolean;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
  attachments?: Attachment[];
};
