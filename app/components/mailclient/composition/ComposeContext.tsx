"use client";

import { createContext, useContext } from "react";
import type React from "react";
import type { Attachment, Message, RecipientSuggestion } from "@/lib/data";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import type {
  ComposeMode,
  ComposeResizeState,
  ComposeView
} from "./composeTypes";

export type ComposeContextValue = {
  // Open/view state
  composeOpen: boolean;
  composeView: ComposeView;
  composeMode: ComposeMode;
  composeDraftId: string | null;

  // Recipient & subject
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeSubject: string;
  composeShowBcc: boolean;
  composeOpenedAt: string;

  // Derived / snapshot data
  activeAccountId: string | null;
  fromValue: string;
  inReplyToMessage: Message | null;
  composeInviteDraft: ComposeInviteDraft | null;

  // Reset counter used as `key` on ComposeFields
  composeFieldsReset: number;

  // Drag / size state
  composeDragActive: boolean;
  composeSize: { width: number; height: number | null };

  // Draft/send status
  canSaveDraft: boolean;
  draftSaving: boolean;
  draftSaveError: string | null;
  draftSavedAt: number | null;
  sendingMail: boolean;
  discardingDraft: boolean;

  // Refs
  composeModalRef: React.RefObject<HTMLDivElement | null>;
  composeResizeRef: React.MutableRefObject<ComposeResizeState | null>;

  // Setters exposed to the UI components
  setComposeTo: React.Dispatch<React.SetStateAction<string>>;
  setComposeCc: React.Dispatch<React.SetStateAction<string>>;
  setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
  setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
  setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeView: React.Dispatch<React.SetStateAction<ComposeView>>;
  setComposeResizing: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;

  // Compose controller actions
  popOutCompose: () => void;
  popInCompose: () => void;
  minimizeCompose: () => void;

  // Send / draft / dirty
  handleSendMail: () => void;
  handleSaveDraft: () => void;
  handleDiscardDraft: () => void;
  markComposeDirty: () => void;

  // Recipient helpers injected from MailClient
  applyRecipientSelection: (
    current: string,
    selection: RecipientSuggestion,
    setter: React.Dispatch<React.SetStateAction<string>>,
    focusAfter?: "to" | "cc" | "bcc" | null
  ) => string;
  loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<RecipientSuggestion[]>;

  // Navigation helpers
  jumpToMessage: (messageId: string) => void;

  // Format helpers
  getComposeToken: (value: string) => string;
  formatRelativeTime: (timestamp: number | null) => string;

  // Drag handlers
  handleComposeDragEnter: (event: React.DragEvent) => void;
  handleComposeDragLeave: (event: React.DragEvent) => void;
  handleComposeDragOver: (event: React.DragEvent) => void;
  handleComposeDrop: (event: React.DragEvent) => void;

  // The rendered message body field (built inside the orchestrator)
  composeMessageField: React.ReactNode;

  // Wrapper ref for the inline card container (used for scroll-into-view)
  composeCardRef: React.RefObject<HTMLDivElement | null>;
};

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function ComposeContextProvider({
  value,
  children
}: {
  value: ComposeContextValue;
  children: React.ReactNode;
}) {
  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

export function useComposeContext(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) {
    throw new Error("useComposeContext must be used within a ComposeContextProvider");
  }
  return ctx;
}

export { ComposeContext };
